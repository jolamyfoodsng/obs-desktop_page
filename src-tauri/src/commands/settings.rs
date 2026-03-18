use std::fs;
use std::path::{Component, Path, PathBuf};

use chrono::Utc;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::commands::detect_obs::detect_obs_installation;
use crate::commands::store::{load_state, push_install_history, save_state};
use crate::models::state::{
    AppSettings, DesktopActionResponse, InstallHistoryAction, InstallHistoryEntry,
    InstalledPluginRecord, InstalledPluginSourceType, PersistedState, UninstallResponse,
};
use crate::utils::errors::AppError;

pub fn sync_autostart_setting(app: &AppHandle, launch_on_startup: bool) -> Result<(), AppError> {
    let manager = app.autolaunch();

    if launch_on_startup {
        manager
            .enable()
            .map_err(|error| AppError::message(format!("Could not enable launch on startup: {}", error)))?;
    } else {
        manager
            .disable()
            .map_err(|error| AppError::message(format!("Could not disable launch on startup: {}", error)))?;
    }

    Ok(())
}

fn first_available_directory(app: &AppHandle) -> Result<PathBuf, AppError> {
    let candidates = [
        app.path().download_dir().ok(),
        app.path().desktop_dir().ok(),
        app.path().document_dir().ok(),
        app.path().app_log_dir().ok(),
        app.path().app_config_dir().ok(),
    ];

    candidates
        .into_iter()
        .flatten()
        .next()
        .ok_or_else(|| AppError::message("Could not resolve a writable export directory on this device."))
}

fn remove_directory_contents(path: &Path) -> Result<usize, AppError> {
    if !path.exists() {
        return Ok(0);
    }

    let mut removed = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            fs::remove_dir_all(&entry_path)?;
        } else {
            fs::remove_file(&entry_path)?;
        }
        removed += 1;
    }

    Ok(removed)
}

fn collect_log_payloads(app: &AppHandle) -> Vec<serde_json::Value> {
    let Ok(log_dir) = app.path().app_log_dir() else {
        return Vec::new();
    };

    let Ok(entries) = fs::read_dir(log_dir) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }

            let Ok(contents) = fs::read_to_string(&path) else {
                return None;
            };

            Some(json!({
                "path": path.display().to_string(),
                "contents": contents,
            }))
        })
        .collect()
}

fn tracked_relative_path(relative_path: &str) -> Option<&Path> {
    let candidate = Path::new(relative_path);

    if candidate.is_absolute() {
        return None;
    }

    if candidate.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    }) {
        return None;
    }

    Some(candidate)
}

fn resolve_tracked_path(record: &InstalledPluginRecord, relative_path: &str) -> Option<(PathBuf, PathBuf)> {
    let relative_path = tracked_relative_path(relative_path)?;
    let install_root = PathBuf::from(&record.install_location);
    let primary = install_root.join(relative_path);

    if primary.exists() {
        return Some((primary, install_root));
    }

    if record.source_type == InstalledPluginSourceType::Script {
        if let Some(parent) = install_root.parent() {
            let fallback_root = parent.to_path_buf();
            let fallback = fallback_root.join(relative_path);
            if fallback.exists() {
                return Some((fallback, fallback_root));
            }
        }
    }

    None
}

fn prune_empty_directories(start: &Path, stop_at: &Path) -> Result<usize, AppError> {
    let mut current = start.to_path_buf();
    let mut removed = 0;

    while current.starts_with(stop_at) && current != stop_at {
        if !current.exists() {
            let Some(parent) = current.parent() else {
                break;
            };
            current = parent.to_path_buf();
            continue;
        }

        let mut entries = fs::read_dir(&current)?;
        if entries.next().is_some() {
            break;
        }

        fs::remove_dir(&current)?;
        removed += 1;

        let Some(parent) = current.parent() else {
            break;
        };
        current = parent.to_path_buf();
    }

    Ok(removed)
}

fn can_safely_uninstall(record: &InstalledPluginRecord) -> bool {
    !(record.installed_files.is_empty()
        && matches!(
            record.source_type,
            InstalledPluginSourceType::ExternalInstaller | InstalledPluginSourceType::Manual
        ))
}

#[tauri::command]
pub fn save_app_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    sync_autostart_setting(&app, settings.launch_on_startup).map_err(|error| error.to_string())?;

    let mut state = load_state(&app).map_err(|error| error.to_string())?;
    state.settings = settings.clone();
    save_state(&app, &state).map_err(|error| error.to_string())?;

    Ok(settings)
}

#[tauri::command]
pub fn clear_app_cache(app: AppHandle) -> Result<DesktopActionResponse, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|error| error.to_string())?;

    if let Some(parent) = cache_dir.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let removed = remove_directory_contents(&cache_dir).map_err(|error| error.to_string())?;

    Ok(DesktopActionResponse {
        message: if removed == 0 {
            "The app cache was already empty.".to_string()
        } else {
            format!("Cleared {} cached item{}.", removed, if removed == 1 { "" } else { "s" })
        },
        path: Some(cache_dir.display().to_string()),
        count: Some(removed),
    })
}

#[tauri::command]
pub fn export_logs(app: AppHandle) -> Result<DesktopActionResponse, String> {
    let export_dir = first_available_directory(&app).map_err(|error| error.to_string())?;
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;

    let state = load_state(&app).map_err(|error| error.to_string())?;
    let detection = detect_obs_installation(&app, &state.settings);
    let export_path = export_dir.join(format!(
        "obs-plugin-installer-diagnostics-{}.json",
        Utc::now().format("%Y%m%d-%H%M%S")
    ));
    let log_files = collect_log_payloads(&app);
    let installed_plugins = state
        .installed_plugins
        .values()
        .cloned()
        .collect::<Vec<_>>();

    let payload = json!({
        "exportedAt": Utc::now().to_rfc3339(),
        "settings": state.settings,
        "obsDetection": detection,
        "installedPlugins": installed_plugins,
        "installHistory": state.install_history,
        "logFiles": log_files,
    });

    fs::write(&export_path, serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;

    Ok(DesktopActionResponse {
        message: "Diagnostics were exported successfully.".to_string(),
        path: Some(export_path.display().to_string()),
        count: Some(payload["logFiles"].as_array().map_or(0, |files| files.len())),
    })
}

#[tauri::command]
pub fn reset_app_state(app: AppHandle) -> Result<DesktopActionResponse, String> {
    let current_state = load_state(&app).map_err(|error| error.to_string())?;
    if current_state.settings.launch_on_startup {
        sync_autostart_setting(&app, false).map_err(|error| error.to_string())?;
    }

    let default_state = PersistedState::default();
    save_state(&app, &default_state).map_err(|error| error.to_string())?;

    let cache_dir = app.path().app_cache_dir().map_err(|error| error.to_string())?;
    let removed = remove_directory_contents(&cache_dir).map_err(|error| error.to_string())?;
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let _ = fs::remove_dir_all(app_data_dir.join("install-backups"));
    }

    Ok(DesktopActionResponse {
        message: "App settings and tracked install history were reset. Existing OBS files were left untouched.".to_string(),
        path: Some(cache_dir.display().to_string()),
        count: Some(removed),
    })
}

#[tauri::command]
pub fn uninstall_plugin(app: AppHandle, plugin_id: String) -> Result<UninstallResponse, String> {
    let mut state = load_state(&app).map_err(|error| error.to_string())?;
    let Some(record) = state.installed_plugins.get(&plugin_id).cloned() else {
        return Err("That plugin is not currently tracked as installed.".to_string());
    };

    if !can_safely_uninstall(&record) {
        return Err(
            "This install was completed through an external or manual flow, so the app cannot safely remove it automatically. Use the vendor uninstaller or remove it from OBS manually."
                .to_string(),
        );
    }

    let mut removed_files = 0usize;
    let mut removed_directories = 0usize;

    for relative_path in &record.installed_files {
        let Some((existing_path, cleanup_root)) = resolve_tracked_path(&record, relative_path) else {
            continue;
        };

        if existing_path.is_dir() {
            fs::remove_dir_all(&existing_path).map_err(|error| {
                format!(
                    "Could not remove {}: {}",
                    existing_path.display(),
                    error
                )
            })?;
        } else {
            fs::remove_file(&existing_path).map_err(|error| {
                format!(
                    "Could not remove {}: {}",
                    existing_path.display(),
                    error
                )
            })?;
        }
        removed_files += 1;

        if let Some(parent) = existing_path.parent() {
            removed_directories +=
                prune_empty_directories(parent, &cleanup_root).map_err(|error| error.to_string())?;
        }
    }

    push_install_history(
        &mut state,
        InstallHistoryEntry {
            plugin_id: record.plugin_id.clone(),
            plugin_name: record.plugin_id.clone(),
            version: Some(record.installed_version.clone()),
            action: InstallHistoryAction::Uninstall,
            managed: record.managed,
            install_location: Some(record.install_location.clone()),
            message: if removed_files == 0 {
                "Tracked install record removed after uninstall; files were already missing."
                    .to_string()
            } else {
                format!("Removed {} tracked file(s) from the OBS install.", removed_files)
            },
            timestamp: Utc::now().to_rfc3339(),
            file_count: removed_files,
            backup_root: record.backup.as_ref().map(|backup| backup.backup_root.clone()),
            verification_status: record.verification_status.clone(),
        },
    );
    if let Some(backup_root) = record.backup.as_ref().map(|backup| backup.backup_root.clone()) {
        let _ = fs::remove_dir_all(backup_root);
    }
    state.installed_plugins.remove(&plugin_id);
    save_state(&app, &state).map_err(|error| error.to_string())?;

    let message = if removed_files == 0 {
        "The tracked install record was removed. No files were deleted because they were already missing.".to_string()
    } else {
        format!(
            "Removed {} tracked file{} and cleaned up {} folder{}.",
            removed_files,
            if removed_files == 1 { "" } else { "s" },
            removed_directories,
            if removed_directories == 1 { "" } else { "s" }
        )
    };

    Ok(UninstallResponse {
        success: true,
        message,
        removed_files,
        removed_directories,
    })
}
