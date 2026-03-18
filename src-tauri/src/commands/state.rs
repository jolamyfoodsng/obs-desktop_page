use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use chrono::Utc;
use tauri::AppHandle;
use walkdir::WalkDir;

use crate::commands::detect_obs::{apply_saved_install_scope, detect_obs_installation};
use crate::commands::install_plugin::managed_script_root;
use crate::commands::store::{load_state, push_install_history, save_state};
use crate::commands::validate_obs::validate_obs_path;
use crate::models::plugin::{PluginCatalogEntry, SupportedPlatform};
use crate::models::state::{
    BootstrapPayload, InstallHistoryAction, InstallHistoryEntry, InstallKind,
    InstallMethod, InstallVerificationStatus, InstalledPluginRecord,
    InstalledPluginSourceType, InstalledPluginStatus, PersistedState,
};
use crate::utils::catalog::load_plugin_catalog;

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

pub fn tracked_path_candidates(
    record: &InstalledPluginRecord,
    relative_path: &str,
) -> Vec<PathBuf> {
    let Some(relative_path) = tracked_relative_path(relative_path) else {
        return Vec::new();
    };

    let mut candidates = Vec::new();
    let install_root = PathBuf::from(&record.install_location);
    candidates.push(install_root.join(relative_path));

    if record.source_type == crate::models::state::InstalledPluginSourceType::Script {
        if let Some(parent) = install_root.parent() {
            let fallback = parent.join(relative_path);
            if fallback != candidates[0] {
                candidates.push(fallback);
            }
        }
    }

    candidates
}

fn refresh_installed_records(records: &mut [InstalledPluginRecord]) -> bool {
    let mut changed = false;
    let verified_at = Utc::now().to_rfc3339();

    for record in records.iter_mut() {
        let mut record_changed = false;
        if record.status == InstalledPluginStatus::ManualStep {
            let has_tracked_files = !record.installed_files.is_empty();
            let all_files_exist = has_tracked_files
                && record
                    .installed_files
                    .iter()
                    .all(|relative_path| {
                        tracked_path_candidates(record, relative_path)
                            .iter()
                            .any(|candidate| candidate.exists())
                    });

            let next_verification_status = if !has_tracked_files {
                InstallVerificationStatus::Unverified
            } else if all_files_exist {
                InstallVerificationStatus::Verified
            } else {
                InstallVerificationStatus::MissingFiles
            };

            if has_tracked_files
                && !all_files_exist
                && record.status != InstalledPluginStatus::MissingFiles
            {
                record.status = InstalledPluginStatus::MissingFiles;
                record_changed = true;
            }
            if record.verification_status != Some(next_verification_status.clone()) {
                record.verification_status = Some(next_verification_status);
                record_changed = true;
            }
            if record.last_verified_at.is_none() {
                record.last_verified_at = Some(verified_at.clone());
                record_changed = true;
            }
            changed |= record_changed;
            continue;
        }

        let all_files_exist = record
            .installed_files
            .iter()
            .all(|relative_path| {
                tracked_path_candidates(record, relative_path)
                    .iter()
                    .any(|candidate| candidate.exists())
            });

        let next_status = if all_files_exist {
            InstalledPluginStatus::Installed
        } else {
            InstalledPluginStatus::MissingFiles
        };
        let next_verification_status = if all_files_exist {
            InstallVerificationStatus::Verified
        } else {
            InstallVerificationStatus::MissingFiles
        };

        if record.status != next_status {
            record.status = next_status;
            record_changed = true;
        }
        if record.verification_status != Some(next_verification_status.clone()) {
            record.verification_status = Some(next_verification_status);
            record_changed = true;
        }
        if record_changed || record.last_verified_at.is_none() {
            record.last_verified_at = Some(verified_at.clone());
            record_changed = true;
        }
        changed |= record_changed;
    }

    changed
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ScanRootKind {
    ObsPlugin,
    Script,
}

#[derive(Clone)]
struct ScannedFileEntry {
    root_kind: ScanRootKind,
    root: PathBuf,
    relative_path: String,
    relative_lower: String,
    file_name_lower: String,
    file_stem_lower: String,
    extension_lower: Option<String>,
}

fn normalize_display_path(path: &Path) -> String {
    path.display().to_string().replace('\\', "/")
}

fn normalize_token(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn token_variants(value: &str) -> Vec<String> {
    let lowered = value.trim().to_ascii_lowercase();
    let dashed = normalize_token(&lowered);
    let underscored = dashed.replace('-', "_");
    let compact = dashed.replace('-', "");
    [lowered, dashed, underscored, compact]
        .into_iter()
        .filter(|candidate| candidate.len() >= 4)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn plugin_match_terms(plugin: &PluginCatalogEntry) -> Vec<String> {
    let mut terms = BTreeSet::new();

    for candidate in token_variants(&plugin.module_name) {
        terms.insert(candidate);
    }

    if let Some(strategy) = &plugin.install_strategy {
        for value in strategy
            .module_name_aliases
            .iter()
            .chain(strategy.binary_name_hints.iter())
            .chain(strategy.resource_dir_hints.iter())
        {
            for candidate in token_variants(value) {
                terms.insert(candidate);
            }
        }
    }

    if is_script_plugin(plugin) {
        for candidate in token_variants(&plugin.name) {
            terms.insert(candidate);
        }
    }

    terms.into_iter().collect()
}

fn is_script_plugin(plugin: &PluginCatalogEntry) -> bool {
    if plugin.category.eq_ignore_ascii_case("scripts") {
        return true;
    }

    let haystack = [
        plugin.category.as_str(),
        plugin.tagline.as_str(),
        plugin.description.as_str(),
        plugin.long_description.as_str(),
    ]
    .join(" ")
    .to_ascii_lowercase();

    haystack.contains("lua")
        || haystack.contains("python")
        || haystack.contains("obs script")
        || haystack.contains("script plugin")
        || haystack.contains("tools -> scripts")
        || haystack.contains("tools → scripts")
}

fn collect_scanned_files(root: &Path, root_kind: ScanRootKind) -> Vec<ScannedFileEntry> {
    if !root.exists() {
        return Vec::new();
    }

    WalkDir::new(root)
        .max_depth(8)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            let relative_path = entry.path().strip_prefix(root).ok()?;
            let relative_display = normalize_display_path(relative_path);
            let file_name_lower = entry.file_name().to_string_lossy().to_ascii_lowercase();
            let file_stem_lower = entry
                .path()
                .file_stem()
                .map(|value| value.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            let extension_lower = entry
                .path()
                .extension()
                .map(|value| value.to_string_lossy().to_ascii_lowercase());

            Some(ScannedFileEntry {
                root_kind,
                root: root.to_path_buf(),
                relative_path: relative_display.clone(),
                relative_lower: relative_display.to_ascii_lowercase(),
                file_name_lower,
                file_stem_lower,
                extension_lower,
            })
        })
        .collect()
}

fn script_like_extension(extension: Option<&str>) -> bool {
    matches!(extension, Some("lua" | "py"))
}

fn matches_term(entry: &ScannedFileEntry, term: &str) -> bool {
    if entry.file_stem_lower == term
        || entry.file_name_lower == term
        || entry.file_name_lower.starts_with(&format!("{term}."))
    {
        return true;
    }

    let segment_match = [
        format!("/{term}/"),
        format!("/{term}."),
        format!("_{term}."),
        format!("-{term}."),
        format!("{term}_"),
        format!("{term}-"),
    ];

    if segment_match
        .iter()
        .any(|needle| entry.relative_lower.contains(needle))
    {
        return true;
    }

    entry.relative_lower.contains(term)
}

fn detect_external_record(
    plugin: &PluginCatalogEntry,
    entries: &[ScannedFileEntry],
) -> Option<InstalledPluginRecord> {
    let terms = plugin_match_terms(plugin);
    if terms.is_empty() {
        return None;
    }

    let is_script = is_script_plugin(plugin);
    let mut matched = entries
        .iter()
        .filter(|entry| {
            if is_script {
                script_like_extension(entry.extension_lower.as_deref())
                    && terms.iter().any(|term| matches_term(entry, term))
            } else {
                entry.root_kind == ScanRootKind::ObsPlugin
                    && terms.iter().any(|term| matches_term(entry, term))
            }
        })
        .cloned()
        .collect::<Vec<_>>();

    if matched.is_empty() {
        return None;
    }

    matched.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    matched.dedup_by(|left, right| left.relative_path == right.relative_path);

    let root = matched.first()?.root.clone();
    let source_type = if is_script {
        InstalledPluginSourceType::Script
    } else {
        InstalledPluginSourceType::Archive
    };
    let status = if is_script {
        InstalledPluginStatus::ManualStep
    } else {
        InstalledPluginStatus::Installed
    };
    let download_path = if is_script {
        matched
            .first()
            .map(|entry| root.join(&entry.relative_path).display().to_string())
    } else {
        None
    };

    Some(InstalledPluginRecord {
        plugin_id: plugin.id.clone(),
        installed_version: plugin.version.clone(),
        installed_at: Utc::now().to_rfc3339(),
        managed: false,
        install_location: root.display().to_string(),
        installed_files: matched
            .into_iter()
            .map(|entry| entry.relative_path)
            .collect(),
        status,
        source_type,
        install_kind: InstallKind::Full,
        package_id: None,
        download_path,
        install_method: Some(InstallMethod::External),
        backup: None,
        verification_status: Some(InstallVerificationStatus::Verified),
        last_verified_at: Some(Utc::now().to_rfc3339()),
    })
}

fn external_scan_roots(settings: &crate::models::state::AppSettings) -> Vec<(ScanRootKind, PathBuf)> {
    let Some(obs_path) = settings.obs_path.as_ref() else {
        return Vec::new();
    };

    let Ok(resolved) = validate_obs_path(Path::new(obs_path)) else {
        return Vec::new();
    };
    let resolved = apply_saved_install_scope(resolved, settings);

    if !resolved.is_supported {
        return Vec::new();
    }

    let mut roots = Vec::new();
    roots.push((ScanRootKind::ObsPlugin, resolved.install_target_path));

    if let Ok(scripts_root) = managed_script_root(&resolved.selected_path, &resolved.validation_kind)
    {
        roots.push((ScanRootKind::Script, scripts_root));
    }

    roots
}

fn scan_external_installations(
    settings: &crate::models::state::AppSettings,
    plugins: &[PluginCatalogEntry],
) -> Vec<InstalledPluginRecord> {
    let scan_entries = external_scan_roots(settings)
        .into_iter()
        .flat_map(|(kind, root)| collect_scanned_files(&root, kind))
        .collect::<Vec<_>>();

    if scan_entries.is_empty() {
        return Vec::new();
    }

    plugins
        .iter()
        .filter(|plugin| {
            plugin.supported_platforms.is_empty()
                || plugin
                    .supported_platforms
                    .iter()
                    .any(|platform| platform == &SupportedPlatform::current())
        })
        .filter_map(|plugin| detect_external_record(plugin, &scan_entries))
        .collect()
}

fn merge_installed_records(
    tracked_records: Vec<InstalledPluginRecord>,
    external_records: Vec<InstalledPluginRecord>,
) -> Vec<InstalledPluginRecord> {
    let mut merged = tracked_records;

    for external in external_records {
        if let Some(existing) = merged
            .iter_mut()
            .find(|record| record.plugin_id == external.plugin_id)
        {
            if existing.status == InstalledPluginStatus::MissingFiles {
                existing.status = external.status;
                existing.verification_status = external.verification_status.clone();
                if existing.installed_files.is_empty() && !external.installed_files.is_empty() {
                    existing.installed_files = external.installed_files.clone();
                    existing.install_location = external.install_location.clone();
                    existing.download_path = external.download_path.clone();
                }
            } else if existing.status == InstalledPluginStatus::ManualStep
                && existing.source_type == InstalledPluginSourceType::ExternalInstaller
                && external.status == InstalledPluginStatus::Installed
            {
                existing.status = InstalledPluginStatus::Installed;
                existing.verification_status = external.verification_status.clone();
                if existing.installed_files.is_empty() && !external.installed_files.is_empty() {
                    existing.installed_files = external.installed_files.clone();
                    existing.install_location = external.install_location.clone();
                }
            }
            continue;
        }

        merged.push(external);
    }

    merged.sort_by(|left, right| left.plugin_id.cmp(&right.plugin_id));
    merged
}

fn sync_install_statuses(app: &AppHandle, mut state: PersistedState) -> PersistedState {
    let mut installed_plugins = state
        .installed_plugins
        .values()
        .cloned()
        .collect::<Vec<_>>();

    let changed = refresh_installed_records(&mut installed_plugins);

    if changed {
        state.installed_plugins.clear();
        for record in installed_plugins {
            state
                .installed_plugins
                .insert(record.plugin_id.clone(), record);
        }
        if let Err(error) = save_state(app, &state) {
            eprintln!("Could not persist refreshed install statuses: {}", error);
        }
    }

    state
}

#[tauri::command]
pub fn bootstrap(app: AppHandle) -> Result<BootstrapPayload, String> {
    let state = match load_state(&app) {
        Ok(state) => state,
        Err(error) => {
            eprintln!(
                "Falling back to a default desktop state during bootstrap: {}",
                error
            );
            PersistedState::default()
        }
    };
    let state = sync_install_statuses(&app, state);
    let detection = detect_obs_installation(&app, &state.settings);
    let plugins = load_plugin_catalog().map_err(|error| error.to_string())?;
    let tracked_plugins = state
        .installed_plugins
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let external_plugins = scan_external_installations(&state.settings, &plugins);
    let installed_plugins = merge_installed_records(tracked_plugins, external_plugins);

    Ok(BootstrapPayload {
        settings: state.settings,
        obs_detection: detection,
        plugins,
        installed_plugins,
        install_history: state.install_history,
        current_platform: SupportedPlatform::current().as_str().to_string(),
        current_version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub fn adopt_installation(app: AppHandle, plugin_id: String) -> Result<InstalledPluginRecord, String> {
    let mut state = load_state(&app).map_err(|error| error.to_string())?;

    if let Some(existing) = state.installed_plugins.get(&plugin_id) {
        return Ok(existing.clone());
    }

    let plugins = load_plugin_catalog().map_err(|error| error.to_string())?;
    let external = scan_external_installations(&state.settings, &plugins)
        .into_iter()
        .find(|record| record.plugin_id == plugin_id && !record.managed)
        .ok_or_else(|| "No adoptable external installation was detected for that plugin.".to_string())?;

    let mut adopted = external;
    adopted.managed = true;
    adopted.installed_at = Utc::now().to_rfc3339();
    adopted.install_method = Some(InstallMethod::Managed);

    push_install_history(
        &mut state,
        InstallHistoryEntry {
            plugin_id: adopted.plugin_id.clone(),
            plugin_name: plugins
                .iter()
                .find(|plugin| plugin.id == adopted.plugin_id)
                .map(|plugin| plugin.name.clone())
                .unwrap_or_else(|| adopted.plugin_id.clone()),
            version: Some(adopted.installed_version.clone()),
            action: InstallHistoryAction::Adopt,
            managed: true,
            install_location: Some(adopted.install_location.clone()),
            message: "The existing OBS installation was adopted into managed state.".to_string(),
            timestamp: Utc::now().to_rfc3339(),
            file_count: adopted.installed_files.len(),
            backup_root: adopted.backup.as_ref().map(|backup| backup.backup_root.clone()),
            verification_status: adopted.verification_status.clone(),
        },
    );
    state
        .installed_plugins
        .insert(plugin_id, adopted.clone());
    save_state(&app, &state).map_err(|error| error.to_string())?;

    Ok(adopted)
}
