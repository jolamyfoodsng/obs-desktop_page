use std::path::PathBuf;

use rfd::FileDialog;
use tauri::AppHandle;

use crate::commands::store::{load_state, save_state};
use crate::commands::validate_obs::{
    candidate_paths, detection_from_resolved, not_found_detection, unsupported_detection,
    validate_obs_path, ResolvedObsLocation,
};
use crate::models::plugin::SupportedPlatform;
use crate::models::state::{AppSettings, ObsDetectionState};

fn not_found_message() -> String {
    match SupportedPlatform::current() {
    SupportedPlatform::Windows => {
      "OBS Studio was not found in common Windows locations. Choose the folder that contains your obs-studio install."
        .to_string()
    }
    SupportedPlatform::Macos => {
      "OBS.app was not found in /Applications or ~/Applications. Choose OBS.app manually to continue."
        .to_string()
    }
    SupportedPlatform::Linux => {
      "OBS Studio was not found in the common native Linux locations this MVP supports. Choose /usr, /usr/local, or ~/.config/obs-studio manually to continue."
        .to_string()
    }
  }
}

pub fn apply_saved_install_scope(
    mut resolved: ResolvedObsLocation,
    settings: &AppSettings,
) -> ResolvedObsLocation {
    if SupportedPlatform::current() != SupportedPlatform::Windows {
        return resolved;
    }

    if resolved.validation_kind != "windows-standard" {
        return resolved;
    }

    if settings.install_scope == "user" {
        if let Some(data_dir) = dirs::data_dir() {
            resolved.install_target_path = data_dir.join("obs-studio").join("plugins");
            resolved.install_target_label = "OBS user plugin folder".to_string();
            resolved.message =
                "OBS Studio is ready for one-click installs in your user profile.".to_string();
        }
    }

    resolved
}

pub fn detect_obs_installation(app: &AppHandle, settings: &AppSettings) -> ObsDetectionState {
    let stored_path = settings.obs_path.clone();
    let mut checked_paths = Vec::new();

    if let Some(stored_path) = stored_path.clone() {
        let stored_path_buf = PathBuf::from(&stored_path);
        checked_paths.push(stored_path.clone());

        if let Ok(resolved) = validate_obs_path(&stored_path_buf) {
            let resolved = apply_saved_install_scope(resolved, settings);
            return detection_from_resolved(Some(stored_path), &resolved, checked_paths);
        }
    }

    for candidate in candidate_paths(app) {
        let candidate_display = candidate.display().to_string();
        if checked_paths.contains(&candidate_display) {
            continue;
        }

        checked_paths.push(candidate_display);

        if let Ok(resolved) = validate_obs_path(&candidate) {
            let resolved = apply_saved_install_scope(resolved, settings);
            return detection_from_resolved(None, &resolved, checked_paths);
        }
    }

    let detection = not_found_detection(not_found_message(), checked_paths.clone());
    if !detection.is_supported {
        unsupported_detection(detection.message, checked_paths)
    } else {
        detection
    }
}

pub fn persist_obs_path(app: &AppHandle, input_path: PathBuf) -> Result<ObsDetectionState, String> {
    let mut state = load_state(app).map_err(|error| error.to_string())?;
    let resolved = validate_obs_path(&input_path).map_err(|error| error.to_string())?;
    let resolved = apply_saved_install_scope(resolved, &state.settings);

    state.settings.obs_path = Some(resolved.selected_path.display().to_string());
    state.settings.setup_completed = true;

    save_state(app, &state).map_err(|error| error.to_string())?;

    Ok(detection_from_resolved(
        state.settings.obs_path.clone(),
        &resolved,
        vec![resolved.selected_path.display().to_string()],
    ))
}

#[tauri::command]
pub fn detect_obs(app: AppHandle) -> Result<ObsDetectionState, String> {
    let state = load_state(&app).map_err(|error| error.to_string())?;
    Ok(detect_obs_installation(&app, &state.settings))
}

#[tauri::command]
pub fn choose_obs_directory(app: AppHandle) -> Result<ObsDetectionState, String> {
    let Some(selected_path) = FileDialog::new().pick_folder() else {
        let state = load_state(&app).map_err(|error| error.to_string())?;
        return Ok(detect_obs_installation(&app, &state.settings));
    };

    persist_obs_path(&app, selected_path)
}

#[tauri::command]
pub fn save_obs_path(app: AppHandle, path: String) -> Result<ObsDetectionState, String> {
    persist_obs_path(&app, PathBuf::from(path))
}

#[tauri::command]
pub fn validate_obs_path_command(path: String) -> Result<ObsDetectionState, String> {
    let resolved = validate_obs_path(&PathBuf::from(&path)).map_err(|error| error.to_string())?;
    let settings = AppSettings::default();
    let resolved = apply_saved_install_scope(resolved, &settings);
    Ok(detection_from_resolved(
        Some(resolved.selected_path.display().to_string()),
        &resolved,
        vec![path],
    ))
}
