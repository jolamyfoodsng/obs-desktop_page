use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::models::plugin::{PluginCatalogEntry, PluginInstallStrategyKind, SupportedPlatform};
use crate::models::state::{InstallReviewDetectedKind, InstallReviewItem, InstallReviewPlan};
use crate::utils::errors::AppError;

#[derive(Debug, Clone)]
pub struct InstallCopyOperation {
    pub from: PathBuf,
    pub to: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlannedArchiveKind {
    ObsPlugin,
    StandaloneTool,
    Review,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlannedArchiveDestination {
    ObsPluginBin,
    ObsPluginData,
    StandaloneTool,
}

#[derive(Debug, Clone)]
pub struct PlannedArchiveItem {
    pub from: PathBuf,
    pub relative_destination: PathBuf,
    pub destination: PlannedArchiveDestination,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct PlannedArchiveInstall {
    pub kind: PlannedArchiveKind,
    pub items: Vec<PlannedArchiveItem>,
    pub review_plan: InstallReviewPlan,
}

#[derive(Debug, Clone)]
struct CandidateFile {
    path: PathBuf,
    relative: PathBuf,
    reason: String,
}

#[derive(Debug, Clone)]
pub enum ArchiveLayout {
    WindowsProgramDataModule {
        module_root: PathBuf,
    },
    WindowsLegacy {
        obs_plugins_dir: Option<PathBuf>,
        data_dir: Option<PathBuf>,
        bin_dir: Option<PathBuf>,
    },
    MacPluginBundles {
        bundles: Vec<PathBuf>,
    },
    StandaloneTool {
        source_root: PathBuf,
    },
}

#[cfg(unix)]
fn is_unix_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_unix_executable_file(_path: &Path) -> bool {
    false
}

fn is_ignored_archive_child(path: &Path) -> bool {
    matches!(
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default(),
        "__MACOSX"
    ) || path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .starts_with('.')
}

fn preferred_payload_root(root: &Path) -> PathBuf {
    let visible_entries = fs::read_dir(root)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .map(|entry| entry.path())
        .filter(|path| !is_ignored_archive_child(path))
        .collect::<Vec<_>>();

    let visible_dirs = visible_entries
        .iter()
        .filter(|path| path.is_dir())
        .cloned()
        .collect::<Vec<_>>();
    let visible_files = visible_entries.iter().filter(|path| path.is_file()).count();

    if visible_dirs.len() == 1 && visible_files == 0 {
        return visible_dirs[0].clone();
    }

    root.to_path_buf()
}

fn contains_standalone_tool(root: &Path, platform: &SupportedPlatform) -> bool {
    match platform {
        SupportedPlatform::Windows => WalkDir::new(root)
            .max_depth(4)
            .into_iter()
            .filter_map(Result::ok)
            .any(|entry| {
                entry.file_type().is_file()
                    && entry.path().extension().and_then(|value| value.to_str()) == Some("exe")
            }),
        SupportedPlatform::Macos => WalkDir::new(root)
            .max_depth(4)
            .into_iter()
            .filter_map(Result::ok)
            .any(|entry| {
                entry.file_type().is_dir()
                    && entry.path().extension().and_then(|value| value.to_str()) == Some("app")
            }),
        SupportedPlatform::Linux => WalkDir::new(root)
            .max_depth(4)
            .into_iter()
            .filter_map(Result::ok)
            .any(|entry| {
                let path = entry.path();
                entry.file_type().is_file()
                    && (path.extension().and_then(|value| value.to_str()) == Some("AppImage")
                        || is_unix_executable_file(path))
            }),
    }
}

fn find_macos_plugin_bundles(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_dir())
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("plugin"))
        .map(|entry| entry.into_path())
        .collect()
}

fn detect_windows_module_root(root: &Path, module_name: &str) -> Option<PathBuf> {
    let exact_match = WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_dir()
                && entry.file_name().to_string_lossy() == module_name
                && (entry.path().join("bin").exists() || entry.path().join("data").exists())
        });

    if let Some(entry) = exact_match {
        return Some(entry.into_path());
    }

    let candidates = WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_dir()
                && entry.path().join("bin").exists()
                && !matches!(
                    entry.file_name().to_string_lossy().as_ref(),
                    "bin" | "data" | "obs-plugins"
                )
        })
        .collect::<Vec<_>>();

    if candidates.len() == 1 {
        return Some(candidates[0].path().to_path_buf());
    }

    None
}

fn detect_obs_style_root(
    root: &Path,
) -> Option<(Option<PathBuf>, Option<PathBuf>, Option<PathBuf>)> {
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);

    while let Some((directory, depth)) = queue.pop_front() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };

        let mut obs_plugins_dir = None;
        let mut data_dir = None;
        let mut bin_dir = None;
        let mut child_dirs = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            child_dirs.push(path.clone());

            match entry.file_name().to_string_lossy().as_ref() {
                "obs-plugins" => obs_plugins_dir = Some(path),
                "data" => data_dir = Some(path),
                "bin" => bin_dir = Some(path),
                _ => {}
            }
        }

        if obs_plugins_dir.is_some() || data_dir.is_some() || bin_dir.is_some() {
            return Some((obs_plugins_dir, data_dir, bin_dir));
        }

        if depth >= 3 {
            continue;
        }

        for child in child_dirs {
            let name = child
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if name.starts_with('.') || name == "__MACOSX" || name == "docs" {
                continue;
            }
            queue.push_back((child, depth + 1));
        }
    }

    None
}

fn select_data_source(data_dir: &Path, plugin: &PluginCatalogEntry) -> PathBuf {
    let obs_plugin_data = data_dir.join("obs-plugins").join(&plugin.module_name);
    if obs_plugin_data.exists() {
        return obs_plugin_data;
    }

    let direct_module_data = data_dir.join(&plugin.module_name);
    if direct_module_data.exists() {
        return direct_module_data;
    }

    let child_dirs = fs::read_dir(data_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();

    if child_dirs.len() == 1 {
        return child_dirs[0].clone();
    }

    data_dir.to_path_buf()
}

fn normalized_hint(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn plugin_name_hints(plugin: &PluginCatalogEntry) -> Vec<String> {
    let mut hints = HashSet::new();

    for value in [plugin.module_name.as_str(), plugin.name.as_str()] {
        let normalized = normalized_hint(value);
        if !normalized.is_empty() {
            hints.insert(normalized);
        }
    }

    if let Some(strategy) = &plugin.install_strategy {
        for alias in &strategy.module_name_aliases {
            let normalized = normalized_hint(alias);
            if !normalized.is_empty() {
                hints.insert(normalized);
            }
        }

        for hint in &strategy.binary_name_hints {
            let normalized = normalized_hint(hint);
            if !normalized.is_empty() {
                hints.insert(normalized);
            }
        }
    }

    hints.into_iter().collect()
}

fn plugin_resource_hints(plugin: &PluginCatalogEntry) -> Vec<String> {
    let mut hints = plugin_name_hints(plugin)
        .into_iter()
        .collect::<HashSet<_>>();

    if let Some(strategy) = &plugin.install_strategy {
        for hint in &strategy.resource_dir_hints {
            let normalized = normalized_hint(hint);
            if !normalized.is_empty() {
                hints.insert(normalized);
            }
        }
    }

    hints.into_iter().collect()
}

fn path_segments(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect()
}

fn path_segments_lower(path: &Path) -> Vec<String> {
    path_segments(path)
        .into_iter()
        .map(|segment| segment.to_ascii_lowercase())
        .collect()
}

fn normalized_path_contains_hint(path: &Path, hints: &[String]) -> bool {
    let normalized = normalized_hint(&path.to_string_lossy());
    hints.iter().any(|hint| normalized.contains(hint))
}

fn path_contains_marker(path: &Path, markers: &[&str]) -> bool {
    let lower = path_segments_lower(path);
    lower
        .iter()
        .any(|segment| markers.iter().any(|marker| segment == marker))
}

fn relative_after_last_marker(path: &Path, markers: &[&str]) -> Option<PathBuf> {
    let segments = path_segments(path);
    let lower = segments
        .iter()
        .map(|segment| segment.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let marker_index = lower
        .iter()
        .enumerate()
        .rev()
        .find(|(_, segment)| markers.iter().any(|marker| segment == marker))
        .map(|(index, _)| index)?;
    let tail = segments
        .iter()
        .skip(marker_index + 1)
        .map(PathBuf::from)
        .fold(PathBuf::new(), |mut acc, segment| {
            acc.push(segment);
            acc
        });

    if tail.as_os_str().is_empty() {
        None
    } else {
        Some(tail)
    }
}

fn strip_module_prefix(path: &Path, hints: &[String]) -> PathBuf {
    let segments = path_segments(path);
    let lower = segments
        .iter()
        .map(|segment| normalized_hint(segment))
        .collect::<Vec<_>>();

    let mut start_index = 0usize;

    if lower.first().map(String::as_str) == Some("obsplugins") && lower.len() > 1 {
        start_index = 1;
    }

    if lower
        .get(start_index)
        .is_some_and(|segment| hints.iter().any(|hint| hint == segment))
    {
        start_index += 1;
    }

    let stripped = segments
        .iter()
        .skip(start_index)
        .map(PathBuf::from)
        .fold(PathBuf::new(), |mut acc, segment| {
            acc.push(segment);
            acc
        });

    if stripped.as_os_str().is_empty() {
        path.file_name().map(PathBuf::from).unwrap_or_default()
    } else {
        stripped
    }
}

fn is_documentation_file(path: &Path) -> bool {
    let lower = path_segments_lower(path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if lower.iter().any(|segment| {
        matches!(
            segment.as_str(),
            "docs" | "doc" | "documentation" | "examples" | "example" | "__macosx"
        ) || segment.starts_with('.')
    }) {
        return true;
    }

    matches!(
        file_name.as_str(),
        "readme" | "readme.txt" | "readme.md" | "license" | "license.txt" | "license.md"
            | "copying" | "copying.txt" | "changelog" | "changelog.md" | "authors"
    )
}

fn is_obs_binary_candidate(
    path: &Path,
    relative: &Path,
    platform: &SupportedPlatform,
    name_hints: &[String],
) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let extension_matches = match platform {
        SupportedPlatform::Windows => extension == "dll",
        SupportedPlatform::Macos => extension == "dylib" || extension == "so",
        SupportedPlatform::Linux => extension == "so",
    };

    if !extension_matches {
        return false;
    }

    path_contains_marker(relative, &["obs-plugins", "bin", "64bit", "32bit"])
        || normalized_path_contains_hint(relative, name_hints)
}

fn is_standalone_executable_candidate(
    path: &Path,
    relative: &Path,
    platform: &SupportedPlatform,
) -> bool {
    let lower = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if file_name.contains("unins") || file_name.contains("uninstall") {
        return false;
    }

    match platform {
        SupportedPlatform::Windows => lower == "exe",
        SupportedPlatform::Macos => relative_after_last_marker(relative, &["macos"]).is_some(),
        SupportedPlatform::Linux => lower == "appimage" || is_unix_executable_file(path),
    }
}

fn is_resource_candidate(relative: &Path, resource_hints: &[String]) -> bool {
    if is_documentation_file(relative) {
        return false;
    }

    let extension = relative
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let lower = path_segments_lower(relative);
    let resource_dirs = [
        "data",
        "locale",
        "locales",
        "effects",
        "effect",
        "shaders",
        "shader",
        "presets",
        "preset",
        "themes",
        "styles",
        "images",
        "assets",
        "fonts",
        "obs-plugins",
    ];
    let resource_extensions = [
        "json", "ini", "cfg", "txt", "png", "jpg", "jpeg", "gif", "svg", "effect", "shader",
        "lua", "py", "ttf", "otf", "plist", "xml",
    ];

    lower
        .iter()
        .any(|segment| resource_dirs.contains(&segment.as_str()))
        || resource_extensions.contains(&extension.as_str())
            && normalized_path_contains_hint(relative, resource_hints)
}

fn binary_destination(relative: &Path, name_hints: &[String]) -> PathBuf {
    let tail = relative_after_last_marker(relative, &["obs-plugins", "bin"])
        .unwrap_or_else(|| strip_module_prefix(relative, name_hints));
    let tail_segments = path_segments(&tail);
    let lower = path_segments_lower(&tail);

    if lower.first().is_some_and(|segment| segment == "obs-plugins") {
        return tail_segments
            .into_iter()
            .skip(1)
            .map(PathBuf::from)
            .fold(PathBuf::new(), |mut acc, segment| {
                acc.push(segment);
                acc
            });
    }

    tail
}

fn resource_destination(relative: &Path, name_hints: &[String]) -> PathBuf {
    let tail = relative_after_last_marker(relative, &["data"])
        .unwrap_or_else(|| strip_module_prefix(relative, name_hints));
    let stripped = strip_module_prefix(&tail, name_hints);

    if stripped.as_os_str().is_empty() {
        relative.file_name().map(PathBuf::from).unwrap_or_default()
    } else {
        stripped
    }
}

fn common_ancestor(paths: &[PathBuf]) -> Option<PathBuf> {
    let components = paths
        .iter()
        .map(|path| path.components().collect::<Vec<_>>())
        .collect::<Vec<_>>();
    let first = components.first()?.clone();
    let mut shared = Vec::new();

    'outer: for (index, component) in first.iter().enumerate() {
        for path_components in &components[1..] {
            if path_components.get(index) != Some(component) {
                break 'outer;
            }
        }
        shared.push(component.as_os_str().to_owned());
    }

    if shared.is_empty() {
        return None;
    }

    Some(shared.into_iter().fold(PathBuf::new(), |mut acc, segment| {
        acc.push(segment);
        acc
    }))
}

fn build_review_plan(
    detected_kind: InstallReviewDetectedKind,
    summary: impl Into<String>,
    next_action: impl Into<String>,
    items: Vec<InstallReviewItem>,
) -> InstallReviewPlan {
    InstallReviewPlan {
        detected_kind,
        summary: summary.into(),
        next_action: next_action.into(),
        items,
    }
}

fn build_obs_review_items(items: &[PlannedArchiveItem]) -> Vec<InstallReviewItem> {
    items.iter()
        .map(|item| InstallReviewItem {
            source_path: item.from.display().to_string(),
            proposed_destination: match item.destination {
                PlannedArchiveDestination::ObsPluginBin => {
                    format!("OBS plugin bin/{}", item.relative_destination.display())
                }
                PlannedArchiveDestination::ObsPluginData => {
                    format!("OBS plugin data/{}", item.relative_destination.display())
                }
                PlannedArchiveDestination::StandaloneTool => {
                    format!("Managed tool/{}", item.relative_destination.display())
                }
            },
            reason: item.reason.clone(),
        })
        .collect()
}

fn collect_archive_candidates(
    root: &Path,
    plugin: &PluginCatalogEntry,
    platform: &SupportedPlatform,
) -> (Vec<CandidateFile>, Vec<CandidateFile>, Vec<CandidateFile>, PathBuf) {
    let scan_root = preferred_payload_root(root);
    let name_hints = plugin_name_hints(plugin);
    let resource_hints = plugin_resource_hints(plugin);
    let mut obs_binaries = Vec::new();
    let mut resources = Vec::new();
    let mut standalone = Vec::new();

    for entry in WalkDir::new(&scan_root)
        .max_depth(8)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let path = entry.path().to_path_buf();
        let Ok(relative) = path.strip_prefix(&scan_root).map(PathBuf::from) else {
            continue;
        };

        if is_documentation_file(&relative) {
            continue;
        }

        if is_obs_binary_candidate(&path, &relative, platform, &name_hints) {
            obs_binaries.push(CandidateFile {
                path,
                relative,
                reason: "Likely OBS plugin binary".to_string(),
            });
            continue;
        }

        if is_standalone_executable_candidate(&path, &relative, platform) {
            standalone.push(CandidateFile {
                path,
                relative,
                reason: "Likely standalone companion executable".to_string(),
            });
            continue;
        }

        if is_resource_candidate(&relative, &resource_hints) {
            resources.push(CandidateFile {
                path,
                relative,
                reason: "Likely OBS plugin resource/support file".to_string(),
            });
        }
    }

    (obs_binaries, resources, standalone, scan_root)
}

fn heuristic_obs_plugin_plan(
    plugin: &PluginCatalogEntry,
    obs_binaries: &[CandidateFile],
    resources: &[CandidateFile],
) -> Option<PlannedArchiveInstall> {
    if obs_binaries.is_empty() && resources.is_empty() {
        return None;
    }

    let name_hints = plugin_name_hints(plugin);
    let mut seen = HashSet::new();
    let mut items = Vec::new();

    for candidate in obs_binaries {
        let destination = binary_destination(&candidate.relative, &name_hints);
        let key = format!("bin:{}", destination.display());
        if seen.insert(key) {
            items.push(PlannedArchiveItem {
                from: candidate.path.clone(),
                relative_destination: destination,
                destination: PlannedArchiveDestination::ObsPluginBin,
                reason: candidate.reason.clone(),
            });
        }
    }

    for candidate in resources {
        let destination = resource_destination(&candidate.relative, &name_hints);
        let key = format!("data:{}", destination.display());
        if seen.insert(key) {
            items.push(PlannedArchiveItem {
                from: candidate.path.clone(),
                relative_destination: destination,
                destination: PlannedArchiveDestination::ObsPluginData,
                reason: candidate.reason.clone(),
            });
        }
    }

    if items.is_empty() {
        return None;
    }

    let summary = if resources.is_empty() {
        format!(
            "Detected {} likely OBS plugin binaries for {} and built an install plan from the archive contents.",
            obs_binaries.len(),
            plugin.name
        )
    } else {
        format!(
            "Detected {} likely OBS plugin binaries and {} resource files for {}.",
            obs_binaries.len(),
            resources.len(),
            plugin.name
        )
    };

    let review_plan = build_review_plan(
        InstallReviewDetectedKind::ObsPlugin,
        summary.clone(),
        "Review the proposed destinations below or continue with the official source page if anything looks unexpected.",
        build_obs_review_items(&items),
    );

    Some(PlannedArchiveInstall {
        kind: PlannedArchiveKind::ObsPlugin,
        items,
        review_plan,
    })
}

fn heuristic_standalone_plan(
    plugin: &PluginCatalogEntry,
    scan_root: &Path,
    standalone: &[CandidateFile],
    resources: &[CandidateFile],
) -> Option<PlannedArchiveInstall> {
    if standalone.is_empty() {
        return None;
    }

    let source_paths = standalone
        .iter()
        .map(|candidate| candidate.path.clone())
        .chain(resources.iter().map(|candidate| candidate.path.clone()))
        .collect::<Vec<_>>();
    let source_root = common_ancestor(&source_paths)
        .filter(|ancestor| ancestor.starts_with(scan_root))
        .unwrap_or_else(|| {
            standalone[0]
                .path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| scan_root.to_path_buf())
        });

    let mut items = Vec::new();
    for entry in WalkDir::new(&source_root)
        .max_depth(8)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let path = entry.path().to_path_buf();
        let Ok(relative_destination) = path.strip_prefix(&source_root).map(PathBuf::from) else {
            continue;
        };
        if is_documentation_file(&relative_destination) {
            continue;
        }

        items.push(PlannedArchiveItem {
            from: path,
            relative_destination,
            destination: PlannedArchiveDestination::StandaloneTool,
            reason: "Detected as part of a standalone companion app/tool payload".to_string(),
        });
    }

    if items.is_empty() {
        return None;
    }

    let review_plan = build_review_plan(
        InstallReviewDetectedKind::StandaloneTool,
        format!(
            "Detected a standalone companion app/tool for {} and mapped its payload into the managed tools area.",
            plugin.name
        ),
        "Review the managed tool files below or open the official source page if you want to verify the upstream instructions first.",
        build_obs_review_items(&items),
    );

    Some(PlannedArchiveInstall {
        kind: PlannedArchiveKind::StandaloneTool,
        items,
        review_plan,
    })
}

fn heuristic_review_plan(
    plugin: &PluginCatalogEntry,
    obs_binaries: &[CandidateFile],
    resources: &[CandidateFile],
    standalone: &[CandidateFile],
) -> PlannedArchiveInstall {
    let mut items = Vec::new();

    for candidate in obs_binaries.iter().take(8) {
        items.push(InstallReviewItem {
            source_path: candidate.path.display().to_string(),
            proposed_destination: format!(
                "OBS plugin bin/{}",
                binary_destination(&candidate.relative, &plugin_name_hints(plugin)).display()
            ),
            reason: candidate.reason.clone(),
        });
    }

    for candidate in resources.iter().take(8) {
        items.push(InstallReviewItem {
            source_path: candidate.path.display().to_string(),
            proposed_destination: format!(
                "OBS plugin data/{}",
                resource_destination(&candidate.relative, &plugin_name_hints(plugin)).display()
            ),
            reason: candidate.reason.clone(),
        });
    }

    for candidate in standalone.iter().take(8) {
        items.push(InstallReviewItem {
            source_path: candidate.path.display().to_string(),
            proposed_destination: format!("Managed tool/{}", candidate.relative.display()),
            reason: candidate.reason.clone(),
        });
    }

    let summary = if !obs_binaries.is_empty() && !standalone.is_empty() {
        format!(
            "{} includes both plugin-like files and standalone executables, so the package still needs review before the app can place files automatically.",
            plugin.name
        )
    } else if !resources.is_empty() {
        format!(
            "{} includes support files but not enough unambiguous plugin binaries to install safely.",
            plugin.name
        )
    } else {
        format!(
            "{} did not expose a clearly safe install layout, so the app stopped before copying anything.",
            plugin.name
        )
    };

    PlannedArchiveInstall {
        kind: PlannedArchiveKind::Review,
        items: Vec::new(),
        review_plan: build_review_plan(
            InstallReviewDetectedKind::Ambiguous,
            summary,
            "Review the detected files below, then open the official source page or add plugin-specific install strategy hints if this package should install automatically.",
            items,
        ),
    }
}

pub fn inspect_archive_install(
    root: &Path,
    plugin: &PluginCatalogEntry,
    platform: &SupportedPlatform,
) -> Result<PlannedArchiveInstall, AppError> {
    let (obs_binaries, resources, standalone, scan_root) =
        collect_archive_candidates(root, plugin, platform);

    let strategy_kind = plugin
        .install_strategy
        .as_ref()
        .and_then(|strategy| strategy.kind.as_ref());

    if strategy_kind == Some(&PluginInstallStrategyKind::Hybrid) {
        return Ok(heuristic_review_plan(plugin, &obs_binaries, &resources, &standalone));
    }

    if strategy_kind == Some(&PluginInstallStrategyKind::StandaloneTool) {
        if let Some(plan) = heuristic_standalone_plan(plugin, &scan_root, &standalone, &resources) {
            return Ok(plan);
        }
    }

    if strategy_kind == Some(&PluginInstallStrategyKind::ObsPlugin) {
        if let Some(plan) = heuristic_obs_plugin_plan(plugin, &obs_binaries, &resources) {
            return Ok(plan);
        }
    }

    if !obs_binaries.is_empty() && standalone.is_empty() {
        if let Some(plan) = heuristic_obs_plugin_plan(plugin, &obs_binaries, &resources) {
            return Ok(plan);
        }
    }

    if obs_binaries.is_empty() && !standalone.is_empty() {
        if let Some(plan) = heuristic_standalone_plan(plugin, &scan_root, &standalone, &resources) {
            return Ok(plan);
        }
    }

    Ok(heuristic_review_plan(plugin, &obs_binaries, &resources, &standalone))
}

pub fn build_planned_install_operations(
    plan: &PlannedArchiveInstall,
    plugin: &PluginCatalogEntry,
    target_root: &Path,
) -> Result<Vec<InstallCopyOperation>, AppError> {
    if plan.kind == PlannedArchiveKind::Review {
        return Err(AppError::message(
            "A review-only archive plan cannot be converted into install operations.",
        ));
    }

    let mut operations = Vec::new();

    for item in &plan.items {
        let destination = match item.destination {
            PlannedArchiveDestination::ObsPluginBin => target_root
                .join(&plugin.module_name)
                .join("bin")
                .join(&item.relative_destination),
            PlannedArchiveDestination::ObsPluginData => target_root
                .join(&plugin.module_name)
                .join("data")
                .join(&item.relative_destination),
            PlannedArchiveDestination::StandaloneTool => {
                target_root.join(&item.relative_destination)
            }
        };

        operations.push(InstallCopyOperation {
            from: item.from.clone(),
            to: destination,
        });
    }

    if operations.is_empty() {
        return Err(AppError::message(format!(
            "{} did not contain any installable files after heuristic inspection.",
            plugin.name
        )));
    }

    Ok(operations)
}

pub fn detect_archive_layout(
    root: &Path,
    plugin: &PluginCatalogEntry,
    platform: &SupportedPlatform,
) -> Result<ArchiveLayout, AppError> {
    match platform {
        SupportedPlatform::Macos => {
            let bundles = find_macos_plugin_bundles(root);
            if !bundles.is_empty() {
                return Ok(ArchiveLayout::MacPluginBundles { bundles });
            }
        }
        SupportedPlatform::Windows => {
            if let Some(module_root) = detect_windows_module_root(root, &plugin.module_name) {
                return Ok(ArchiveLayout::WindowsProgramDataModule { module_root });
            }

            if let Some((obs_plugins_dir, data_dir, bin_dir)) = detect_obs_style_root(root) {
                return Ok(ArchiveLayout::WindowsLegacy {
                    obs_plugins_dir,
                    data_dir,
                    bin_dir,
                });
            }
        }
        SupportedPlatform::Linux => {}
    }

    let payload_root = preferred_payload_root(root);
    if contains_standalone_tool(&payload_root, platform) {
        return Ok(ArchiveLayout::StandaloneTool {
            source_root: payload_root,
        });
    }

    Err(AppError::message(format!(
        "{} used an archive structure this MVP does not install automatically.",
        plugin.name
    )))
}

pub fn build_install_operations(
    layout: &ArchiveLayout,
    plugin: &PluginCatalogEntry,
    install_target_root: &Path,
) -> Result<Vec<InstallCopyOperation>, AppError> {
    let mut operations = Vec::new();

    match layout {
        ArchiveLayout::WindowsProgramDataModule { module_root } => {
            let target_root = install_target_root.join(&plugin.module_name);
            let bin_dir = module_root.join("bin");
            let data_dir = module_root.join("data");

            if bin_dir.exists() {
                operations.push(InstallCopyOperation {
                    from: bin_dir,
                    to: target_root.join("bin"),
                });
            }

            if data_dir.exists() {
                operations.push(InstallCopyOperation {
                    from: data_dir,
                    to: target_root.join("data"),
                });
            }
        }
        ArchiveLayout::WindowsLegacy {
            obs_plugins_dir,
            data_dir,
            bin_dir,
        } => {
            let target_root = install_target_root.join(&plugin.module_name);

            if let Some(obs_plugins_dir) = obs_plugins_dir {
                operations.push(InstallCopyOperation {
                    from: obs_plugins_dir.clone(),
                    to: target_root.join("bin"),
                });
            } else if let Some(bin_dir) = bin_dir {
                operations.push(InstallCopyOperation {
                    from: bin_dir.clone(),
                    to: target_root.join("bin"),
                });
            }

            if let Some(data_dir) = data_dir {
                operations.push(InstallCopyOperation {
                    from: select_data_source(data_dir, plugin),
                    to: target_root.join("data"),
                });
            }
        }
        ArchiveLayout::MacPluginBundles { bundles } => {
            for bundle in bundles {
                let bundle_name = bundle.file_name().ok_or_else(|| {
                    AppError::message("A macOS plugin bundle was missing a file name.")
                })?;
                operations.push(InstallCopyOperation {
                    from: bundle.clone(),
                    to: install_target_root.join(bundle_name),
                });
            }
        }
        ArchiveLayout::StandaloneTool { source_root } => {
            let target_root =
                if source_root.extension().and_then(|value| value.to_str()) == Some("app") {
                    let bundle_name = source_root.file_name().ok_or_else(|| {
                        AppError::message("A standalone app bundle was missing a file name.")
                    })?;
                    install_target_root.join(bundle_name)
                } else {
                    install_target_root.to_path_buf()
                };

            operations.push(InstallCopyOperation {
                from: source_root.clone(),
                to: target_root,
            });
        }
    }

    if operations.is_empty() {
        return Err(AppError::message(format!(
            "{} did not contain any installable files after inspection.",
            plugin.name
        )));
    }

    Ok(operations)
}
