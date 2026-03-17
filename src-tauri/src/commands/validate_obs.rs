use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use regex::Regex;
use tauri::AppHandle;

use crate::models::plugin::SupportedPlatform;
use crate::models::state::ObsDetectionState;
use crate::utils::errors::AppError;

#[derive(Debug, Clone)]
pub struct ResolvedObsLocation {
    pub selected_path: PathBuf,
    pub install_target_path: PathBuf,
    pub install_target_label: String,
    pub validation_kind: String,
    pub is_supported: bool,
    pub message: String,
    pub obs_version: Option<String>,
}

fn extract_version(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let matched = Regex::new(r"(\d+(?:\.\d+){1,3})")
        .ok()?
        .captures(trimmed)?
        .get(1)?
        .as_str()
        .to_string();
    Some(matched)
}

fn detect_windows_obs_version(root: &Path) -> Option<String> {
    let executable = if root.join("bin").join("64bit").join("obs64.exe").exists() {
        root.join("bin").join("64bit").join("obs64.exe")
    } else if root.join("bin").join("32bit").join("obs32.exe").exists() {
        root.join("bin").join("32bit").join("obs32.exe")
    } else {
        return None;
    };

    let escaped = executable.display().to_string().replace('\'', "''");
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("(Get-Item -LiteralPath '{}').VersionInfo.ProductVersion", escaped),
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    extract_version(&String::from_utf8_lossy(&output.stdout))
}

fn detect_macos_obs_version(app_bundle: &Path) -> Option<String> {
    let info_plist = app_bundle.join("Contents").join("Info.plist");
    let contents = fs::read_to_string(info_plist).ok()?;
    let short_version = Regex::new(
        r"<key>CFBundleShortVersionString</key>\s*<string>([^<]+)</string>",
    )
    .ok()?
    .captures(&contents)
    .and_then(|captures| captures.get(1))
    .map(|value| value.as_str().to_string());

    short_version.and_then(|value| extract_version(&value).or(Some(value)))
}

fn detect_linux_obs_version(root: &Path) -> Option<String> {
    let executable = if root.join("bin").join("obs").exists() {
        root.join("bin").join("obs")
    } else {
        PathBuf::from("obs")
    };

    let output = Command::new(executable).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    extract_version(&String::from_utf8_lossy(&output.stdout))
}

fn detect_obs_version(path: &Path) -> Option<String> {
    match SupportedPlatform::current() {
        SupportedPlatform::Windows => detect_windows_obs_version(path),
        SupportedPlatform::Macos => detect_macos_obs_version(path),
        SupportedPlatform::Linux => detect_linux_obs_version(path),
    }
}

fn path_exists(path: &Path) -> bool {
    path.exists()
}

fn has_file(path: &Path, segments: &[&str]) -> bool {
    path.join(segments.iter().collect::<PathBuf>()).exists()
}

fn normalize(path: &Path) -> Result<PathBuf, AppError> {
    Ok(fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()))
}

fn home_dir() -> Result<PathBuf, AppError> {
    dirs::home_dir().ok_or_else(|| AppError::message("Home directory could not be resolved."))
}

fn validate_windows_path(input: &Path) -> Result<ResolvedObsLocation, AppError> {
    let normalized = normalize(input)?;
    let mut candidates = vec![normalized.clone()];

    let mut current = normalized.as_path();
    while let Some(parent) = current.parent() {
        candidates.push(parent.to_path_buf());
        current = parent;
    }

    for candidate in candidates {
        if has_file(&candidate, &["bin", "64bit", "obs64.exe"])
            || has_file(&candidate, &["bin", "32bit", "obs32.exe"])
        {
            let portable_plugins_dir = candidate.join("data").join("plugins");
            let legacy_portable_dir = candidate.join("data").join("obs-plugins");
            let is_portable = candidate.join("portable_mode.txt").exists()
                || portable_plugins_dir.exists()
                || legacy_portable_dir.exists();

            let install_target_path = if is_portable {
                portable_plugins_dir
            } else if let Ok(program_data) = env::var("ProgramData") {
                PathBuf::from(program_data)
                    .join("obs-studio")
                    .join("plugins")
            } else {
                portable_plugins_dir
            };

            let install_target_label = if is_portable {
                "Portable OBS plugin folder".to_string()
            } else {
                "Shared OBS plugin folder".to_string()
            };

            let message = if is_portable {
                "OBS Studio was validated in a portable or custom layout."
            } else {
                "OBS Studio is ready for one-click installs."
            };
            let obs_version = detect_obs_version(&candidate);

            return Ok(ResolvedObsLocation {
                selected_path: candidate,
                install_target_path,
                install_target_label,
                validation_kind: if is_portable {
                    "windows-portable".to_string()
                } else {
                    "windows-standard".to_string()
                },
                is_supported: true,
                message: message.to_string(),
                obs_version,
            });
        }
    }

    Err(AppError::invalid_path(
        input,
        "expected a folder containing OBS binaries such as bin/64bit/obs64.exe",
    ))
}

fn validate_macos_path(input: &Path) -> Result<ResolvedObsLocation, AppError> {
    let normalized = normalize(input)?;
    let mut candidates = vec![normalized.clone()];

    let mut current = normalized.as_path();
    while let Some(parent) = current.parent() {
        candidates.push(parent.to_path_buf());
        current = parent;
    }

    for candidate in candidates {
        if candidate.extension().and_then(|value| value.to_str()) == Some("app")
            && has_file(&candidate, &["Contents", "MacOS", "OBS"])
        {
            let install_target_path = home_dir()?
                .join("Library")
                .join("Application Support")
                .join("obs-studio")
                .join("plugins");
            let obs_version = detect_obs_version(&candidate);

            return Ok(ResolvedObsLocation {
                selected_path: candidate,
                install_target_path,
                install_target_label: "OBS user plugin folder".to_string(),
                validation_kind: "macos-app-bundle".to_string(),
                is_supported: true,
                message:
                    "OBS.app was found and macOS plugin installs can target your user plugin folder."
                        .to_string(),
                obs_version,
            });
        }
    }

    let support_dir = home_dir()?
        .join("Library")
        .join("Application Support")
        .join("obs-studio");

    if normalized == support_dir || normalized == support_dir.join("plugins") {
        return Ok(ResolvedObsLocation {
            selected_path: support_dir.clone(),
            install_target_path: support_dir.join("plugins"),
            install_target_label: "OBS user plugin folder".to_string(),
            validation_kind: "macos-support-root".to_string(),
            is_supported: true,
            message: "OBS support files were validated and the user plugin folder is ready."
                .to_string(),
            obs_version: detect_obs_version(&normalized),
        });
    }

    Err(AppError::invalid_path(
        input,
        "expected OBS.app or the obs-studio support folder in Library/Application Support",
    ))
}

fn validate_linux_path(input: &Path) -> Result<ResolvedObsLocation, AppError> {
    let normalized = normalize(input)?;
    let config_root = home_dir()?.join(".config").join("obs-studio");

    if normalized == config_root || normalized == config_root.join("plugins") {
        return Ok(ResolvedObsLocation {
            selected_path: config_root.clone(),
            install_target_path: config_root.join("plugins"),
            install_target_label: "OBS user plugin folder".to_string(),
            validation_kind: "linux-config-root".to_string(),
            is_supported: true,
            message: "OBS user config was validated and the native plugin folder is ready."
                .to_string(),
            obs_version: detect_obs_version(&normalized),
        });
    }

    let native_roots = [PathBuf::from("/usr"), PathBuf::from("/usr/local")];

    for root in native_roots {
        if normalized == root || normalized.starts_with(&root) {
            if root.join("bin").join("obs").exists() {
                return Ok(ResolvedObsLocation {
                    selected_path: root.clone(),
                    install_target_path: config_root.join("plugins"),
                    install_target_label: "OBS user plugin folder".to_string(),
                    validation_kind: "linux-native".to_string(),
                    is_supported: true,
                    message: "Native OBS installation detected. The app will use the user plugin directory in ~/.config/obs-studio/plugins.".to_string(),
                    obs_version: detect_obs_version(&root),
                });
            }
        }
    }

    let flatpak_root = home_dir()?
        .join(".var")
        .join("app")
        .join("com.obsproject.Studio");
    if normalized == flatpak_root || normalized.starts_with(&flatpak_root) {
        return Ok(ResolvedObsLocation {
            selected_path: flatpak_root.clone(),
            install_target_path: flatpak_root
                .join("config")
                .join("obs-studio")
                .join("plugins"),
            install_target_label: "Flatpak OBS config".to_string(),
            validation_kind: "linux-flatpak".to_string(),
            is_supported: false,
            message: "Flatpak OBS was detected, but this MVP only automates common native Linux installs. Guided/manual packages are still available."
                .to_string(),
            obs_version: None,
        });
    }

    Err(AppError::invalid_path(
        input,
        "expected /usr, /usr/local, ~/.config/obs-studio, or a native OBS folder",
    ))
}

pub fn validate_obs_path(input: &Path) -> Result<ResolvedObsLocation, AppError> {
    match SupportedPlatform::current() {
        SupportedPlatform::Windows => validate_windows_path(input),
        SupportedPlatform::Macos => validate_macos_path(input),
        SupportedPlatform::Linux => validate_linux_path(input),
    }
}

pub fn detection_from_resolved(
    stored_path: Option<String>,
    resolved: &ResolvedObsLocation,
    checked_paths: Vec<String>,
) -> ObsDetectionState {
    ObsDetectionState {
        platform: SupportedPlatform::current().as_str().to_string(),
        stored_path,
        detected_path: Some(resolved.selected_path.display().to_string()),
        obs_version: resolved.obs_version.clone(),
        install_target_path: Some(resolved.install_target_path.display().to_string()),
        install_target_label: Some(resolved.install_target_label.clone()),
        validation_kind: Some(resolved.validation_kind.clone()),
        is_valid: true,
        is_supported: resolved.is_supported,
        requires_manual_selection: !resolved.is_supported,
        message: resolved.message.clone(),
        checked_paths,
    }
}

pub fn not_found_detection(message: String, checked_paths: Vec<String>) -> ObsDetectionState {
    ObsDetectionState {
        platform: SupportedPlatform::current().as_str().to_string(),
        stored_path: None,
        detected_path: None,
        obs_version: None,
        install_target_path: None,
        install_target_label: None,
        validation_kind: None,
        is_valid: false,
        is_supported: true,
        requires_manual_selection: true,
        message,
        checked_paths,
    }
}

pub fn unsupported_detection(message: String, checked_paths: Vec<String>) -> ObsDetectionState {
    ObsDetectionState {
        platform: SupportedPlatform::current().as_str().to_string(),
        stored_path: None,
        detected_path: None,
        obs_version: None,
        install_target_path: None,
        install_target_label: None,
        validation_kind: None,
        is_valid: false,
        is_supported: false,
        requires_manual_selection: true,
        message,
        checked_paths,
    }
}

pub fn candidate_paths(_app: &AppHandle) -> Vec<PathBuf> {
    match SupportedPlatform::current() {
        SupportedPlatform::Windows => {
            let mut candidates = Vec::new();

            if let Ok(program_w6432) = env::var("ProgramW6432") {
                candidates.push(PathBuf::from(program_w6432).join("obs-studio"));
            }
            if let Ok(program_files) = env::var("ProgramFiles") {
                candidates.push(PathBuf::from(program_files).join("obs-studio"));
            }
            if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
                candidates.push(PathBuf::from(program_files_x86).join("obs-studio"));
            }
            if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
                candidates.push(
                    PathBuf::from(local_app_data)
                        .join("Programs")
                        .join("obs-studio"),
                );
            }

            candidates
        }
        SupportedPlatform::Macos => vec![
            PathBuf::from("/Applications/OBS.app"),
            home_dir()
                .map(|path| path.join("Applications").join("OBS.app"))
                .unwrap_or_else(|_| PathBuf::from("/Applications/OBS.app")),
        ],
        SupportedPlatform::Linux => {
            let mut candidates = vec![
                PathBuf::from("/usr"),
                PathBuf::from("/usr/local"),
                home_dir()
                    .map(|path| path.join(".config").join("obs-studio"))
                    .unwrap_or_else(|_| PathBuf::from("/usr")),
            ];

            if let Ok(path_env) = env::var("PATH") {
                for entry in env::split_paths(&path_env) {
                    if path_exists(&entry.join("obs")) {
                        if let Some(parent) = entry.parent() {
                            candidates.push(parent.to_path_buf());
                        } else {
                            candidates.push(entry);
                        }
                    }
                }
            }

            if let Ok(home) = home_dir() {
                candidates.push(home.join(".var").join("app").join("com.obsproject.Studio"));
            }

            candidates
        }
    }
}
