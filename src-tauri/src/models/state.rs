use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::plugin::{PluginCatalogEntry, PluginPackageFileType, PluginPackageInstallType};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub obs_path: Option<String>,
    pub setup_completed: bool,
    pub launch_on_startup: bool,
    pub minimize_to_tray: bool,
    pub language: String,
    pub auto_detect_obs_version: bool,
    pub install_scope: String,
    pub theme: String,
    pub accent_color: String,
    pub auto_update_plugins: bool,
    pub beta_updates: bool,
    pub desktop_notifications: bool,
    pub release_notifications: bool,
    pub developer_news: bool,
    pub developer_mode: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            obs_path: None,
            setup_completed: false,
            launch_on_startup: true,
            minimize_to_tray: false,
            language: "English (US)".to_string(),
            auto_detect_obs_version: true,
            install_scope: "user".to_string(),
            theme: "dark".to_string(),
            accent_color: "purple".to_string(),
            auto_update_plugins: true,
            beta_updates: false,
            desktop_notifications: true,
            release_notifications: true,
            developer_news: false,
            developer_mode: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ObsDetectionState {
    pub platform: String,
    pub stored_path: Option<String>,
    pub detected_path: Option<String>,
    pub install_target_path: Option<String>,
    pub install_target_label: Option<String>,
    pub validation_kind: Option<String>,
    pub is_valid: bool,
    pub is_supported: bool,
    pub requires_manual_selection: bool,
    pub message: String,
    pub checked_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InstalledPluginStatus {
    Installed,
    ManualStep,
    MissingFiles,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InstalledPluginSourceType {
    Archive,
    ExternalInstaller,
    Script,
    StandaloneTool,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InstallKind {
    Full,
    Guided,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InstallReviewDetectedKind {
    ObsPlugin,
    StandaloneTool,
    Ambiguous,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReviewItem {
    pub source_path: String,
    pub proposed_destination: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReviewPlan {
    pub detected_kind: InstallReviewDetectedKind,
    pub summary: String,
    pub next_action: String,
    pub items: Vec<InstallReviewItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubReleaseAssetOption {
    pub name: String,
    pub download_url: String,
    pub label: String,
    pub file_type: PluginPackageFileType,
    pub install_type: PluginPackageInstallType,
    pub score: i32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRejectedAsset {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubReleaseInfo {
    pub repo: String,
    pub release_name: String,
    pub tag_name: String,
    pub release_url: String,
    pub published_at: Option<String>,
    pub selected_asset: Option<GitHubReleaseAssetOption>,
    pub alternative_assets: Vec<GitHubReleaseAssetOption>,
    pub rejected_assets: Vec<GitHubRejectedAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPluginRecord {
    pub plugin_id: String,
    pub installed_version: String,
    pub installed_at: String,
    #[serde(default = "default_managed_true")]
    pub managed: bool,
    pub install_location: String,
    pub installed_files: Vec<String>,
    pub status: InstalledPluginStatus,
    pub source_type: InstalledPluginSourceType,
    pub install_kind: InstallKind,
    pub package_id: Option<String>,
    pub download_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    pub settings: AppSettings,
    pub installed_plugins: BTreeMap<String, InstalledPluginRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    pub settings: AppSettings,
    pub obs_detection: ObsDetectionState,
    pub plugins: Vec<PluginCatalogEntry>,
    pub installed_plugins: Vec<InstalledPluginRecord>,
    pub current_platform: String,
    pub current_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateSnapshot {
    pub status: String,
    pub message: String,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub minimum_supported_version: Option<String>,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
    pub update_channel: String,
    pub release_tag: Option<String>,
    pub release_url: Option<String>,
    pub selected_asset_name: Option<String>,
    pub selected_asset_reason: Option<String>,
    pub selected_asset_url: Option<String>,
    pub selected_asset_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateProgressEvent {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub progress_percent: Option<f64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub plugin_id: String,
    pub package_id: Option<String>,
    pub overwrite: Option<bool>,
    pub github_asset_name: Option<String>,
    pub github_asset_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResponse {
    pub success: bool,
    pub code: Option<String>,
    pub message: String,
    pub installed_plugin: Option<InstalledPluginRecord>,
    pub manual_installer_path: Option<String>,
    pub download_path: Option<String>,
    #[serde(default)]
    pub installer_started: bool,
    #[serde(default)]
    pub can_open_installer_manually: bool,
    pub requires_restart: bool,
    pub conflicts: Option<Vec<String>>,
    pub review_plan: Option<InstallReviewPlan>,
    pub selected_asset_name: Option<String>,
    pub selected_asset_reason: Option<String>,
    pub github_release_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgressEvent {
    pub plugin_id: String,
    pub stage: String,
    pub progress: u8,
    pub message: String,
    pub detail: Option<String>,
    pub terminal: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelInstallResponse {
    pub canceled: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopActionResponse {
    pub message: String,
    pub path: Option<String>,
    pub count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallResponse {
    pub success: bool,
    pub message: String,
    pub removed_files: usize,
    pub removed_directories: usize,
}

fn default_managed_true() -> bool {
    true
}
