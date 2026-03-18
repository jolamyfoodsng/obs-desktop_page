use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::models::state::{InstallHistoryEntry, PersistedState};
use crate::utils::errors::AppError;

fn state_file_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let config_dir = app.path().app_config_dir()?;
    Ok(config_dir.join("state.json"))
}

fn legacy_state_file_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(home_dir) = dirs::home_dir() {
        candidates.push(
            home_dir
                .join("Library")
                .join("Application Support")
                .join("obs-desktop")
                .join("obs-plugin-installer.json"),
        );
        candidates.push(
            home_dir
                .join(".config")
                .join("obs-desktop")
                .join("obs-plugin-installer.json"),
        );
    }

    if let Ok(app_data) = std::env::var("APPDATA") {
        candidates.push(
            PathBuf::from(app_data.clone())
                .join("obs-desktop")
                .join("config.json"),
        );
        candidates.push(
            PathBuf::from(app_data)
                .join("obs-desktop")
                .join("obs-plugin-installer.json"),
        );
    }

    candidates
}

fn backup_corrupt_state(path: &Path) {
    let backup_path = path.with_extension("invalid.json");
    let _ = fs::rename(path, backup_path);
}

fn parse_state_file(path: &Path) -> Result<Option<PersistedState>, AppError> {
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path)?;
    match serde_json::from_str(&contents) {
        Ok(state) => Ok(Some(state)),
        Err(error) => {
            eprintln!(
                "Ignoring unreadable desktop state at {}: {}",
                path.display(),
                error
            );
            backup_corrupt_state(path);
            Ok(None)
        }
    }
}

pub fn load_state(app: &AppHandle) -> Result<PersistedState, AppError> {
    let state_path = state_file_path(app)?;

    if let Some(state) = parse_state_file(&state_path)? {
        return Ok(state);
    }

    for legacy_path in legacy_state_file_paths() {
        let Some(state) = parse_state_file(&legacy_path)? else {
            continue;
        };

        if let Err(error) = save_state(app, &state) {
            eprintln!(
        "Loaded legacy desktop state from {} but could not persist it to the new location: {}",
        legacy_path.display(),
        error
      );
        } else {
            eprintln!(
                "Migrated legacy desktop state from {}.",
                legacy_path.display()
            );
        }

        return Ok(state);
    }

    Ok(PersistedState::default())
}

pub fn save_state(app: &AppHandle, state: &PersistedState) -> Result<(), AppError> {
    let state_path = state_file_path(app)?;

    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(state_path, serde_json::to_string_pretty(state)?)?;
    Ok(())
}

pub fn push_install_history(state: &mut PersistedState, entry: InstallHistoryEntry) {
    state.install_history.push(entry);

    const MAX_HISTORY_ENTRIES: usize = 200;
    if state.install_history.len() > MAX_HISTORY_ENTRIES {
        let overflow = state.install_history.len() - MAX_HISTORY_ENTRIES;
        state.install_history.drain(0..overflow);
    }
}
