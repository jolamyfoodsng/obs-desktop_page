use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use flate2::read::GzDecoder;
use plist::Dictionary;
use reqwest::blocking::Client;
use reqwest::Url;
use semver::Version;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tar::Archive;
use tauri_plugin_updater::{extract_path_from_executable, Update, UpdaterExt};

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

#[derive(Debug, Clone, PartialEq, Eq)]
struct MacosBundleInfo {
    bundle_path: PathBuf,
    executable_name: Option<String>,
    short_version: Option<String>,
    build_version: Option<String>,
}

impl MacosBundleInfo {
    fn reported_version(&self) -> Option<&str> {
        self.short_version
            .as_deref()
            .or(self.build_version.as_deref())
    }
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

    log::info!(
        "updater metadata request: url={} current_version={} target={} arch={} bundle_type={} channel={}",
        url,
        selection.current_version,
        selection.target,
        selection.arch,
        selection.bundle_type,
        channel
    );

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

fn update_snapshot_or_default(app: &AppHandle, latest_snapshot: Option<AppUpdateSnapshot>) -> AppUpdateSnapshot {
    latest_snapshot.unwrap_or_else(|| AppUpdateSnapshot {
        status: "ready-to-restart".to_string(),
        message: "Restart to finish updating.".to_string(),
        current_version: app.package_info().version.to_string(),
        latest_version: None,
        minimum_supported_version: None,
        release_notes: None,
        published_at: None,
        update_channel: resolve_channel(app),
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
    })
}

fn bundle_info_from_dictionary(bundle_path: PathBuf, dictionary: Dictionary) -> MacosBundleInfo {
    MacosBundleInfo {
        executable_name: dictionary
            .get("CFBundleExecutable")
            .and_then(|value| value.as_string())
            .map(ToOwned::to_owned),
        short_version: dictionary
            .get("CFBundleShortVersionString")
            .and_then(|value| value.as_string())
            .map(ToOwned::to_owned),
        build_version: dictionary
            .get("CFBundleVersion")
            .and_then(|value| value.as_string())
            .map(ToOwned::to_owned),
        bundle_path,
    }
}

fn read_macos_bundle_info_from_path(bundle_path: &Path) -> Result<MacosBundleInfo, AppError> {
    let info_plist = bundle_path.join("Contents").join("Info.plist");
    let dictionary = plist::from_file::<_, Dictionary>(&info_plist).map_err(|error| {
        AppError::message(format!(
            "Could not read macOS bundle metadata from {}: {}",
            info_plist.display(),
            error
        ))
    })?;
    Ok(bundle_info_from_dictionary(bundle_path.to_path_buf(), dictionary))
}

fn bundle_root_from_archive_path(path: &Path) -> Option<PathBuf> {
    let mut bundle_path = PathBuf::new();
    for component in path.components() {
        let name = component.as_os_str();
        bundle_path.push(name);
        if name.to_string_lossy().ends_with(".app") {
            return Some(bundle_path);
        }
    }
    None
}

fn is_bundle_info_plist_path(path: &Path, bundle_root: &Path) -> bool {
    path == bundle_root.join("Contents").join("Info.plist")
}

fn read_macos_bundle_info_from_archive(bytes: &[u8]) -> Result<MacosBundleInfo, AppError> {
    let decoder = GzDecoder::new(Cursor::new(bytes));
    let mut archive = Archive::new(decoder);

    for entry in archive.entries()? {
        let mut entry = entry?;
        let entry_path = entry.path()?.into_owned();
        let Some(bundle_root) = bundle_root_from_archive_path(&entry_path) else {
            continue;
        };

        if !is_bundle_info_plist_path(&entry_path, &bundle_root) {
            continue;
        }

        let mut plist_bytes = Vec::new();
        entry.read_to_end(&mut plist_bytes)?;
        let dictionary = plist::from_reader::<_, Dictionary>(Cursor::new(plist_bytes)).map_err(|error| {
            AppError::message(format!(
                "Could not parse macOS bundle metadata from archived {}: {}",
                entry_path.display(),
                error
            ))
        })?;
        return Ok(bundle_info_from_dictionary(bundle_root, dictionary));
    }

    Err(AppError::message(
        "The downloaded macOS updater bundle is missing Contents/Info.plist.",
    ))
}

#[cfg(target_os = "macos")]
fn current_macos_bundle_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let current_binary = tauri::process::current_binary(&app.env()).map_err(|error| {
        AppError::message(format!(
            "Could not resolve the current app executable path: {}",
            error
        ))
    })?;
    log::info!(
        "updater install: current executable path={}",
        current_binary.display()
    );
    extract_path_from_executable(&current_binary).map_err(|error| {
        AppError::message(format!(
            "Could not resolve the installed app bundle path from {}: {}",
            current_binary.display(),
            error
        ))
    })
}

#[cfg(target_os = "macos")]
fn verify_downloaded_macos_bundle(bytes: &[u8], snapshot: &AppUpdateSnapshot) -> Result<MacosBundleInfo, AppError> {
    let archived_bundle = read_macos_bundle_info_from_archive(bytes)?;
    log::info!(
        "updater install: downloaded macOS archive bundle_path={} short_version={:?} build_version={:?}",
        archived_bundle.bundle_path.display(),
        archived_bundle.short_version,
        archived_bundle.build_version
    );

    let expected_version = snapshot.latest_version.as_deref();
    let archived_version = archived_bundle.reported_version();
    if let (Some(expected), Some(found)) = (expected_version, archived_version) {
        if normalize_semver(expected) != normalize_semver(found) {
            return Err(AppError::message(format!(
                "The downloaded updater bundle {} contains app version {}, but the release requires {}. The published macOS updater asset is stale or misbuilt.",
                snapshot
                    .selected_asset_name
                    .as_deref()
                    .unwrap_or("macOS updater bundle"),
                found,
                expected
            )));
        }
    }

    Ok(archived_bundle)
}

#[cfg(target_os = "macos")]
fn verify_installed_macos_bundle_after_install(
    bundle_path: &Path,
    snapshot: &AppUpdateSnapshot,
    before_install: Option<&MacosBundleInfo>,
) -> Result<MacosBundleInfo, AppError> {
    let installed_bundle = read_macos_bundle_info_from_path(bundle_path)?;
    log::info!(
        "updater install: installed bundle after apply path={} short_version={:?} build_version={:?}",
        installed_bundle.bundle_path.display(),
        installed_bundle.short_version,
        installed_bundle.build_version
    );

    if let Some(expected) = snapshot.latest_version.as_deref() {
        let found = installed_bundle.reported_version().ok_or_else(|| {
            AppError::message(format!(
                "The updated app bundle at {} does not declare a bundle version after install.",
                bundle_path.display()
            ))
        })?;

        if normalize_semver(expected) != normalize_semver(found) {
            return Err(AppError::message(format!(
                "The updater applied {}, but the installed app at {} still reports version {} instead of {}.",
                snapshot
                    .selected_asset_name
                    .as_deref()
                    .unwrap_or("the downloaded updater bundle"),
                bundle_path.display(),
                found,
                expected
            )));
        }
    } else if let Some(previous_bundle) = before_install {
        if installed_bundle.reported_version() == previous_bundle.reported_version() {
            return Err(AppError::message(format!(
                "The updater finished, but the installed app at {} still reports version {}. The app bundle did not change.",
                bundle_path.display(),
                installed_bundle.reported_version().unwrap_or("unknown")
            )));
        }
    }

    Ok(installed_bundle)
}

#[cfg(target_os = "macos")]
fn relaunch_installed_macos_bundle(app: &AppHandle, bundle: &MacosBundleInfo) -> Result<(), AppError> {
    let executable_name = bundle.executable_name.as_deref().ok_or_else(|| {
        AppError::message(format!(
            "The updated app bundle at {} is missing CFBundleExecutable.",
            bundle.bundle_path.display()
        ))
    })?;
    let executable_path = bundle
        .bundle_path
        .join("Contents")
        .join("MacOS")
        .join(executable_name);

    log::info!(
        "updater install: relaunching installed macOS app executable={}",
        executable_path.display()
    );

    app.cleanup_before_exit();
    std::process::Command::new(&executable_path)
        .args(std::env::args_os().skip(1))
        .spawn()
        .map_err(|error| {
            AppError::message(format!(
                "Could not relaunch the updated app from {}: {}",
                executable_path.display(),
                error
            ))
        })?;

    std::process::exit(0);
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

    log::info!(
        "updater download: current_version={} latest_version={} target={} asset={:?} reason={:?}",
        snapshot.current_version,
        snapshot.latest_version.as_deref().unwrap_or("unknown"),
        update.target,
        snapshot.selected_asset_name,
        snapshot.selected_asset_reason
    );

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
    let snapshot = update_snapshot_or_default(&app, latest_snapshot);

    log::info!(
        "updater install: begin current_version={} latest_version={:?} asset={:?}",
        snapshot.current_version,
        snapshot.latest_version,
        snapshot.selected_asset_name
    );

    #[cfg(target_os = "macos")]
    let bundle_path = current_macos_bundle_path(&app).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let bundle_before_install = read_macos_bundle_info_from_path(&bundle_path)
        .map(Some)
        .or_else(|error| {
            log::warn!(
                "updater install: could not read installed bundle metadata before install from {}: {}",
                bundle_path.display(),
                error
            );
            Ok::<Option<MacosBundleInfo>, AppError>(None)
        })
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let _downloaded_bundle =
        verify_downloaded_macos_bundle(bytes.as_slice(), &snapshot).map_err(|error| {
            clear_pending_download(&app);
            log::error!("updater install: downloaded bundle verification failed: {}", error);
            error.to_string()
        })?;

    update.install(bytes.as_slice()).map_err(|error| {
        clear_pending_download(&app);
        log::error!("updater install: apply failed: {}", error);
        error.to_string()
    })?;

    log::info!("updater install: apply completed");

    #[cfg(target_os = "macos")]
    let installed_bundle = verify_installed_macos_bundle_after_install(
        &bundle_path,
        &snapshot,
        bundle_before_install.as_ref(),
    )
    .map_err(|error| {
        clear_pending_download(&app);
        log::error!("updater install: post-install verification failed: {}", error);
        error.to_string()
    })?;

    clear_pending_download(&app);

    #[cfg(target_os = "windows")]
    {
        return Ok(snapshot);
    }

    #[cfg(target_os = "macos")]
    {
        relaunch_installed_macos_bundle(&app, &installed_bundle).map_err(|error| {
            log::error!("updater install: relaunch failed: {}", error);
            error.to_string()
        })?;
        unreachable!("macOS relaunch exits the current process");
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
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

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use tar::Builder;

    fn plist_contents(version: &str, build: &str, executable: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>{}</string>
  <key>CFBundleShortVersionString</key>
  <string>{}</string>
  <key>CFBundleVersion</key>
  <string>{}</string>
</dict>
</plist>"#,
            executable, version, build
        )
    }

    fn macos_archive_with_info_plist(version: &str, build: &str) -> Vec<u8> {
        let plist = plist_contents(version, build, "app");
        let encoder = GzEncoder::new(Vec::new(), Compression::default());
        let mut builder = Builder::new(encoder);

        let mut header = tar::Header::new_gnu();
        header.set_mode(0o644);
        header.set_size(plist.len() as u64);
        header.set_cksum();
        builder
            .append_data(
                &mut header,
                "OBS Plugin Installer.app/Contents/Info.plist",
                plist.as_bytes(),
            )
            .expect("append plist");

        let encoder = builder.into_inner().expect("builder into inner");
        encoder.finish().expect("finish archive")
    }

    #[test]
    fn reads_macos_bundle_version_from_archive() {
        let archive = macos_archive_with_info_plist("0.48.0", "48",);
        let bundle = read_macos_bundle_info_from_archive(&archive).expect("bundle info");

        assert_eq!(bundle.bundle_path, PathBuf::from("OBS Plugin Installer.app"));
        assert_eq!(bundle.executable_name.as_deref(), Some("app"));
        assert_eq!(bundle.short_version.as_deref(), Some("0.48.0"));
        assert_eq!(bundle.build_version.as_deref(), Some("48"));
        assert_eq!(bundle.reported_version(), Some("0.48.0"));
    }

    #[test]
    fn detects_bundle_root_from_archive_path() {
        let path = PathBuf::from("OBS Plugin Installer.app/Contents/MacOS/app");
        assert_eq!(
            bundle_root_from_archive_path(&path),
            Some(PathBuf::from("OBS Plugin Installer.app"))
        );
    }
}
