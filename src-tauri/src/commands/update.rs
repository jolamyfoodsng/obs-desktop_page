use std::sync::Mutex;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::Url;
use semver::Version;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::commands::store::load_state;
use crate::models::state::{AppUpdateProgressEvent, AppUpdateSnapshot};
use crate::utils::errors::AppError;

pub const APP_UPDATE_PROGRESS_EVENT: &str = "app-update-progress";

const UPDATE_ROUTE_TIMEOUT: Duration = Duration::from_secs(20);
const DEFAULT_UPDATER_PUBLIC_KEY: &str = include_str!("../../updater.pub.key");

#[derive(Default)]
pub struct AppUpdateRegistry {
    pending_update: Mutex<Option<Update>>,
    downloaded_bytes: Mutex<Option<Vec<u8>>>,
    latest_snapshot: Mutex<Option<AppUpdateSnapshot>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMetadataResponse {
    latest_version: String,
    minimum_supported_version: String,
    release_notes: String,
    published_at: Option<String>,
    release_tag: String,
    release_url: String,
    channel: String,
    status: Option<String>,
    message: Option<String>,
    selected_asset_name: Option<String>,
    selected_asset_reason: Option<String>,
    selected_asset_url: Option<String>,
    selected_asset_size: Option<u64>,
    manual_fallback_name: Option<String>,
    manual_fallback_reason: Option<String>,
    manual_fallback_url: Option<String>,
    manual_fallback_size: Option<u64>,
}

struct UpdateClientSelection {
    current_version: String,
    target: String,
    arch: String,
    bundle_type: String,
}

fn runtime_or_build_var(name: &str, build_value: Option<&str>) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            build_value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        })
}

fn update_base_url() -> Option<String> {
    runtime_or_build_var("TAURI_UPDATE_BASE_URL", option_env!("TAURI_UPDATE_BASE_URL"))
        .or_else(||Some("https://obs-desktop-page.vercel.app".to_string()))
        .map(|value| value.trim_end_matches('/').to_string())
}

fn updater_public_key() -> Option<String> {
    let key = DEFAULT_UPDATER_PUBLIC_KEY.trim();
    if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    }
}

fn bundle_type_label() -> String {
    runtime_or_build_var(
        "TAURI_UPDATE_BUNDLE_TYPE",
        option_env!("TAURI_UPDATE_BUNDLE_TYPE"),
    )
    .unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "nsis".to_string()
        } else if cfg!(target_os = "linux") {
            "appimage".to_string()
        } else {
            "app".to_string()
        }
    })
}

fn current_selection(app: &AppHandle) -> UpdateClientSelection {
    let target = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "macos"
    };

    let arch = match std::env::consts::ARCH {
        "x86_64" | "amd64" => "x86_64",
        "aarch64" | "arm64" => "aarch64",
        other => other,
    };

    UpdateClientSelection {
        current_version: app.package_info().version.to_string(),
        target: target.to_string(),
        arch: arch.to_string(),
        bundle_type: bundle_type_label(),
    }
}

fn resolve_channel(app: &AppHandle) -> String {
    load_state(app)
        .ok()
        .map(|state| {
            if state.settings.beta_updates {
                "beta".to_string()
            } else {
                "stable".to_string()
            }
        })
        .unwrap_or_else(|| "stable".to_string())
}

fn disabled_snapshot(app: &AppHandle, channel: String, message: impl Into<String>) -> AppUpdateSnapshot {
    AppUpdateSnapshot {
        status: "disabled".to_string(),
        message: message.into(),
        current_version: app.package_info().version.to_string(),
        latest_version: None,
        minimum_supported_version: None,
        release_notes: None,
        published_at: None,
        update_channel: channel,
        release_tag: None,
        release_url: None,
        selected_asset_name: None,
        selected_asset_reason: None,
        selected_asset_url: None,
        selected_asset_size: None,
        manual_fallback_name: None,
        manual_fallback_reason: None,
        manual_fallback_url: None,
        manual_fallback_size: None,
    }
}

fn normalize_semver(value: &str) -> Option<Version> {
    Version::parse(value.trim_start_matches('v').trim()).ok()
}

fn snapshot_from_metadata(app: &AppHandle, metadata: UpdateMetadataResponse) -> AppUpdateSnapshot {
    let status = match metadata.status.as_deref() {
        Some("no-installable-asset" | "source-only" | "ambiguous") => "failed",
        Some(value) => value,
        None => "no-update",
    };

    let message = metadata.message.unwrap_or_else(|| match status {
        "no-update" => "You are already on the latest version.".to_string(),
        "update-required" => "Update required before you can keep using this build.".to_string(),
        "update-available" => "A newer build is available.".to_string(),
        _ => "Could not resolve a usable in-app update.".to_string(),
    });

    AppUpdateSnapshot {
        status: status.to_string(),
        message,
        current_version: app.package_info().version.to_string(),
        latest_version: Some(metadata.latest_version),
        minimum_supported_version: Some(metadata.minimum_supported_version),
        release_notes: Some(metadata.release_notes),
        published_at: metadata.published_at,
        update_channel: metadata.channel,
        release_tag: Some(metadata.release_tag),
        release_url: Some(metadata.release_url),
        selected_asset_name: metadata.selected_asset_name,
        selected_asset_reason: metadata.selected_asset_reason,
        selected_asset_url: metadata.selected_asset_url,
        selected_asset_size: metadata.selected_asset_size,
        manual_fallback_name: metadata.manual_fallback_name,
        manual_fallback_reason: metadata.manual_fallback_reason,
        manual_fallback_url: metadata.manual_fallback_url,
        manual_fallback_size: metadata.manual_fallback_size,
    }
}

fn manifest_endpoint(base_url: &str, channel: &str) -> Result<Url, AppError> {
    let endpoint = format!(
        "{base_url}/api/update/{{{{target}}}}/{{{{arch}}}}/{{{{bundle_type}}}}/{{{{current_version}}}}?channel={channel}"
    );
    endpoint
        .parse()
        .map_err(|error| AppError::message(format!("Could not parse updater endpoint: {}", error)))
}

fn fetch_metadata(base_url: &str, selection: &UpdateClientSelection, channel: &str) -> Result<UpdateMetadataResponse, AppError> {
    let mut url = Url::parse(&format!("{base_url}/api/update"))
        .map_err(|error| AppError::message(format!("Could not parse update metadata URL: {}", error)))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("currentVersion", &selection.current_version);
        pairs.append_pair("target", &selection.target);
        pairs.append_pair("arch", &selection.arch);
        pairs.append_pair("bundleType", &selection.bundle_type);
        pairs.append_pair("channel", channel);
    }

    let client = Client::builder()
        .timeout(UPDATE_ROUTE_TIMEOUT)
        .build()
        .map_err(|error| AppError::message(format!("Could not build update metadata client: {}", error)))?;

    let response = client.get(url).send()?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(AppError::message(format!(
            "Update metadata request failed with status {}. {}",
            status,
            body
        )));
    }

    Ok(response.json()?)
}

fn store_snapshot(app: &AppHandle, snapshot: &AppUpdateSnapshot) {
    let registry = app.state::<AppUpdateRegistry>();
    let mut latest_snapshot = registry
        .latest_snapshot
        .lock()
        .expect("app update snapshot lock poisoned");
    latest_snapshot.replace(snapshot.clone());
}

fn clear_pending_download(app: &AppHandle) {
    let registry = app.state::<AppUpdateRegistry>();
    let mut pending_update = registry
        .pending_update
        .lock()
        .expect("app update registry lock poisoned");
    pending_update.take();

    let mut downloaded_bytes = registry
        .downloaded_bytes
        .lock()
        .expect("app update download buffer lock poisoned");
    downloaded_bytes.take();
}

fn emit_update_progress(
    app: &AppHandle,
    stage: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: impl Into<String>,
) {
    let total = total_bytes.filter(|value| *value > 0);
    let progress_percent = total.map(|value| {
        let fraction = (downloaded_bytes as f64 / value as f64) * 100.0;
        fraction.clamp(0.0, 100.0)
    });

    let _ = app.emit(
        APP_UPDATE_PROGRESS_EVENT,
        AppUpdateProgressEvent {
            stage: stage.to_string(),
            downloaded_bytes,
            total_bytes,
            progress_percent,
            message: message.into(),
        },
    );
}

async fn metadata_snapshot(app: AppHandle) -> Result<AppUpdateSnapshot, AppError> {
    let channel = resolve_channel(&app);
    let Some(base_url) = update_base_url() else {
        let snapshot = disabled_snapshot(
            &app,
            channel,
            "Private in-app updates are not configured for this build yet.",
        );
        store_snapshot(&app, &snapshot);
        clear_pending_download(&app);
        return Ok(snapshot);
    };

    let Some(public_key) = updater_public_key() else {
        let snapshot = disabled_snapshot(
            &app,
            channel,
            "This build is missing the updater public key, so in-app updates are disabled.",
        );
        store_snapshot(&app, &snapshot);
        clear_pending_download(&app);
        return Ok(snapshot);
    };

    if public_key.trim().is_empty() {
        let snapshot = disabled_snapshot(
            &app,
            channel,
            "This build is missing the updater public key, so in-app updates are disabled.",
        );
        store_snapshot(&app, &snapshot);
        clear_pending_download(&app);
        return Ok(snapshot);
    }

    let selection = current_selection(&app);
    let metadata = tauri::async_runtime::spawn_blocking(move || fetch_metadata(&base_url, &selection, &channel))
        .await
        .map_err(|error| AppError::message(format!("Could not join the update metadata task: {}", error)))??;

    let snapshot = snapshot_from_metadata(&app, metadata);
    store_snapshot(&app, &snapshot);
    clear_pending_download(&app);
    Ok(snapshot)
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<AppUpdateSnapshot, String> {
    metadata_snapshot(app).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn download_app_update(app: AppHandle) -> Result<AppUpdateSnapshot, String> {
    let snapshot = metadata_snapshot(app.clone())
        .await
        .map_err(|error| error.to_string())?;

    if snapshot.status == "disabled" || snapshot.status == "no-update" {
        return Ok(snapshot);
    }

    if snapshot.status != "update-available" && snapshot.status != "update-required" {
        return Ok(snapshot)
    }

    let Some(base_url) = update_base_url() else {
        return Ok(disabled_snapshot(
            &app,
            snapshot.update_channel.clone(),
            "Private in-app updates are not configured for this build yet.",
        ));
    };
    let Some(public_key) = updater_public_key() else {
        return Ok(disabled_snapshot(
            &app,
            snapshot.update_channel.clone(),
            "This build is missing the updater public key, so in-app updates are disabled.",
        ));
    };

    let endpoint = manifest_endpoint(&base_url, &snapshot.update_channel).map_err(|error| error.to_string())?;
    let updater = app
        .updater_builder()
        .pubkey(public_key)
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;

    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No update is available for this build.".to_string())?;

    emit_update_progress(&app, "started", 0, None, "Downloading update...");

    let mut downloaded_bytes = 0_u64;
    let bytes = update
        .download(
            |chunk_length, total_bytes| {
                downloaded_bytes += chunk_length as u64;
                emit_update_progress(
                    &app,
                    "progress",
                    downloaded_bytes,
                    total_bytes,
                    "Downloading update...",
                );
            },
            || {
                emit_update_progress(
                    &app,
                    "finished",
                    0,
                    None,
                    "Update download complete.",
                );
            },
        )
        .await
        .map_err(|error| error.to_string())?;

    let ready_snapshot = AppUpdateSnapshot {
        status: "ready-to-restart".to_string(),
        message: "Restart to finish updating.".to_string(),
        ..snapshot.clone()
    };

    {
        let registry = app.state::<AppUpdateRegistry>();
        let mut pending_update = registry
            .pending_update
            .lock()
            .expect("app update registry lock poisoned");
        pending_update.replace(update);

        let mut downloaded = registry
            .downloaded_bytes
            .lock()
            .expect("app update download buffer lock poisoned");
        downloaded.replace(bytes);

        let mut latest_snapshot = registry
            .latest_snapshot
            .lock()
            .expect("app update snapshot lock poisoned");
        latest_snapshot.replace(ready_snapshot.clone());
    }

    Ok(ready_snapshot)
}

#[tauri::command]
pub fn install_app_update(app: AppHandle) -> Result<AppUpdateSnapshot, String> {
    let registry = app.state::<AppUpdateRegistry>();
    let pending_update = registry
        .pending_update
        .lock()
        .expect("app update registry lock poisoned")
        .clone();
    let downloaded_bytes = registry
        .downloaded_bytes
        .lock()
        .expect("app update download buffer lock poisoned")
        .clone();
    let latest_snapshot = registry
        .latest_snapshot
        .lock()
        .expect("app update snapshot lock poisoned")
        .clone();

    let update = pending_update.ok_or_else(|| "No downloaded update is ready to install.".to_string())?;
    let bytes = downloaded_bytes.ok_or_else(|| "No downloaded update payload is available.".to_string())?;
    let _snapshot = latest_snapshot.unwrap_or_else(|| AppUpdateSnapshot {
        status: "ready-to-restart".to_string(),
        message: "Restart to finish updating.".to_string(),
        current_version: app.package_info().version.to_string(),
        latest_version: None,
        minimum_supported_version: None,
        release_notes: None,
        published_at: None,
        update_channel: resolve_channel(&app),
        release_tag: None,
        release_url: None,
        selected_asset_name: None,
        selected_asset_reason: None,
        selected_asset_url: None,
        selected_asset_size: None,
        manual_fallback_name: None,
        manual_fallback_reason: None,
        manual_fallback_url: None,
        manual_fallback_size: None,
    });

    update
        .install(bytes.as_slice())
        .map_err(|error| error.to_string())?;

    clear_pending_download(&app);

    #[cfg(target_os = "windows")]
    {
        return Ok(_snapshot);
    }

    #[cfg(not(target_os = "windows"))]
    {
        app.restart();
    }
}

#[tauri::command]
pub fn get_cached_app_update_snapshot(app: AppHandle) -> Result<Option<AppUpdateSnapshot>, String> {
    let registry = app.state::<AppUpdateRegistry>();
    let snapshot = registry
        .latest_snapshot
        .lock()
        .expect("app update snapshot lock poisoned")
        .clone();
    Ok(snapshot)
}

#[tauri::command]
pub fn clear_cached_app_update(app: AppHandle) -> Result<(), String> {
    clear_pending_download(&app);
    let registry = app.state::<AppUpdateRegistry>();
    let mut latest_snapshot = registry
        .latest_snapshot
        .lock()
        .expect("app update snapshot lock poisoned");
    latest_snapshot.take();
    Ok(())
}

#[allow(dead_code)]
fn is_required_update(snapshot: &AppUpdateSnapshot) -> bool {
    let Some(current_version) = normalize_semver(&snapshot.current_version) else {
        return false;
    };
    let Some(minimum_version) = snapshot
        .minimum_supported_version
        .as_deref()
        .and_then(normalize_semver)
    else {
        return false;
    };

    current_version < minimum_version
}
