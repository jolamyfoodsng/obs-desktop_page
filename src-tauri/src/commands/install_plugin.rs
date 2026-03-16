use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use chrono::Utc;
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tempfile::Builder;
use walkdir::WalkDir;

use crate::commands::extract_archive::extract_archive;
use crate::commands::plugin_paths::{
    build_install_operations, build_planned_install_operations, detect_archive_layout,
    inspect_archive_install, ArchiveLayout, InstallCopyOperation, PlannedArchiveKind,
};
use crate::commands::detect_obs::apply_saved_install_scope;
use crate::commands::store::{load_state, push_install_history, save_state};
use crate::commands::validate_obs::validate_obs_path;
use crate::models::plugin::{
    PluginCatalogEntry, PluginPackage, PluginPackageFileType, PluginPackageInstallType,
    SupportedPlatform,
};
use crate::models::state::{
    CancelInstallResponse, GitHubRejectedAsset, GitHubReleaseAssetOption, GitHubReleaseInfo,
    InstallBackupRecord, InstallHistoryAction, InstallHistoryEntry, InstallKind,
    InstallMethod, InstallProgressEvent, InstallRequest, InstallResponse, InstallReviewPlan,
    InstallVerificationStatus, InstalledPluginRecord, InstalledPluginSourceType,
    InstalledPluginStatus,
};
use crate::utils::catalog::load_plugin_catalog;
use crate::utils::errors::AppError;

pub const INSTALL_PROGRESS_EVENT: &str = "install-progress";

#[derive(Default)]
pub struct InstallCancellationRegistry {
    installs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl InstallCancellationRegistry {
    fn begin(&self, plugin_id: &str) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));
        let mut installs = self
            .installs
            .lock()
            .expect("install cancellation registry lock poisoned");
        installs.insert(plugin_id.to_string(), token.clone());
        token
    }

    fn cancel(&self, plugin_id: &str) -> bool {
        let installs = self
            .installs
            .lock()
            .expect("install cancellation registry lock poisoned");
        installs
            .get(plugin_id)
            .map(|token| {
                token.store(true, Ordering::SeqCst);
                true
            })
            .unwrap_or(false)
    }

    fn finish(&self, plugin_id: &str) {
        let mut installs = self
            .installs
            .lock()
            .expect("install cancellation registry lock poisoned");
        installs.remove(plugin_id);
    }
}

#[derive(Debug, Clone)]
struct CopyEntry {
    source: PathBuf,
    target: PathBuf,
    relative_target: String,
}

#[derive(Debug, Clone)]
struct BackupEntry {
    target: PathBuf,
    backup: PathBuf,
    relative_target: String,
}

#[derive(Debug, Clone, Default)]
struct CopySessionOutcome {
    tracked_files: Vec<String>,
    created_targets: Vec<PathBuf>,
    created_relative_targets: Vec<String>,
    backups: Vec<BackupEntry>,
    backup_root: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct GitHubInstallSelection {
    release: GitHubReleaseInfo,
    asset: GitHubReleaseAssetOption,
}

#[derive(Debug, Clone)]
enum GitHubSelectionResolution {
    NotApplicable,
    Selected(GitHubInstallSelection),
    Unavailable {
        code: String,
        message: String,
        release_url: Option<String>,
    },
}

#[derive(Debug, Clone)]
enum ResolvedResourceKind {
    Archive(PluginPackageFileType),
    External,
    Script,
}

#[derive(Debug)]
struct ResolvedResourceDownload {
    response: Response,
    filename: String,
    kind: ResolvedResourceKind,
}

#[derive(Debug, Deserialize)]
struct GitHubApiRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    published_at: Option<String>,
    assets: Vec<GitHubApiAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubApiAsset {
    name: String,
    browser_download_url: String,
    content_type: Option<String>,
    size: u64,
}

#[derive(Debug, Clone)]
struct GitHubRepoRef {
    owner: String,
    repo: String,
}

fn emit_progress(
    app: &AppHandle,
    plugin_id: &str,
    stage: &str,
    progress: u8,
    message: impl Into<String>,
    detail: Option<String>,
    terminal: bool,
) {
    let _ = app.emit(
        INSTALL_PROGRESS_EVENT,
        InstallProgressEvent {
            plugin_id: plugin_id.to_string(),
            stage: stage.to_string(),
            progress,
            message: message.into(),
            detail,
            terminal: Some(terminal),
        },
    );
}

fn failure_response(
    plugin_id: &str,
    code: &str,
    message: impl Into<String>,
    app: &AppHandle,
) -> InstallResponse {
    let message = message.into();
    emit_progress(
        app,
        plugin_id,
        "error",
        100,
        "Installation failed",
        Some(message.clone()),
        true,
    );

    InstallResponse {
        success: false,
        code: Some(code.to_string()),
        message,
        installed_plugin: None,
        manual_installer_path: None,
        download_path: None,
        installer_started: false,
        can_open_installer_manually: false,
        requires_restart: false,
        conflicts: None,
        review_plan: None,
        selected_asset_name: None,
        selected_asset_reason: None,
        github_release_url: None,
    }
}

fn canceled_response(plugin_id: &str, message: impl Into<String>, app: &AppHandle) -> InstallResponse {
    let message = message.into();
    emit_progress(
        app,
        plugin_id,
        "canceled",
        100,
        "Download canceled",
        Some(message.clone()),
        true,
    );

    InstallResponse {
        success: false,
        code: Some("CANCELED".to_string()),
        message,
        installed_plugin: None,
        manual_installer_path: None,
        download_path: None,
        installer_started: false,
        can_open_installer_manually: false,
        requires_restart: false,
        conflicts: None,
        review_plan: None,
        selected_asset_name: None,
        selected_asset_reason: None,
        github_release_url: None,
    }
}

fn check_canceled(
    token: &Arc<AtomicBool>,
    message: &str,
) -> Result<(), AppError> {
    if token.load(Ordering::SeqCst) {
        Err(AppError::canceled(message))
    } else {
        Ok(())
    }
}

fn review_response(
    plugin_id: &str,
    message: impl Into<String>,
    review_plan: InstallReviewPlan,
    app: &AppHandle,
) -> InstallResponse {
    let message = message.into();
    emit_progress(
        app,
        plugin_id,
        "review",
        100,
        "Review required",
        Some(message.clone()),
        true,
    );

    InstallResponse {
        success: false,
        code: Some("REVIEW_REQUIRED".to_string()),
        message,
        installed_plugin: None,
        manual_installer_path: None,
        download_path: None,
        installer_started: false,
        can_open_installer_manually: false,
        requires_restart: false,
        conflicts: None,
        review_plan: Some(review_plan),
        selected_asset_name: None,
        selected_asset_reason: None,
        github_release_url: None,
    }
}

fn filename_from_url(url: &str, fallback: &str) -> String {
    url.rsplit('/')
        .next()
        .filter(|segment| !segment.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn clean_filename(filename: &str) -> String {
    filename
        .split('?')
        .next()
        .unwrap_or(filename)
        .replace("%20", " ")
        .replace("%5B", "[")
        .replace("%5D", "]")
        .replace("%28", "(")
        .replace("%29", ")")
}

fn filename_from_response(response: &Response, fallback: &str) -> String {
    if let Some(value) = response.headers().get(CONTENT_DISPOSITION) {
        if let Ok(content_disposition) = value.to_str() {
            if let Some(filename) = content_disposition
                .split(';')
                .map(str::trim)
                .find_map(|part| part.strip_prefix("filename="))
            {
                return clean_filename(filename.trim_matches('"'));
            }
        }
    }

    clean_filename(filename_from_url(response.url().as_str(), fallback).as_str())
}

fn infer_resource_kind(filename: &str, content_type: Option<&str>) -> Option<ResolvedResourceKind> {
    let lower = filename.to_ascii_lowercase();

    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        return Some(ResolvedResourceKind::Archive(PluginPackageFileType::TarGz));
    }

    if lower.ends_with(".tar.xz") {
        return Some(ResolvedResourceKind::Archive(PluginPackageFileType::TarXz));
    }

    let extension_kind = if lower.ends_with(".zip") {
        Some(ResolvedResourceKind::Archive(PluginPackageFileType::Zip))
    } else if lower.ends_with(".exe") {
        Some(ResolvedResourceKind::External)
    } else if lower.ends_with(".msi") {
        Some(ResolvedResourceKind::External)
    } else if lower.ends_with(".pkg") {
        Some(ResolvedResourceKind::External)
    } else if lower.ends_with(".dmg") {
        Some(ResolvedResourceKind::External)
    } else if lower.ends_with(".deb") {
        Some(ResolvedResourceKind::External)
    } else if lower.ends_with(".rpm") {
        Some(ResolvedResourceKind::External)
    } else if lower.ends_with(".appimage") {
        Some(ResolvedResourceKind::External)
    } else if lower.ends_with(".lua") || lower.ends_with(".py") {
        Some(ResolvedResourceKind::Script)
    } else {
        None
    };

    if extension_kind.is_some() {
        return extension_kind;
    }

    match content_type.unwrap_or_default() {
        "application/zip" | "application/x-zip-compressed" => {
            Some(ResolvedResourceKind::Archive(PluginPackageFileType::Zip))
        }
        "application/x-gzip" | "application/gzip" => {
            Some(ResolvedResourceKind::Archive(PluginPackageFileType::TarGz))
        }
        "application/x-xz" | "application/x-tar" => {
            Some(ResolvedResourceKind::Archive(PluginPackageFileType::TarXz))
        }
        "application/x-msdownload" | "application/vnd.microsoft.portable-executable" => {
            Some(ResolvedResourceKind::External)
        }
        "application/x-msi" => Some(ResolvedResourceKind::External),
        "application/vnd.apple.installer+xml" => Some(ResolvedResourceKind::External),
        "application/x-apple-diskimage" => Some(ResolvedResourceKind::External),
        "application/vnd.debian.binary-package" => Some(ResolvedResourceKind::External),
        "application/x-rpm" | "application/vnd.rpm" => Some(ResolvedResourceKind::External),
        "text/plain" | "text/x-lua" | "text/x-python" | "application/octet-stream" => {
            if lower.ends_with(".lua") || lower.ends_with(".py") {
                Some(ResolvedResourceKind::Script)
            } else if lower.ends_with(".appimage") || lower.ends_with(".msi") {
                Some(ResolvedResourceKind::External)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn github_blob_to_raw(url: &reqwest::Url) -> Option<String> {
    if url.domain()? != "github.com" {
        return None;
    }

    let segments = url.path_segments()?.collect::<Vec<_>>();
    let blob_index = segments.iter().position(|segment| *segment == "blob")?;
    if blob_index < 2 || blob_index + 1 >= segments.len() {
        return None;
    }

    let owner = segments[0];
    let repo = segments[1];
    let branch = segments[blob_index + 1];
    let rest = &segments[(blob_index + 2)..];
    if rest.is_empty() {
        return None;
    }

    Some(format!(
        "https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{}",
        rest.join("/")
    ))
}

fn github_repo_from_url(url: &str) -> Option<GitHubRepoRef> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.domain()? != "github.com" {
        return None;
    }

    let segments = parsed
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() < 2 {
        return None;
    }

    Some(GitHubRepoRef {
        owner: segments[0].to_string(),
        repo: segments[1].trim_end_matches(".git").to_string(),
    })
}

fn github_repo_string(repo: &GitHubRepoRef) -> String {
    format!("{}/{}", repo.owner, repo.repo)
}

fn infer_github_repo(plugin: &PluginCatalogEntry) -> Option<GitHubRepoRef> {
    if let Some(repo) = plugin.github_repo.as_deref() {
        if let Some((owner, name)) = repo.split_once('/') {
            return Some(GitHubRepoRef {
                owner: owner.to_string(),
                repo: name.to_string(),
            });
        }
    }

    for candidate in [
        plugin.github_release_url.as_deref(),
        plugin.source_url.as_deref(),
        Some(plugin.homepage_url.as_str()),
        plugin.manual_install_url.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(repo) = github_repo_from_url(candidate) {
            return Some(repo);
        }
    }

    None
}

fn infer_github_release_url(plugin: &PluginCatalogEntry) -> Option<String> {
    if let Some(url) = plugin.github_release_url.as_deref() {
        return Some(url.to_string());
    }

    for candidate in [
        plugin.source_url.as_deref(),
        Some(plugin.homepage_url.as_str()),
        plugin.manual_install_url.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if candidate.contains("github.com") && candidate.contains("/releases") {
            return Some(candidate.to_string());
        }
    }

    None
}

fn infer_github_release_tag(plugin: &PluginCatalogEntry) -> Option<String> {
    if let Some(tag) = plugin.github_release_tag.as_deref() {
        return Some(tag.to_string());
    }

    let release_url = infer_github_release_url(plugin)?;
    let parsed = reqwest::Url::parse(&release_url).ok()?;
    let segments = parsed.path_segments()?.collect::<Vec<_>>();

    segments
        .windows(2)
        .find(|parts| parts[0] == "tag")
        .map(|parts| parts[1].to_string())
}

fn current_arch_label() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" | "amd64" => "x64",
        "aarch64" | "arm64" => "arm64",
        "x86" | "i686" | "i386" => "x86",
        other => other,
    }
}

fn current_arch_aliases() -> Vec<&'static str> {
    match current_arch_label() {
        "x64" => vec!["x64", "x86_64", "amd64", "64bit", "win64"],
        "arm64" => vec!["arm64", "aarch64", "arm"],
        "x86" => vec!["x86", "i386", "i686", "32bit", "win32"],
        other => vec![other],
    }
}

fn platform_display_name(platform: &SupportedPlatform) -> &'static str {
    match platform {
        SupportedPlatform::Windows => "Windows",
        SupportedPlatform::Macos => "macOS",
        SupportedPlatform::Linux => "Linux",
    }
}

fn platform_target_label(platform: &SupportedPlatform) -> String {
    format!("{} {}", platform_display_name(platform), current_arch_label())
}

fn infer_file_type(filename: &str, content_type: Option<&str>) -> Option<PluginPackageFileType> {
    let lower = filename.to_ascii_lowercase();

    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        return Some(PluginPackageFileType::TarGz);
    }
    if lower.ends_with(".tar.xz") {
        return Some(PluginPackageFileType::TarXz);
    }
    if lower.ends_with(".zip") {
        return Some(PluginPackageFileType::Zip);
    }
    if lower.ends_with(".exe") {
        return Some(PluginPackageFileType::Exe);
    }
    if lower.ends_with(".msi") {
        return Some(PluginPackageFileType::Msi);
    }
    if lower.ends_with(".pkg") {
        return Some(PluginPackageFileType::Pkg);
    }
    if lower.ends_with(".dmg") {
        return Some(PluginPackageFileType::Dmg);
    }
    if lower.ends_with(".deb") {
        return Some(PluginPackageFileType::Deb);
    }
    if lower.ends_with(".rpm") {
        return Some(PluginPackageFileType::Rpm);
    }
    if lower.ends_with(".appimage") {
        return Some(PluginPackageFileType::AppImage);
    }

    match content_type.unwrap_or_default() {
        "application/zip" | "application/x-zip-compressed" => Some(PluginPackageFileType::Zip),
        "application/x-gzip" | "application/gzip" => Some(PluginPackageFileType::TarGz),
        "application/x-xz" | "application/x-tar" => Some(PluginPackageFileType::TarXz),
        "application/x-msdownload" | "application/vnd.microsoft.portable-executable" => {
            Some(PluginPackageFileType::Exe)
        }
        "application/x-msi" | "application/octet-stream" if lower.ends_with(".msi") => {
            Some(PluginPackageFileType::Msi)
        }
        "application/vnd.apple.installer+xml" => Some(PluginPackageFileType::Pkg),
        "application/x-apple-diskimage" => Some(PluginPackageFileType::Dmg),
        "application/vnd.debian.binary-package" => Some(PluginPackageFileType::Deb),
        _ => None,
    }
}

fn install_type_for_file_type(file_type: &PluginPackageFileType) -> PluginPackageInstallType {
    match file_type {
        PluginPackageFileType::Zip
        | PluginPackageFileType::TarGz
        | PluginPackageFileType::TarXz => PluginPackageInstallType::Archive,
        PluginPackageFileType::Exe
        | PluginPackageFileType::Msi
        | PluginPackageFileType::Pkg
        | PluginPackageFileType::Dmg
        | PluginPackageFileType::Deb
        | PluginPackageFileType::Rpm
        | PluginPackageFileType::AppImage
        | PluginPackageFileType::Url => PluginPackageInstallType::External,
    }
}

fn is_probable_source_archive(filename: &str) -> bool {
    let lower = filename.to_ascii_lowercase();
    (lower.contains("source") || lower.contains("src") || lower.contains("sources"))
        && (lower.ends_with(".zip")
            || lower.ends_with(".tar.gz")
            || lower.ends_with(".tgz")
            || lower.ends_with(".tar.xz"))
}

fn target_platform_tokens(platform: &SupportedPlatform) -> (&'static [&'static str], &'static [&'static str]) {
    match platform {
        SupportedPlatform::Windows => (
            &["windows", "win", "win64", "win32", "msvc"],
            &["mac", "macos", "osx", "darwin", "linux", "ubuntu", "deb", "rpm", "appimage"],
        ),
        SupportedPlatform::Macos => (
            &["mac", "macos", "osx", "darwin", "universal"],
            &["windows", "win", "linux", "ubuntu", "deb", "rpm", "appimage"],
        ),
        SupportedPlatform::Linux => (
            &["linux", "appimage", "deb", "rpm", "ubuntu"],
            &["windows", "win", "mac", "macos", "osx", "darwin", "pkg", "dmg"],
        ),
    }
}

fn native_file_type_score(
    platform: &SupportedPlatform,
    file_type: &PluginPackageFileType,
) -> i32 {
    match platform {
        SupportedPlatform::Windows => match file_type {
            PluginPackageFileType::Msi => 95,
            PluginPackageFileType::Exe => 92,
            PluginPackageFileType::Zip => 78,
            PluginPackageFileType::TarGz | PluginPackageFileType::TarXz => 55,
            _ => -40,
        },
        SupportedPlatform::Macos => match file_type {
            PluginPackageFileType::Pkg => 95,
            PluginPackageFileType::Dmg => 92,
            PluginPackageFileType::Zip => 78,
            PluginPackageFileType::TarGz | PluginPackageFileType::TarXz => 70,
            _ => -40,
        },
        SupportedPlatform::Linux => match file_type {
            PluginPackageFileType::Deb => 95,
            PluginPackageFileType::Rpm => 92,
            PluginPackageFileType::AppImage => 88,
            PluginPackageFileType::TarGz | PluginPackageFileType::TarXz => 75,
            PluginPackageFileType::Zip => 60,
            _ => -40,
        },
    }
}

fn score_github_asset(
    plugin: &PluginCatalogEntry,
    asset: &GitHubApiAsset,
    platform: &SupportedPlatform,
) -> Result<GitHubReleaseAssetOption, GitHubRejectedAsset> {
    let file_type = infer_file_type(&asset.name, asset.content_type.as_deref()).ok_or_else(|| {
        GitHubRejectedAsset {
            name: asset.name.clone(),
            reason: "unsupported file type".to_string(),
        }
    })?;

    if is_probable_source_archive(&asset.name) {
        return Err(GitHubRejectedAsset {
            name: asset.name.clone(),
            reason: "looks like a source-code archive".to_string(),
        });
    }

    let lower = asset.name.to_ascii_lowercase();
    let (positive_tokens, negative_tokens) = target_platform_tokens(platform);
    let mut score = native_file_type_score(platform, &file_type);
    let mut reasons = Vec::new();

    if positive_tokens.iter().any(|token| lower.contains(token)) {
        score += 45;
        reasons.push(format!("matched {}", platform.as_str()));
    }

    let rejected_platform_hits = negative_tokens
        .iter()
        .filter(|token| lower.contains(**token))
        .copied()
        .collect::<Vec<_>>();
    if !rejected_platform_hits.is_empty() {
        score -= 60;
        reasons.push(format!("mentions {}", rejected_platform_hits.join(", ")));
    }

    let arch_aliases = current_arch_aliases();
    if arch_aliases.iter().any(|token| lower.contains(token)) {
        score += 24;
        reasons.push(format!("matched {}", current_arch_label()));
    } else if lower.contains("arm64") || lower.contains("aarch64") {
        score -= if current_arch_label() == "arm64" { 0 } else { 35 };
    } else if lower.contains("x64") || lower.contains("x86_64") || lower.contains("amd64") {
        score -= if current_arch_label() == "x64" { 0 } else { 18 };
    }

    if lower.contains("universal") && matches!(platform, SupportedPlatform::Macos) {
        score += 18;
        reasons.push("matched universal macOS build".to_string());
    }

    for pattern in &plugin.preferred_asset_patterns {
        if !pattern.is_empty() && lower.contains(&pattern.to_ascii_lowercase()) {
            score += 16;
            reasons.push(format!("matched preferred pattern {}", pattern));
        }
    }

    let install_type = install_type_for_file_type(&file_type);

    if plugin.fallback_install_type.as_ref() == Some(&install_type) {
        score += 14;
        reasons.push("matched plugin install preference".to_string());
    }

    if asset.size < 20_000 {
        score -= 25;
        reasons.push("very small asset".to_string());
    }

    if score <= 0 {
        return Err(GitHubRejectedAsset {
            name: asset.name.clone(),
            reason: if reasons.is_empty() {
                "did not match this OS safely".to_string()
            } else {
                reasons.join("; ")
            },
        });
    }

    let label = match install_type {
        PluginPackageInstallType::External => "GitHub release installer",
        PluginPackageInstallType::Archive => "GitHub release archive",
        PluginPackageInstallType::Guide => "GitHub release guide",
    }
    .to_string();
    let reason = if reasons.is_empty() {
        format!("best match for {} {}", platform.as_str(), current_arch_label())
    } else {
        format!(
            "best match for {} {}: {}",
            platform.as_str(),
            current_arch_label(),
            reasons.join(", ")
        )
    };

    Ok(GitHubReleaseAssetOption {
        name: asset.name.clone(),
        download_url: asset.browser_download_url.clone(),
        label,
        file_type,
        install_type,
        score,
        reason,
    })
}

fn github_client() -> Result<Client, AppError> {
    Client::builder()
        .user_agent("obs-plugin-installer/0.1")
        .build()
        .map_err(Into::into)
}

fn fetch_github_release_info(plugin: &PluginCatalogEntry) -> Result<Option<GitHubReleaseInfo>, AppError> {
    let Some(repo) = infer_github_repo(plugin) else {
        return Ok(None);
    };

    let repo_string = github_repo_string(&repo);
    let release_tag = infer_github_release_tag(plugin);
    let api_url = if let Some(tag) = &release_tag {
        format!("https://api.github.com/repos/{repo_string}/releases/tags/{tag}")
    } else {
        format!("https://api.github.com/repos/{repo_string}/releases/latest")
    };

    log::info!("github release fetched: plugin={} repo={} url={}", plugin.id, repo_string, api_url);

    let release = github_client()?
        .get(api_url)
        .send()?
        .error_for_status()?
        .json::<GitHubApiRelease>()?;

    log::info!(
        "github assets found: plugin={} repo={} count={}",
        plugin.id,
        repo_string,
        release.assets.len()
    );

    let platform = SupportedPlatform::current();
    let mut installable = Vec::new();
    let mut rejected = Vec::new();

    for asset in &release.assets {
        match score_github_asset(plugin, asset, &platform) {
            Ok(option) => installable.push(option),
            Err(reason) => {
                log::info!(
                    "github asset rejected: plugin={} asset={} reason={}",
                    plugin.id,
                    reason.name,
                    reason.reason
                );
                rejected.push(reason)
            }
        }
    }

    installable.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.name.cmp(&right.name))
    });

    let selected_asset = installable.first().cloned();
    if let Some(selected) = &selected_asset {
        log::info!(
            "github selected asset: plugin={} asset={} reason={}",
            plugin.id,
            selected.name,
            selected.reason
        );
    }

    Ok(Some(GitHubReleaseInfo {
        repo: repo_string,
        release_name: release
            .name
            .clone()
            .unwrap_or_else(|| release.tag_name.clone()),
        tag_name: release.tag_name,
        release_url: release.html_url,
        published_at: release.published_at,
        selected_asset: selected_asset.clone(),
        alternative_assets: installable.into_iter().skip(1).collect(),
        rejected_assets: rejected,
    }))
}

fn attach_github_metadata(
    mut response: InstallResponse,
    selected_asset: Option<&GitHubReleaseAssetOption>,
    github_release_url: Option<&str>,
) -> InstallResponse {
    response.selected_asset_name = selected_asset.map(|asset| asset.name.clone());
    response.selected_asset_reason = selected_asset.map(|asset| asset.reason.clone());
    response.github_release_url = github_release_url.map(str::to_string);
    response
}

fn find_requested_github_asset(
    release: &GitHubReleaseInfo,
    asset_name: Option<&str>,
    asset_url: Option<&str>,
) -> Option<GitHubReleaseAssetOption> {
    release
        .selected_asset
        .iter()
        .chain(release.alternative_assets.iter())
        .find(|asset| {
            asset_name.is_some_and(|name| asset.name == name)
                || asset_url.is_some_and(|url| asset.download_url == url)
        })
        .cloned()
}

fn resolve_github_asset_for_install(
    plugin: &PluginCatalogEntry,
    request: &InstallRequest,
) -> Result<GitHubSelectionResolution, AppError> {
    let Some(release) = fetch_github_release_info(plugin)? else {
        return Ok(GitHubSelectionResolution::NotApplicable);
    };

    if request.github_asset_name.is_some() || request.github_asset_url.is_some() {
        if let Some(asset) = find_requested_github_asset(
            &release,
            request.github_asset_name.as_deref(),
            request.github_asset_url.as_deref(),
        ) {
            log::info!(
                "github selected asset override: plugin={} asset={} reason={}",
                plugin.id,
                asset.name,
                asset.reason
            );
            return Ok(GitHubSelectionResolution::Selected(GitHubInstallSelection {
                release,
                asset,
            }));
        }

        return Ok(GitHubSelectionResolution::Unavailable {
            code: "ASSET_NOT_FOUND".to_string(),
            message: "The selected GitHub release asset is no longer available. Reload the plugin page and choose another asset.".to_string(),
            release_url: Some(release.release_url),
        });
    }

    if let Some(asset) = release.selected_asset.clone() {
        return Ok(GitHubSelectionResolution::Selected(GitHubInstallSelection {
            release,
            asset,
        }));
    }

    let target_label = platform_target_label(&SupportedPlatform::current());
    let only_source_or_non_installable = !release.rejected_assets.is_empty()
        && release
            .rejected_assets
            .iter()
            .all(|asset| asset.reason.contains("source-code archive") || asset.reason.contains("unsupported"));

    let message = if release.rejected_assets.is_empty() {
        format!(
            "{}'s latest GitHub release does not include any installable binaries for {}.",
            plugin.name, target_label
        )
    } else if only_source_or_non_installable {
        format!(
            "No {} installable asset was found in the latest GitHub release. Only source code or non-installable files were detected.",
            target_label
        )
    } else {
        format!(
            "No {} installable asset was found in the latest GitHub release.",
            target_label
        )
    };

    Ok(GitHubSelectionResolution::Unavailable {
        code: "UNSUPPORTED_OS".to_string(),
        message,
        release_url: Some(release.release_url),
    })
}

fn push_unique_candidate(
    candidates: &mut Vec<String>,
    seen: &mut HashSet<String>,
    candidate: impl Into<String>,
) {
    let candidate = candidate.into();
    if candidate.is_empty() || !seen.insert(candidate.clone()) {
        return;
    }

    candidates.push(candidate);
}

fn trim_url_suffix(url: &str) -> &str {
    let mut end = url.len();

    while end > 0 {
        let Some(ch) = url[..end].chars().next_back() else {
            break;
        };

        if matches!(ch, '.' | ',' | ';' | ':' | '!' | '?' | ')' | ']' | '}') {
            end -= ch.len_utf8();
            continue;
        }

        break;
    }

    &url[..end]
}

fn extract_urls_from_text(text: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor = 0usize;

    while cursor < text.len() {
        let remaining = &text[cursor..];
        let https_index = remaining.find("https://");
        let http_index = remaining.find("http://");
        let Some(offset) = (match (https_index, http_index) {
            (Some(left), Some(right)) => Some(left.min(right)),
            (Some(left), None) => Some(left),
            (None, Some(right)) => Some(right),
            (None, None) => None,
        }) else {
            break;
        };

        let start = cursor + offset;
        let mut end = text.len();

        for (index, ch) in text[start..].char_indices() {
            if ch.is_whitespace() || matches!(ch, '"' | '\'' | '<' | '>') {
                end = start + index;
                break;
            }
        }

        let candidate = trim_url_suffix(&text[start..end]);
        if !candidate.is_empty() && seen.insert(candidate.to_string()) {
            urls.push(candidate.to_string());
        }

        cursor = end.saturating_add(1);
    }

    urls
}

fn extract_html_attribute_values(html: &str, attribute: &str) -> Vec<String> {
    let mut values = Vec::new();

    for quote in ['"', '\''] {
        let needle = format!("{attribute}={quote}");
        let mut start = 0usize;

        while let Some(offset) = html[start..].find(&needle) {
            let value_start = start + offset + needle.len();
            let Some(value_end_offset) = html[value_start..].find(quote) else {
                break;
            };
            let value_end = value_start + value_end_offset;
            values.push(html[value_start..value_end].to_string());
            start = value_end.saturating_add(1);
        }
    }

    values
}

fn candidate_url_score(url: &str) -> i32 {
    let lower = url.to_ascii_lowercase();
    let mut score = 0;

    if lower.contains("release-assets.githubusercontent.com") {
        score += 240;
    }
    if lower.contains("/releases/download/") {
        score += 220;
    }
    if lower.contains("/releases/expanded_assets/") {
        score += 180;
    }
    if lower.contains("raw.githubusercontent.com") {
        score += 170;
    }
    if lower.ends_with(".zip") || lower.contains(".zip?") {
        score += 150;
    }
    if lower.ends_with(".tar.gz") || lower.contains(".tar.gz?") || lower.ends_with(".tgz") {
        score += 148;
    }
    if lower.ends_with(".tar.xz") || lower.contains(".tar.xz?") {
        score += 145;
    }
    if lower.ends_with(".exe")
        || lower.contains(".exe?")
        || lower.ends_with(".msi")
        || lower.contains(".msi?")
        || lower.ends_with(".pkg")
        || lower.contains(".pkg?")
        || lower.ends_with(".dmg")
        || lower.contains(".dmg?")
        || lower.ends_with(".deb")
        || lower.contains(".deb?")
        || lower.ends_with(".rpm")
        || lower.contains(".rpm?")
        || lower.ends_with(".appimage")
        || lower.contains(".appimage?")
    {
        score += 135;
    }
    if lower.ends_with(".lua")
        || lower.contains(".lua?")
        || lower.ends_with(".py")
        || lower.contains(".py?")
    {
        score += 130;
    }
    if lower.contains("download") {
        score += 40;
    }
    if lower.contains("/blob/") {
        score += 35;
    }
    if lower.ends_with("/releases") || lower.contains("/releases/tag/") {
        score += 25;
    }
    if lower.contains("github.com") {
        score += 10;
    }
    if lower.contains("sourceforge.net") {
        score += 8;
    }
    if lower.contains("/archive/refs/") {
        score -= 90;
    }
    if lower.contains("readme") || lower.ends_with(".md") || lower.contains("documentation") {
        score -= 180;
    }
    if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".svg")
    {
        score -= 220;
    }

    score
}

fn sorted_candidate_urls(candidates: Vec<String>) -> Vec<String> {
    let mut candidates = candidates
        .into_iter()
        .filter(|candidate| !candidate.is_empty())
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        candidate_url_score(right)
            .cmp(&candidate_url_score(left))
            .then_with(|| left.cmp(right))
    });

    candidates
}

fn collect_html_candidates(base_url: &reqwest::Url, html: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    for attribute in ["href", "src"] {
        for value in extract_html_attribute_values(html, attribute) {
            if value.starts_with('#')
                || value.starts_with("mailto:")
                || value.starts_with("javascript:")
                || value.starts_with("data:")
            {
                continue;
            }

            if let Ok(url) = base_url.join(&value) {
                push_unique_candidate(&mut candidates, &mut seen, url.to_string());
            } else if value.starts_with("http://") || value.starts_with("https://") {
                push_unique_candidate(&mut candidates, &mut seen, value);
            }
        }
    }

    for value in extract_urls_from_text(html) {
        push_unique_candidate(&mut candidates, &mut seen, value);
    }

    sorted_candidate_urls(candidates)
}

fn resource_candidate_urls(plugin: &PluginCatalogEntry) -> Vec<String> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    if let Some(url) = plugin.manual_install_url.as_deref() {
        push_unique_candidate(&mut candidates, &mut seen, url);
    }
    if let Some(url) = plugin.source_url.as_deref() {
        push_unique_candidate(&mut candidates, &mut seen, url);
    }
    push_unique_candidate(&mut candidates, &mut seen, plugin.homepage_url.clone());

    for value in extract_urls_from_text(&plugin.long_description) {
        push_unique_candidate(&mut candidates, &mut seen, value);
    }

    for note in &plugin.install_notes {
        for value in extract_urls_from_text(note) {
            push_unique_candidate(&mut candidates, &mut seen, value);
        }
    }

    sorted_candidate_urls(candidates)
}

fn resolve_resource_download_recursive(
    client: &Client,
    url: &str,
    fallback_filename: &str,
    depth: usize,
    visited: &mut HashSet<String>,
) -> Result<ResolvedResourceDownload, AppError> {
    if depth > 8 {
        return Err(AppError::message(
      "The official resource page linked through too many intermediate pages to resolve safely.",
    ));
    }

    if !visited.insert(url.to_string()) {
        return Err(AppError::message(
            "A download page redirected in a loop before exposing a package.",
        ));
    }

    let response = client.get(url).send()?.error_for_status()?;

    if let Some(raw_download) = response
        .headers()
        .get("x-raw-download")
        .and_then(|value| value.to_str().ok())
    {
        if raw_download != response.url().as_str() {
            return resolve_resource_download_recursive(
                client,
                raw_download,
                fallback_filename,
                depth + 1,
                visited,
            );
        }
    }

    if let Some(raw_url) = github_blob_to_raw(response.url()) {
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();

        if content_type.starts_with("text/html") {
            return resolve_resource_download_recursive(
                client,
                &raw_url,
                fallback_filename,
                depth + 1,
                visited,
            );
        }
    }

    let filename = filename_from_response(&response, fallback_filename);
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    if let Some(kind) = infer_resource_kind(&filename, content_type) {
        return Ok(ResolvedResourceDownload {
            response,
            filename,
            kind,
        });
    }

    if content_type.unwrap_or_default().starts_with("text/html") {
        let base_url = response.url().clone();
        let html = response.text()?;
        let candidates = collect_html_candidates(&base_url, &html);
        let mut last_error = None;

        for candidate in candidates {
            if visited.contains(&candidate) {
                continue;
            }

            match resolve_resource_download_recursive(
                client,
                &candidate,
                fallback_filename,
                depth + 1,
                visited,
            ) {
                Ok(resolved) => return Ok(resolved),
                Err(error) => last_error = Some(error),
            }
        }

        return Err(last_error.unwrap_or_else(|| {
      AppError::message(
        "The official resource page did not expose a direct downloadable package for one-click install.",
      )
    }));
    }

    Err(AppError::message(format!(
        "OBS Plugin Installer does not support the downloaded format for {} yet.",
        filename
    )))
}

fn resolve_resource_download(
    client: &Client,
    url: &str,
    fallback_filename: &str,
) -> Result<ResolvedResourceDownload, AppError> {
    let mut visited = HashSet::new();
    match resolve_resource_download_recursive(client, url, fallback_filename, 0, &mut visited) {
    Ok(result) => Ok(result),
    Err(error) if error.to_string().is_empty() => Err(AppError::message(
      "The official resource page did not expose a direct downloadable package for one-click install.",
    )),
    Err(error) => Err(error),
  }
}

fn ensure_download_directory(app: &AppHandle) -> Result<PathBuf, AppError> {
    let downloads_dir = app.path().download_dir()?;
    let target_dir = downloads_dir.join("OBS Plugin Installer");
    fs::create_dir_all(&target_dir)?;
    Ok(target_dir)
}

fn ensure_managed_tools_directory(app: &AppHandle) -> Result<PathBuf, AppError> {
    let tools_dir = app.path().app_data_dir()?.join("managed-tools");
    fs::create_dir_all(&tools_dir)?;
    Ok(tools_dir)
}

fn write_download_response(
    app: &AppHandle,
    plugin_id: &str,
    plugin_name: &str,
    mut response: Response,
    destination: &Path,
    token: &Arc<AtomicBool>,
) -> Result<(), AppError> {
    let total_bytes = response.content_length();
    let mut downloaded_bytes = 0u64;
    let mut output = File::create(destination)?;
    let mut buffer = [0u8; 64 * 1024];

    loop {
        if token.load(Ordering::SeqCst) {
            drop(output);
            let _ = fs::remove_file(destination);
            return Err(AppError::canceled(
                "The download was canceled and the partial file was removed.",
            ));
        }

        let read = response.read(&mut buffer)?;
        if read == 0 {
            break;
        }

        output.write_all(&buffer[..read])?;
        downloaded_bytes += read as u64;

        let progress = total_bytes
            .map(|total| ((downloaded_bytes as f64 / total as f64) * 42.0).round() as u8)
            .unwrap_or(18);

        let detail = total_bytes.map(|total| {
            format!(
                "{:.1} MB of {:.1} MB downloaded",
                downloaded_bytes as f64 / 1024.0 / 1024.0,
                total as f64 / 1024.0 / 1024.0
            )
        });

        emit_progress(
            app,
            plugin_id,
            "downloading",
            progress.clamp(8, 48),
            format!("Downloading {}", plugin_name),
            detail,
            false,
        );
    }

    Ok(())
}

fn download_file(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    package: &PluginPackage,
    destination: &Path,
    token: &Arc<AtomicBool>,
) -> Result<(), AppError> {
    download_url(app, plugin, &package.download_url, destination, token)
}

fn download_url(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    download_url: &str,
    destination: &Path,
    token: &Arc<AtomicBool>,
) -> Result<(), AppError> {
    check_canceled(token, "The install was canceled before download started.")?;
    let response = Client::builder()
        .user_agent("obs-plugin-installer/0.1")
        .build()?
        .get(download_url)
        .send()?
        .error_for_status()?;
    write_download_response(app, &plugin.id, &plugin.name, response, destination, token)
}

pub(crate) fn managed_script_root(
    selected_obs_path: &Path,
    validation_kind: &str,
) -> Result<PathBuf, AppError> {
    if validation_kind == "windows-portable" {
        return Ok(selected_obs_path
            .join("data")
            .join("obs-studio")
            .join("scripts"));
    }

    let config_root = dirs::config_dir()
        .ok_or_else(|| AppError::message("Could not resolve the system config directory."))?;
    Ok(config_root.join("obs-studio").join("scripts"))
}

fn build_script_attach_instructions(script_path: &Path) -> String {
    let script_display = script_path.display().to_string();
    format!(
        "Installed OBS Script:\n{}\n\nEnable it in OBS:\n1. Open OBS\n2. Go to Tools -> Scripts\n3. Click \"+\"\n4. Select this file: {}",
        script_display, script_display
    )
}

fn collect_copy_entries(
    operations: &[InstallCopyOperation],
    install_root: &Path,
) -> Result<Vec<CopyEntry>, AppError> {
    let mut entries = Vec::new();

    for operation in operations {
        if operation.from.is_file() {
            let relative_target = operation
                .to
                .strip_prefix(install_root)
                .unwrap_or(operation.to.as_path())
                .display()
                .to_string();
            entries.push(CopyEntry {
                source: operation.from.clone(),
                target: operation.to.clone(),
                relative_target,
            });
            continue;
        }

        for entry in WalkDir::new(&operation.from)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
        {
            let relative_source = entry
                .path()
                .strip_prefix(&operation.from)
                .map_err(|error| AppError::message(error.to_string()))?;
            let target = operation.to.join(relative_source);
            let relative_target = target
                .strip_prefix(install_root)
                .unwrap_or(target.as_path())
                .display()
                .to_string();

            entries.push(CopyEntry {
                source: entry.path().to_path_buf(),
                target,
                relative_target,
            });
        }
    }

    Ok(entries)
}

fn prune_empty_parent_dirs(start: Option<&Path>) {
    let mut current = start.map(Path::to_path_buf);

    while let Some(path) = current {
        let is_empty = fs::read_dir(&path)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);

        if !is_empty || fs::remove_dir(&path).is_err() {
            break;
        }

        current = path.parent().map(Path::to_path_buf);
    }
}

fn cleanup_created_targets(targets: &[PathBuf]) {
    for target in targets.iter().rev() {
        let _ = fs::remove_file(target);
        prune_empty_parent_dirs(target.parent());
    }
}

fn ensure_backup_root(app: &AppHandle, plugin_id: &str) -> Result<PathBuf, AppError> {
    let backup_root = app
        .path()
        .app_data_dir()?
        .join("install-backups")
        .join(plugin_id)
        .join(Utc::now().format("%Y%m%d-%H%M%S").to_string());
    fs::create_dir_all(&backup_root)?;
    Ok(backup_root)
}

fn backup_existing_target(
    backup_root: &Path,
    entry: &CopyEntry,
) -> Result<BackupEntry, AppError> {
    let backup_path = backup_root.join(&entry.relative_target);

    if let Some(parent) = backup_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::copy(&entry.target, &backup_path)?;

    Ok(BackupEntry {
        target: entry.target.clone(),
        backup: backup_path,
        relative_target: entry.relative_target.clone(),
    })
}

fn cleanup_backup_root(backup_root: Option<&Path>) {
    if let Some(root) = backup_root {
        let _ = fs::remove_dir_all(root);
    }
}

fn rollback_copy_session(outcome: &CopySessionOutcome) -> Vec<String> {
    let mut issues = Vec::new();

    cleanup_created_targets(&outcome.created_targets);

    for backup in outcome.backups.iter().rev() {
        if let Some(parent) = backup.target.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                issues.push(format!(
                    "Could not recreate {} before restoring backup: {}",
                    parent.display(),
                    error
                ));
                continue;
            }
        }

        if let Err(error) = fs::copy(&backup.backup, &backup.target) {
            issues.push(format!(
                "Could not restore {} from backup: {}",
                backup.relative_target, error
            ));
        }
    }

    cleanup_backup_root(outcome.backup_root.as_deref());
    issues
}

fn build_rollback_message(base: &str, issues: &[String]) -> String {
    if issues.is_empty() {
        format!("{base} Changes from this run were rolled back.")
    } else {
        format!(
            "{base} OBS Plugin Installer attempted to roll back the changes from this run, but some items still need manual attention: {}",
            issues.join(" | ")
        )
    }
}

fn verify_copy_session(entries: &[CopyEntry]) -> Result<(), Vec<String>> {
    let missing = entries
        .iter()
        .filter(|entry| !entry.target.exists())
        .map(|entry| entry.relative_target.clone())
        .collect::<Vec<_>>();

    if missing.is_empty() {
        Ok(())
    } else {
        Err(missing)
    }
}

fn build_install_backup_record(outcome: &CopySessionOutcome) -> Option<InstallBackupRecord> {
    let backup_root = outcome.backup_root.as_ref()?;
    let overwritten_files = outcome
        .backups
        .iter()
        .map(|backup| backup.relative_target.clone())
        .collect::<Vec<_>>();

    Some(InstallBackupRecord {
        backup_root: backup_root.display().to_string(),
        overwritten_files,
        created_files: outcome.created_relative_targets.clone(),
    })
}

fn cleanup_previous_backup(
    previous_record: Option<&InstalledPluginRecord>,
    next_backup_root: Option<&str>,
) {
    let Some(previous_backup_root) = previous_record
        .and_then(|record| record.backup.as_ref())
        .map(|backup| backup.backup_root.as_str())
    else {
        return;
    };

    if next_backup_root == Some(previous_backup_root) {
        return;
    }

    let _ = fs::remove_dir_all(previous_backup_root);
}

fn infer_install_history_action(
    previous_record: Option<&InstalledPluginRecord>,
    plugin_version: &str,
) -> InstallHistoryAction {
    match previous_record {
        None => InstallHistoryAction::Install,
        Some(previous) if previous.status == InstalledPluginStatus::MissingFiles => {
            InstallHistoryAction::Repair
        }
        Some(previous) if previous.installed_version != plugin_version => InstallHistoryAction::Update,
        Some(_) => InstallHistoryAction::Repair,
    }
}

fn copy_entries(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    entries: &[CopyEntry],
    overwrite: bool,
    install_label: &str,
    token: &Arc<AtomicBool>,
) -> Result<CopySessionOutcome, InstallResponse> {
    if entries.is_empty() {
        return Err(failure_response(
            &plugin.id,
            "EMPTY_PACKAGE",
            format!("{} did not contain any installable files.", plugin.name),
            app,
        ));
    }

    let conflicts = entries
        .iter()
        .filter(|entry| entry.target.exists())
        .map(|entry| entry.relative_target.clone())
        .collect::<Vec<_>>();

    if !conflicts.is_empty() && !overwrite {
        return Err(InstallResponse {
            success: false,
            code: Some("FILE_CONFLICT".to_string()),
            message: format!(
                "Installing {} would overwrite files that already exist in {}.",
                plugin.name, install_label
            ),
            installed_plugin: None,
            manual_installer_path: None,
            download_path: None,
            installer_started: false,
            can_open_installer_manually: false,
            requires_restart: false,
            conflicts: Some(conflicts),
            review_plan: None,
            selected_asset_name: None,
            selected_asset_reason: None,
            github_release_url: None,
        });
    }

    let total = entries.len();
    let mut outcome = CopySessionOutcome::default();
    outcome.tracked_files = Vec::with_capacity(total);

    for (index, entry) in entries.iter().enumerate() {
        if token.load(Ordering::SeqCst) {
            let issues = rollback_copy_session(&outcome);
            return Err(canceled_response(
                &plugin.id,
                build_rollback_message(
                    "The install was canceled before all files were copied.",
                    &issues,
                ),
                app,
            ));
        }

        let target_preexisted = entry.target.exists();
        if target_preexisted {
            let backup_root = match outcome.backup_root.clone() {
                Some(path) => path,
                None => match ensure_backup_root(app, &plugin.id) {
                    Ok(path) => {
                        outcome.backup_root = Some(path.clone());
                        path
                    }
                    Err(error) => {
                        return Err(failure_response(
                            &plugin.id,
                            "BACKUP_FAILED",
                            format!(
                                "Could not create a safe backup workspace before overwriting files in {}: {}",
                                install_label, error
                            ),
                            app,
                        ))
                    }
                },
            };
            match backup_existing_target(&backup_root, entry) {
                Ok(backup_entry) => outcome.backups.push(backup_entry),
                Err(error) => {
                    let issues = rollback_copy_session(&outcome);
                    return Err(failure_response(
                        &plugin.id,
                        "BACKUP_FAILED",
                        build_rollback_message(
                            &format!(
                                "Could not back up {} before overwriting it: {}",
                                entry.relative_target, error
                            ),
                            &issues,
                        ),
                        app,
                    ));
                }
            }
        }

        if let Some(parent) = entry.target.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                let issues = rollback_copy_session(&outcome);
                return Err(failure_response(
                    &plugin.id,
                    "INSTALL_FAILED",
                    build_rollback_message(
                        &format!("Could not create the install directory: {}", error),
                        &issues,
                    ),
                    app,
                ));
            }
        }

        if let Err(error) = fs::copy(&entry.source, &entry.target) {
            let issues = rollback_copy_session(&outcome);
            return Err(failure_response(
                &plugin.id,
                "INSTALL_FAILED",
                build_rollback_message(
                    &format!(
                        "Could not copy the downloaded files into {}: {}",
                        install_label, error
                    ),
                    &issues,
                ),
                app,
            ));
        }

        if !target_preexisted {
            outcome.created_targets.push(entry.target.clone());
            outcome
                .created_relative_targets
                .push(entry.relative_target.clone());
        }

        outcome.tracked_files.push(entry.relative_target.clone());

        let progress = 72 + (((index + 1) as f64 / total as f64) * 26.0).round() as u8;
        emit_progress(
            app,
            &plugin.id,
            "installing",
            progress.min(98),
            format!("Installing {}", plugin.name),
            Some(format!(
                "Copied {} of {} files into {}.",
                index + 1,
                total,
                install_label
            )),
            false,
        );
    }

    Ok(outcome)
}

fn open_path(target: &Path) -> Result<(), AppError> {
    open::that(target).map_err(|error| AppError::message(error.to_string()))
}

fn cancel_before_opening_download(
    token: &Arc<AtomicBool>,
    download_path: &Path,
) -> Result<(), AppError> {
    if token.load(Ordering::SeqCst) {
        let _ = fs::remove_file(download_path);
        return Err(AppError::canceled(
            "The download was canceled and the downloaded file was removed.",
        ));
    }

    Ok(())
}

fn external_install_guidance(
    file_type: Option<&PluginPackageFileType>,
) -> (&'static str, &'static str, bool) {
    match file_type {
        Some(PluginPackageFileType::Exe) | Some(PluginPackageFileType::Msi) => (
            "Windows installer",
            "The Windows installer started successfully. Follow the vendor prompts, then reopen OBS if needed.",
            false,
        ),
        Some(PluginPackageFileType::Pkg) | Some(PluginPackageFileType::Dmg) => (
            "macOS installer",
            "macOS will open the package next. Approve any Gatekeeper prompts, finish the installer, then restart OBS if needed.",
            false,
        ),
        Some(PluginPackageFileType::Deb) | Some(PluginPackageFileType::Rpm) => (
            "Linux package",
            "Your Linux package is ready. Open it with your package manager to finish the guided install.",
            false,
        ),
        Some(PluginPackageFileType::AppImage) => (
            "AppImage package",
            "The AppImage was downloaded. Open the folder, mark it executable if needed, and launch it from there.",
            true,
        ),
        _ => (
            "installer",
            "Finish the vendor flow to complete installation.",
            false,
        ),
    }
}

fn verify_downloaded_installer(download_path: &Path) -> Result<(), AppError> {
    if !download_path.exists() {
        return Err(AppError::message(format!(
            "The installer download finished, but the file could not be found at {}.",
            download_path.display()
        )));
    }

    if !download_path.is_file() {
        return Err(AppError::message(format!(
            "The downloaded installer path is not a file: {}.",
            download_path.display()
        )));
    }

    Ok(())
}

fn launch_windows_installer(download_path: &Path, file_type: &PluginPackageFileType) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use std::process::{Command, Stdio};

        let mut command = match file_type {
            PluginPackageFileType::Exe => {
                let command = Command::new(download_path);
                command
            }
            PluginPackageFileType::Msi => {
                let mut command = Command::new("msiexec");
                command.arg("/i").arg(download_path);
                command
            }
            _ => {
                return Err(AppError::message(
                    "Only .exe and .msi packages can be launched automatically on Windows.",
                ))
            }
        };

        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        command.spawn()?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (download_path, file_type);
        Err(AppError::message(
            "Automatic Windows installer launch is only available on Windows.",
        ))
    }
}

fn finalize_external_download(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    label: &str,
    download_path: &Path,
    package_id: Option<String>,
    file_type: Option<&PluginPackageFileType>,
) -> Result<InstallResponse, AppError> {
    let (_, guidance, open_parent_folder) = external_install_guidance(file_type);
    let is_windows_installer = matches!(
        file_type,
        Some(PluginPackageFileType::Exe) | Some(PluginPackageFileType::Msi)
    );

    emit_progress(
        app,
        &plugin.id,
        "verifying",
        94,
        format!("Verifying {}", label),
        Some(format!(
            "Checking that the downloaded installer exists at {}.",
            download_path.display()
        )),
        false,
    );

    verify_downloaded_installer(download_path)?;

    let mut installer_started = false;
    let mut can_open_installer_manually = false;
    let detail = if is_windows_installer {
        match launch_windows_installer(
            download_path,
            file_type.expect("windows installer file type should be set"),
        ) {
            Ok(()) => {
                installer_started = true;
                emit_progress(
                    app,
                    &plugin.id,
                    "launching-installer",
                    98,
                    format!("Launching {}", label),
                    Some(format!(
                        "Started {} from {}.",
                        label.to_ascii_lowercase(),
                        download_path.display()
                    )),
                    false,
                );
                guidance.to_string()
            }
            Err(error) => {
                can_open_installer_manually = true;
                format!(
                    "The installer was downloaded to {}, but it could not be started automatically: {}. Use “Open installer manually” to continue.",
                    download_path.display(),
                    error
                )
            }
        }
    } else {
        emit_progress(
            app,
            &plugin.id,
            "launching-installer",
            98,
            format!("Opening {}", label),
            Some(guidance.to_string()),
            false,
        );

        if open_parent_folder {
            open_path(download_path.parent().unwrap_or(download_path))?;
        } else {
            open_path(download_path)?;
        }

        guidance.to_string()
    };

    let mut state = load_state(app)?;
    let previous_record = state.installed_plugins.get(&plugin.id).cloned();
    let installed_plugin = InstalledPluginRecord {
        plugin_id: plugin.id.clone(),
        installed_version: plugin.version.clone(),
        installed_at: Utc::now().to_rfc3339(),
        managed: false,
        install_location: download_path
            .parent()
            .unwrap_or(download_path)
            .display()
            .to_string(),
        installed_files: Vec::new(),
        status: InstalledPluginStatus::ManualStep,
        source_type: InstalledPluginSourceType::ExternalInstaller,
        install_kind: InstallKind::Guided,
        package_id,
        download_path: Some(download_path.display().to_string()),
        install_method: Some(InstallMethod::Installer),
        backup: None,
        verification_status: Some(InstallVerificationStatus::Unverified),
        last_verified_at: Some(Utc::now().to_rfc3339()),
    };

    push_install_history(
        &mut state,
        InstallHistoryEntry {
            plugin_id: plugin.id.clone(),
            plugin_name: plugin.name.clone(),
            version: Some(plugin.version.clone()),
            action: infer_install_history_action(previous_record.as_ref(), &plugin.version),
            managed: false,
            install_location: Some(
                download_path
                    .parent()
                    .unwrap_or(download_path)
                    .display()
                    .to_string(),
            ),
            message: detail.clone(),
            timestamp: Utc::now().to_rfc3339(),
            file_count: 0,
            backup_root: None,
            verification_status: Some(InstallVerificationStatus::Unverified),
        },
    );
    state
        .installed_plugins
        .insert(plugin.id.clone(), installed_plugin.clone());
    save_state(app, &state)?;
    cleanup_previous_backup(previous_record.as_ref(), None);

    emit_progress(
        app,
        &plugin.id,
        "manual",
        100,
        if installer_started {
            "Installer started".to_string()
        } else {
            format!("{} downloaded", label)
        },
        Some(detail.clone()),
        true,
    );

    Ok(InstallResponse {
        success: true,
        code: None,
        message: if installer_started {
            format!(
                "{} downloaded successfully and the installer started.",
                plugin.name
            )
        } else {
            format!(
                "{} downloaded successfully, but the installer could not be started automatically.",
                plugin.name
            )
        },
        installed_plugin: Some(installed_plugin),
        manual_installer_path: if can_open_installer_manually {
            Some(download_path.display().to_string())
        } else {
            None
        },
        download_path: Some(download_path.display().to_string()),
        installer_started,
        can_open_installer_manually,
        requires_restart: false,
        conflicts: None,
        review_plan: None,
        selected_asset_name: None,
        selected_asset_reason: None,
        github_release_url: None,
    })
}

fn resolved_obs_location(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
) -> Result<crate::commands::validate_obs::ResolvedObsLocation, InstallResponse> {
    let state = load_state(app).map_err(|error| {
        failure_response(&plugin.id, "OBS_PATH_INVALID", error.to_string(), app)
    })?;

    let Some(ref obs_path) = state.settings.obs_path else {
        return Err(failure_response(
            &plugin.id,
            "OBS_PATH_INVALID",
            "OBS Studio is not configured yet. Finish setup before installing plugins.",
            app,
        ));
    };

    let resolved_obs = validate_obs_path(Path::new(obs_path)).map_err(|error| {
        failure_response(&plugin.id, "OBS_PATH_INVALID", error.to_string(), app)
    })?;
    let resolved_obs = apply_saved_install_scope(resolved_obs, &state.settings);

    if !resolved_obs.is_supported {
        return Err(failure_response(
            &plugin.id,
            "OBS_PATH_UNSUPPORTED",
            resolved_obs.message.clone(),
            app,
        ));
    }

    Ok(resolved_obs)
}

fn finalize_archive_download(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    archive_path: &Path,
    file_type: &PluginPackageFileType,
    overwrite: bool,
    package_id: Option<String>,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    let extracted_path = archive_path
        .parent()
        .unwrap_or(archive_path)
        .join("extracted");

    check_canceled(
        token,
        "The install was canceled before extraction started.",
    )?;

    emit_progress(
        app,
        &plugin.id,
        "extracting",
        56,
        format!("Extracting {}", plugin.name),
        Some("Unpacking the archive into a temporary workspace.".to_string()),
        false,
    );

    extract_archive(archive_path, &extracted_path, file_type, &|| {
        token.load(Ordering::SeqCst)
    })?;

    check_canceled(
        token,
        "The install was canceled after extraction completed.",
    )?;

    emit_progress(
        app,
        &plugin.id,
        "inspecting",
        66,
        format!("Inspecting {}", plugin.name),
        Some("Checking the package structure before anything is copied.".to_string()),
        false,
    );

    check_canceled(
        token,
        "The install was canceled while inspecting the package.",
    )?;

    if let Ok(layout) = detect_archive_layout(&extracted_path, plugin, &SupportedPlatform::current())
    {
        if let ArchiveLayout::StandaloneTool { source_root } = &layout {
            return finalize_standalone_tool_install(
                app,
                plugin,
                source_root,
                overwrite,
                package_id,
                token,
            );
        }

        let resolved_obs = match resolved_obs_location(app, plugin) {
            Ok(resolved_obs) => resolved_obs,
            Err(response) => return Ok(response),
        };
        let operations =
            build_install_operations(&layout, plugin, &resolved_obs.install_target_path)?;
        return finalize_obs_archive_install(
            app,
            plugin,
            operations,
            &resolved_obs.install_target_path,
            &resolved_obs.install_target_label,
            overwrite,
            package_id,
            token,
        );
    }

    check_canceled(
        token,
        "The install was canceled while inspecting the package.",
    )?;

    let planned = inspect_archive_install(&extracted_path, plugin, &SupportedPlatform::current())?;

    match planned.kind {
        PlannedArchiveKind::ObsPlugin => {
            let resolved_obs = match resolved_obs_location(app, plugin) {
                Ok(resolved_obs) => resolved_obs,
                Err(response) => return Ok(response),
            };
            let operations = build_planned_install_operations(
                &planned,
                plugin,
                &resolved_obs.install_target_path,
            )?;

            finalize_obs_archive_install(
                app,
                plugin,
                operations,
                &resolved_obs.install_target_path,
                &resolved_obs.install_target_label,
                overwrite,
                package_id,
                token,
            )
        }
        PlannedArchiveKind::StandaloneTool => {
            let install_root = ensure_managed_tools_directory(app)?.join(&plugin.module_name);
            let operations =
                build_planned_install_operations(&planned, plugin, &install_root)?;

            finalize_standalone_operations_install(
                app,
                plugin,
                operations,
                &install_root,
                overwrite,
                package_id,
                token,
            )
        }
        PlannedArchiveKind::Review => Ok(review_response(
            &plugin.id,
            planned.review_plan.summary.clone(),
            planned.review_plan,
            app,
        )),
    }
}

fn finalize_obs_archive_install(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    operations: Vec<InstallCopyOperation>,
    install_root: &Path,
    install_label: &str,
    overwrite: bool,
    package_id: Option<String>,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    let entries = collect_copy_entries(&operations, install_root)?;
    let copy_outcome = match copy_entries(app, plugin, &entries, overwrite, install_label, token) {
        Ok(copy_outcome) => copy_outcome,
        Err(response) => return Ok(response),
    };
    if let Err(missing_files) = verify_copy_session(&entries) {
        let rollback_issues = rollback_copy_session(&copy_outcome);
        return Ok(failure_response(
            &plugin.id,
            "INSTALL_VERIFY_FAILED",
            build_rollback_message(
                &format!(
                    "The install finished copying files, but verification failed. Missing files: {}",
                    missing_files.join(", ")
                ),
                &rollback_issues,
            ),
            app,
        ));
    }

    let mut state = load_state(app)?;
    let previous_record = state.installed_plugins.get(&plugin.id).cloned();
    let installed_plugin = InstalledPluginRecord {
        plugin_id: plugin.id.clone(),
        installed_version: plugin.version.clone(),
        installed_at: Utc::now().to_rfc3339(),
        managed: true,
        install_location: install_root.display().to_string(),
        installed_files: copy_outcome.tracked_files.clone(),
        status: InstalledPluginStatus::Installed,
        source_type: InstalledPluginSourceType::Archive,
        install_kind: InstallKind::Full,
        package_id,
        download_path: None,
        install_method: Some(InstallMethod::Managed),
        backup: build_install_backup_record(&copy_outcome),
        verification_status: Some(InstallVerificationStatus::Verified),
        last_verified_at: Some(Utc::now().to_rfc3339()),
    };
    push_install_history(
        &mut state,
        InstallHistoryEntry {
            plugin_id: plugin.id.clone(),
            plugin_name: plugin.name.clone(),
            version: Some(plugin.version.clone()),
            action: infer_install_history_action(previous_record.as_ref(), &plugin.version),
            managed: true,
            install_location: Some(install_root.display().to_string()),
            message: "Managed OBS plugin install completed and verification passed.".to_string(),
            timestamp: Utc::now().to_rfc3339(),
            file_count: copy_outcome.tracked_files.len(),
            backup_root: installed_plugin
                .backup
                .as_ref()
                .map(|backup| backup.backup_root.clone()),
            verification_status: Some(InstallVerificationStatus::Verified),
        },
    );
    state
        .installed_plugins
        .insert(plugin.id.clone(), installed_plugin.clone());
    save_state(app, &state)?;
    cleanup_previous_backup(
        previous_record.as_ref(),
        installed_plugin
            .backup
            .as_ref()
            .map(|backup| backup.backup_root.as_str()),
    );

    emit_progress(
        app,
        &plugin.id,
        "completed",
        100,
        format!("{} installed successfully", plugin.name),
        Some("Restart OBS Studio so the new plugin loads cleanly.".to_string()),
        true,
    );

    Ok(InstallResponse {
        success: true,
        code: None,
        message: format!("{} was installed successfully.", plugin.name),
        installed_plugin: Some(installed_plugin),
        manual_installer_path: None,
        download_path: None,
        installer_started: false,
        can_open_installer_manually: false,
        requires_restart: true,
        conflicts: None,
        review_plan: None,
        selected_asset_name: None,
        selected_asset_reason: None,
        github_release_url: None,
    })
}

fn finalize_standalone_tool_install(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    source_root: &Path,
    overwrite: bool,
    package_id: Option<String>,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    let install_root = ensure_managed_tools_directory(app)?.join(&plugin.module_name);
    let operations = build_install_operations(
        &ArchiveLayout::StandaloneTool {
            source_root: source_root.to_path_buf(),
        },
        plugin,
        &install_root,
    )?;
    finalize_standalone_operations_install(
        app,
        plugin,
        operations,
        &install_root,
        overwrite,
        package_id,
        token,
    )
}

fn finalize_standalone_operations_install(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    operations: Vec<InstallCopyOperation>,
    install_root: &Path,
    overwrite: bool,
    package_id: Option<String>,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    let entries = collect_copy_entries(&operations, install_root)?;
    let copy_outcome = match copy_entries(
        app,
        plugin,
        &entries,
        overwrite,
        "the managed desktop tools folder",
        token,
    ) {
        Ok(copy_outcome) => copy_outcome,
        Err(response) => return Ok(response),
    };
    if let Err(missing_files) = verify_copy_session(&entries) {
        let rollback_issues = rollback_copy_session(&copy_outcome);
        return Ok(failure_response(
            &plugin.id,
            "INSTALL_VERIFY_FAILED",
            build_rollback_message(
                &format!(
                    "The tool install finished copying files, but verification failed. Missing files: {}",
                    missing_files.join(", ")
                ),
                &rollback_issues,
            ),
            app,
        ));
    }

    let mut state = load_state(app)?;
    let previous_record = state.installed_plugins.get(&plugin.id).cloned();
    let installed_plugin = InstalledPluginRecord {
        plugin_id: plugin.id.clone(),
        installed_version: plugin.version.clone(),
        installed_at: Utc::now().to_rfc3339(),
        managed: true,
        install_location: install_root.display().to_string(),
        installed_files: copy_outcome.tracked_files.clone(),
        status: InstalledPluginStatus::Installed,
        source_type: InstalledPluginSourceType::StandaloneTool,
        install_kind: InstallKind::Full,
        package_id,
        download_path: Some(install_root.display().to_string()),
        install_method: Some(InstallMethod::Managed),
        backup: build_install_backup_record(&copy_outcome),
        verification_status: Some(InstallVerificationStatus::Verified),
        last_verified_at: Some(Utc::now().to_rfc3339()),
    };
    push_install_history(
        &mut state,
        InstallHistoryEntry {
            plugin_id: plugin.id.clone(),
            plugin_name: plugin.name.clone(),
            version: Some(plugin.version.clone()),
            action: infer_install_history_action(previous_record.as_ref(), &plugin.version),
            managed: true,
            install_location: Some(install_root.display().to_string()),
            message: "Managed desktop tool install completed and verification passed.".to_string(),
            timestamp: Utc::now().to_rfc3339(),
            file_count: copy_outcome.tracked_files.len(),
            backup_root: installed_plugin
                .backup
                .as_ref()
                .map(|backup| backup.backup_root.clone()),
            verification_status: Some(InstallVerificationStatus::Verified),
        },
    );
    state
        .installed_plugins
        .insert(plugin.id.clone(), installed_plugin.clone());
    save_state(app, &state)?;
    cleanup_previous_backup(
        previous_record.as_ref(),
        installed_plugin
            .backup
            .as_ref()
            .map(|backup| backup.backup_root.as_str()),
    );

    emit_progress(
        app,
        &plugin.id,
        "completed",
        100,
        format!("{} installed successfully", plugin.name),
        Some(
            "This resource was installed as a standalone desktop tool. Launch it from the installed folder and capture or link it in OBS as needed."
                .to_string(),
        ),
        true,
    );

    Ok(InstallResponse {
        success: true,
        code: None,
        message: format!(
            "{} was installed into the managed desktop tools library.",
            plugin.name
        ),
        installed_plugin: Some(installed_plugin),
        manual_installer_path: None,
        download_path: Some(install_root.display().to_string()),
        installer_started: false,
        can_open_installer_manually: false,
        requires_restart: false,
        conflicts: None,
        review_plan: None,
        selected_asset_name: None,
        selected_asset_reason: None,
        github_release_url: None,
    })
}

fn install_script_file(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    downloaded_file: &Path,
    filename: &str,
    overwrite: bool,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    let resolved_obs = match resolved_obs_location(app, plugin) {
        Ok(resolved_obs) => resolved_obs,
        Err(response) => return Ok(response),
    };

    let scripts_root =
        managed_script_root(&resolved_obs.selected_path, &resolved_obs.validation_kind)?;
    let target_path = scripts_root.join(&plugin.module_name).join(filename);
    let relative_target = target_path
        .strip_prefix(&scripts_root)
        .unwrap_or(target_path.as_path())
        .display()
        .to_string();

    let copy_outcome = match copy_entries(
        app,
        plugin,
        &[CopyEntry {
            source: downloaded_file.to_path_buf(),
            target: target_path.clone(),
            relative_target,
        }],
        overwrite,
        "your managed OBS scripts library",
        token,
    ) {
        Ok(copy_outcome) => copy_outcome,
        Err(response) => return Ok(response),
    };
    if let Err(missing_files) = verify_copy_session(&[CopyEntry {
        source: downloaded_file.to_path_buf(),
        target: target_path.clone(),
        relative_target: copy_outcome
            .tracked_files
            .first()
            .cloned()
            .unwrap_or_else(|| filename.to_string()),
    }]) {
        let rollback_issues = rollback_copy_session(&copy_outcome);
        return Ok(failure_response(
            &plugin.id,
            "INSTALL_VERIFY_FAILED",
            build_rollback_message(
                &format!(
                    "The script file was copied, but verification failed. Missing files: {}",
                    missing_files.join(", ")
                ),
                &rollback_issues,
            ),
            app,
        ));
    }

    let mut state = load_state(app)?;
    let previous_record = state.installed_plugins.get(&plugin.id).cloned();
    let installed_plugin = InstalledPluginRecord {
        plugin_id: plugin.id.clone(),
        installed_version: plugin.version.clone(),
        installed_at: Utc::now().to_rfc3339(),
        managed: true,
        install_location: scripts_root.display().to_string(),
        installed_files: copy_outcome.tracked_files.clone(),
        status: InstalledPluginStatus::ManualStep,
        source_type: InstalledPluginSourceType::Script,
        install_kind: InstallKind::Full,
        package_id: None,
        download_path: Some(target_path.display().to_string()),
        install_method: Some(InstallMethod::Managed),
        backup: build_install_backup_record(&copy_outcome),
        verification_status: Some(InstallVerificationStatus::Verified),
        last_verified_at: Some(Utc::now().to_rfc3339()),
    };
    push_install_history(
        &mut state,
        InstallHistoryEntry {
            plugin_id: plugin.id.clone(),
            plugin_name: plugin.name.clone(),
            version: Some(plugin.version.clone()),
            action: infer_install_history_action(previous_record.as_ref(), &plugin.version),
            managed: true,
            install_location: Some(scripts_root.display().to_string()),
            message: format!(
                "OBS script copied successfully. Attach it in OBS from {}.",
                target_path.display()
            ),
            timestamp: Utc::now().to_rfc3339(),
            file_count: copy_outcome.tracked_files.len(),
            backup_root: installed_plugin
                .backup
                .as_ref()
                .map(|backup| backup.backup_root.clone()),
            verification_status: Some(InstallVerificationStatus::Verified),
        },
    );
    state
        .installed_plugins
        .insert(plugin.id.clone(), installed_plugin.clone());
    save_state(app, &state)?;
    cleanup_previous_backup(
        previous_record.as_ref(),
        installed_plugin
            .backup
            .as_ref()
            .map(|backup| backup.backup_root.as_str()),
    );

    let attach_instructions = build_script_attach_instructions(&target_path);

    emit_progress(
        app,
        &plugin.id,
        "completed",
        100,
        format!("{} copied into OBS scripts", plugin.name),
        Some(attach_instructions.clone()),
        true,
    );

    Ok(InstallResponse {
        success: true,
        code: None,
        message: format!(
            "{} was installed as an OBS Script at {}. In OBS, open Tools -> Scripts, click \"+\", and select that exact file.",
            plugin.name,
            target_path.display()
        ),
        installed_plugin: Some(installed_plugin),
        manual_installer_path: None,
        download_path: Some(target_path.display().to_string()),
        installer_started: false,
        can_open_installer_manually: false,
        requires_restart: false,
        conflicts: None,
        review_plan: None,
        selected_asset_name: None,
        selected_asset_reason: None,
        github_release_url: None,
    })
}

fn install_external_package(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    package: &PluginPackage,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    emit_progress(
        app,
        &plugin.id,
        "preparing",
        5,
        format!("Preparing {}", plugin.name),
        Some("Downloading the vendor installer to your Downloads folder.".to_string()),
        false,
    );

    let downloads_dir = ensure_download_directory(app)?;
    let download_path = downloads_dir.join(filename_from_url(
        &package.download_url,
        &format!("{}-{}", plugin.id, plugin.version),
    ));

    download_file(app, plugin, package, &download_path, token)?;
    cancel_before_opening_download(token, &download_path)?;
    finalize_external_download(
        app,
        plugin,
        &package.label,
        &download_path,
        Some(package.id.clone()),
        Some(&package.file_type),
    )
}

fn install_archive_package(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    package: &PluginPackage,
    overwrite: bool,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    emit_progress(
        app,
        &plugin.id,
        "preparing",
        4,
        format!("Preparing {}", plugin.name),
        Some("Creating a temporary workspace and validating your OBS folders.".to_string()),
        false,
    );

    let temp_root = app.path().temp_dir()?;
    let working_dir = Builder::new()
        .prefix(&format!("obs-plugin-installer-{}-", plugin.id))
        .tempdir_in(temp_root)?;
    let archive_filename =
        filename_from_url(&package.download_url, &format!("{}-package", plugin.id));
    let archive_path = working_dir.path().join(archive_filename);

    download_file(app, plugin, package, &archive_path, token)?;

    finalize_archive_download(
        app,
        plugin,
        &archive_path,
        &package.file_type,
        overwrite,
        Some(package.id.clone()),
        token,
    )
}

fn install_github_release_asset(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    selection: GitHubInstallSelection,
    overwrite: bool,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    emit_progress(
        app,
        &plugin.id,
        "preparing",
        5,
        format!("Preparing {}", plugin.name),
        Some(format!(
            "Selected asset: {}. Reason: {}",
            selection.asset.name, selection.asset.reason
        )),
        false,
    );

    let response = match selection.asset.install_type {
        PluginPackageInstallType::Archive => {
            let temp_root = app.path().temp_dir()?;
            let working_dir = Builder::new()
                .prefix(&format!("obs-plugin-installer-{}-", plugin.id))
                .tempdir_in(temp_root)?;
            let archive_path = working_dir.path().join(&selection.asset.name);
            download_url(app, plugin, &selection.asset.download_url, &archive_path, token)?;
            finalize_archive_download(
                app,
                plugin,
                &archive_path,
                &selection.asset.file_type,
                overwrite,
                None,
                token,
            )?
        }
        PluginPackageInstallType::External => {
            let downloads_dir = ensure_download_directory(app)?;
            let download_path = downloads_dir.join(&selection.asset.name);
            download_url(app, plugin, &selection.asset.download_url, &download_path, token)?;
            cancel_before_opening_download(token, &download_path)?;
            let (label, _, _) = external_install_guidance(Some(&selection.asset.file_type));
            finalize_external_download(
                app,
                plugin,
                label,
                &download_path,
                None,
                Some(&selection.asset.file_type),
            )?
        }
        PluginPackageInstallType::Guide => {
            failure_response(
                &plugin.id,
                "MANUAL_ONLY",
                format!(
                    "{} did not expose an installable binary in its selected GitHub release asset.",
                    plugin.name
                ),
                app,
            )
        }
    };

    Ok(attach_github_metadata(
        response,
        Some(&selection.asset),
        Some(&selection.release.release_url),
    ))
}

fn install_resource_import(
    app: &AppHandle,
    plugin: &PluginCatalogEntry,
    overwrite: bool,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    let resource_urls = resource_candidate_urls(plugin);
    if resource_urls.is_empty() {
        return Ok(failure_response(
            &plugin.id,
            "MANUAL_ONLY",
            format!(
                "{} does not have an official download URL in the local catalog yet.",
                plugin.name
            ),
            app,
        ));
    }

    emit_progress(
        app,
        &plugin.id,
        "preparing",
        4,
        format!("Preparing {}", plugin.name),
        Some("Resolving the official download source for this catalog import.".to_string()),
        false,
    );

    let client = Client::builder().build()?;
    let fallback_filename = format!("{}-{}", plugin.id, plugin.version);
    let mut resolved_download = None;
    let mut last_error = None;

    for resource_url in resource_urls {
        check_canceled(
            token,
            "The install was canceled while resolving the official download source.",
        )?;
        match resolve_resource_download(&client, &resource_url, &fallback_filename) {
            Ok(result) => {
                resolved_download = Some(result);
                break;
            }
            Err(error) => last_error = Some(error),
        }
    }

    let Some(resolved_download) = resolved_download else {
        return Ok(failure_response(
      &plugin.id,
      "UNSUPPORTED_FORMAT",
      last_error
        .map(|error| error.to_string())
        .unwrap_or_else(|| {
          "The official resource page did not expose a direct downloadable package for one-click install."
            .to_string()
        }),
      app,
    ));
    };

    let ResolvedResourceDownload {
        response,
        filename,
        kind,
    } = resolved_download;

    match kind {
        ResolvedResourceKind::External => {
            let downloads_dir = ensure_download_directory(app)?;
            let download_path = downloads_dir.join(&filename);
            write_download_response(
                app,
                &plugin.id,
                &plugin.name,
                response,
                &download_path,
                token,
            )?;
            cancel_before_opening_download(token, &download_path)?;
            finalize_external_download(
                app,
                plugin,
                "official installer",
                &download_path,
                None,
                None,
            )
        }
        ResolvedResourceKind::Archive(file_type) => {
            let temp_root = app.path().temp_dir()?;
            let working_dir = Builder::new()
                .prefix(&format!("obs-plugin-installer-{}-", plugin.id))
                .tempdir_in(temp_root)?;
            let archive_path = working_dir.path().join(&filename);
            write_download_response(
                app,
                &plugin.id,
                &plugin.name,
                response,
                &archive_path,
                token,
            )?;
            finalize_archive_download(app, plugin, &archive_path, &file_type, overwrite, None, token)
        }
        ResolvedResourceKind::Script => {
            let temp_root = app.path().temp_dir()?;
            let working_dir = Builder::new()
                .prefix(&format!("obs-plugin-installer-{}-", plugin.id))
                .tempdir_in(temp_root)?;
            let script_path = working_dir.path().join(&filename);
            write_download_response(
                app,
                &plugin.id,
                &plugin.name,
                response,
                &script_path,
                token,
            )?;
            install_script_file(app, plugin, &script_path, &filename, overwrite, token)
        }
    }
}

fn do_install_plugin(
    app: &AppHandle,
    request: InstallRequest,
    token: &Arc<AtomicBool>,
) -> Result<InstallResponse, AppError> {
    let catalog = load_plugin_catalog()?;
    let Some(plugin) = catalog.iter().find(|plugin| plugin.id == request.plugin_id) else {
        return Ok(failure_response(
            &request.plugin_id,
            "PLUGIN_NOT_FOUND",
            "The requested plugin is not part of the current catalog.",
            app,
        ));
    };

    let github_requested =
        request.github_asset_name.is_some() || request.github_asset_url.is_some();
    let can_use_github_release = github_requested || request.package_id.is_none();

    if can_use_github_release {
        match resolve_github_asset_for_install(plugin, &request) {
            Ok(GitHubSelectionResolution::Selected(selection)) => {
                return install_github_release_asset(
                    app,
                    plugin,
                    selection,
                    request.overwrite.unwrap_or(false),
                    token,
                );
            }
            Ok(GitHubSelectionResolution::Unavailable {
                code,
                message,
                release_url,
            }) => {
                if plugin.guide_only || plugin.packages.is_empty() || github_requested {
                    return Ok(attach_github_metadata(
                        failure_response(&plugin.id, &code, message, app),
                        None,
                        release_url.as_deref(),
                    ));
                }

                log::info!(
                    "github install unavailable, falling back to curated package: plugin={} reason={}",
                    plugin.id,
                    code
                );
            }
            Ok(GitHubSelectionResolution::NotApplicable) => {}
            Err(error) => {
                if plugin.guide_only || plugin.packages.is_empty() || github_requested {
                    return Ok(failure_response(
                        &plugin.id,
                        "GITHUB_RELEASE_FETCH_FAILED",
                        format!(
                            "Could not load GitHub release data for {}: {}",
                            plugin.name, error
                        ),
                        app,
                    ));
                }

                log::warn!(
                    "github release fetch failed, falling back to curated package: plugin={} error={}",
                    plugin.id,
                    error
                );
            }
        }
    }

    if plugin.guide_only {
        return install_resource_import(app, plugin, request.overwrite.unwrap_or(false), token);
    }

    let platform = SupportedPlatform::current();
    let Some(package) = plugin.package_for(request.package_id.as_deref(), &platform) else {
        return Ok(InstallResponse {
            success: false,
            code: Some("UNSUPPORTED_OS".to_string()),
            message: format!(
                "{} does not currently have a curated package for {}.",
                plugin.name,
                platform.as_str()
            ),
            installed_plugin: None,
            manual_installer_path: None,
            download_path: None,
            installer_started: false,
            can_open_installer_manually: false,
            requires_restart: false,
            conflicts: None,
            review_plan: None,
            selected_asset_name: None,
            selected_asset_reason: None,
            github_release_url: None,
        });
    };

    match package.install_type {
        PluginPackageInstallType::Guide => Ok(InstallResponse {
            success: false,
            code: Some("MANUAL_ONLY".to_string()),
            message: format!(
        "{} currently requires the official upstream guide instead of an automatable package.",
        plugin.name
      ),
            installed_plugin: None,
            manual_installer_path: None,
            download_path: None,
            installer_started: false,
            can_open_installer_manually: false,
            requires_restart: false,
            conflicts: None,
            review_plan: None,
            selected_asset_name: None,
            selected_asset_reason: None,
            github_release_url: None,
        }),
        PluginPackageInstallType::External => install_external_package(app, plugin, package, token),
        PluginPackageInstallType::Archive => {
            install_archive_package(
                app,
                plugin,
                package,
                request.overwrite.unwrap_or(false),
                token,
            )
        }
    }
}

#[tauri::command]
pub async fn install_plugin(
    app: AppHandle,
    registry: tauri::State<'_, InstallCancellationRegistry>,
    request: InstallRequest,
) -> Result<InstallResponse, String> {
    let plugin_id = request.plugin_id.clone();
    let token = registry.begin(&plugin_id);
    let app_for_task = app.clone();

    let task_result = tauri::async_runtime::spawn_blocking(move || {
        do_install_plugin(&app_for_task, request, &token)
    })
    .await
    .map_err(|error| error.to_string());

    registry.finish(&plugin_id);

    match task_result {
        Ok(Ok(response)) => Ok(response),
        Ok(Err(error)) if error.is_canceled() => {
            Ok(canceled_response(&plugin_id, error.to_string(), &app))
        }
        Ok(Err(error)) => Err(error.to_string()),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub fn cancel_plugin_install(
    registry: tauri::State<'_, InstallCancellationRegistry>,
    plugin_id: String,
) -> Result<CancelInstallResponse, String> {
    let canceled = registry.cancel(&plugin_id);
    Ok(CancelInstallResponse {
        canceled,
        message: if canceled {
            "Cancellation requested. OBS Plugin Installer will stop this install safely.".to_string()
        } else {
            "No active install was found for that plugin.".to_string()
        },
    })
}

#[tauri::command]
pub async fn get_github_release_info(
    plugin_id: String,
) -> Result<Option<GitHubReleaseInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = load_plugin_catalog().map_err(|error| error.to_string())?;
        let plugin = catalog
            .iter()
            .find(|plugin| plugin.id == plugin_id)
            .ok_or_else(|| "The requested plugin is not part of the current catalog.".to_string())?;

        fetch_github_release_info(plugin)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    open::that(url).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if target.is_file() {
        let parent = target
            .parent()
            .ok_or_else(|| "Could not resolve the file’s parent folder.".to_string())?;
        open::that(parent).map_err(|error| error.to_string())
    } else {
        open::that(target).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn open_local_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(format!(
            "The local file could not be found at {}.",
            target.display()
        ));
    }

    open::that(target).map_err(|error| error.to_string())
}
