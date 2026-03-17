use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SupportedPlatform {
    Windows,
    Macos,
    Linux,
}

impl SupportedPlatform {
    pub fn current() -> Self {
        match std::env::consts::OS {
            "windows" => Self::Windows,
            "macos" => Self::Macos,
            "linux" => Self::Linux,
            _ => Self::Linux,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Macos => "macos",
            Self::Linux => "linux",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginPackageInstallType {
    Archive,
    External,
    Guide,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginInstallStrategyKind {
    ObsPlugin,
    StandaloneTool,
    Hybrid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ResourceInstallType {
    #[serde(rename = "native_plugin")]
    NativePlugin,
    #[serde(rename = "script_file", alias = "obs_script")]
    ScriptFile,
    #[serde(rename = "external_installer")]
    ExternalInstaller,
    #[serde(rename = "zip_extract")]
    ZipExtract,
    #[serde(rename = "browser_source_bundle")]
    BrowserSourceBundle,
    #[serde(rename = "dock_bundle", alias = "custom_dock_bundle")]
    DockBundle,
    #[serde(rename = "theme_bundle")]
    ThemeBundle,
    #[serde(rename = "manual_guide", alias = "guide_only")]
    ManualGuide,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallStrategy {
    pub kind: Option<PluginInstallStrategyKind>,
    #[serde(default)]
    pub module_name_aliases: Vec<String>,
    #[serde(default)]
    pub binary_name_hints: Vec<String>,
    #[serde(default)]
    pub resource_dir_hints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginPrimaryEntryFile {
    pub role: String,
    pub label: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginSetupAction {
    pub kind: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub entry_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PluginPackageFileType {
    #[serde(rename = "zip")]
    Zip,
    #[serde(rename = "tar.gz")]
    TarGz,
    #[serde(rename = "tar.xz")]
    TarXz,
    #[serde(rename = "exe")]
    Exe,
    #[serde(rename = "msi")]
    Msi,
    #[serde(rename = "pkg")]
    Pkg,
    #[serde(rename = "dmg")]
    Dmg,
    #[serde(rename = "deb")]
    Deb,
    #[serde(rename = "rpm")]
    Rpm,
    #[serde(rename = "appimage")]
    AppImage,
    #[serde(rename = "url")]
    Url,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ResourcePackageType {
    #[serde(rename = "zip")]
    Zip,
    #[serde(rename = "tar.gz")]
    TarGz,
    #[serde(rename = "tar.xz")]
    TarXz,
    #[serde(rename = "exe")]
    Exe,
    #[serde(rename = "msi")]
    Msi,
    #[serde(rename = "pkg")]
    Pkg,
    #[serde(rename = "dmg")]
    Dmg,
    #[serde(rename = "deb")]
    Deb,
    #[serde(rename = "rpm")]
    Rpm,
    #[serde(rename = "appimage")]
    AppImage,
    #[serde(rename = "url")]
    Url,
    #[serde(rename = "py")]
    Py,
    #[serde(rename = "lua")]
    Lua,
    #[serde(rename = "unknown")]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPackage {
    pub id: String,
    pub os: SupportedPlatform,
    pub label: String,
    pub file_type: PluginPackageFileType,
    pub install_type: PluginPackageInstallType,
    pub download_url: String,
    #[serde(default)]
    pub recommended: bool,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogEntry {
    pub id: String,
    pub module_name: String,
    pub name: String,
    pub tagline: String,
    pub description: String,
    pub long_description: String,
    pub author: String,
    pub version: String,
    pub supported_platforms: Vec<SupportedPlatform>,
    #[serde(rename = "supportedOBSVersions", alias = "supportedObsVersions")]
    pub supported_obs_versions: String,
    #[serde(rename = "minOBSVersion", alias = "minObsVersion")]
    pub min_obs_version: String,
    #[serde(rename = "maxOBSVersion", alias = "maxObsVersion")]
    pub max_obs_version: Option<String>,
    pub category: String,
    pub homepage_url: String,
    pub source_url: Option<String>,
    pub official_obs_url: Option<String>,
    pub github_url: Option<String>,
    pub release_url: Option<String>,
    pub github_repo: Option<String>,
    pub github_release_url: Option<String>,
    pub github_release_tag: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub resource_install_type: Option<ResourceInstallType>,
    pub install_type: Option<String>,
    #[serde(default)]
    pub package_type: Option<ResourcePackageType>,
    pub file_type: Option<String>,
    pub resource_type: Option<String>,
    pub verified_source: Option<String>,
    pub download_count_raw: Option<u64>,
    pub github_stars: Option<u64>,
    #[serde(default)]
    pub search_tags: Vec<String>,
    #[serde(default)]
    pub preferred_asset_patterns: Vec<String>,
    pub fallback_install_type: Option<PluginPackageInstallType>,
    pub icon_key: String,
    pub icon_url: Option<String>,
    pub screenshots: Vec<String>,
    pub install_notes: Vec<String>,
    pub verified: bool,
    pub featured: bool,
    pub guide_only: bool,
    #[serde(default)]
    pub download_button_present: bool,
    pub manual_install_url: Option<String>,
    #[serde(default)]
    pub managed_extract_path: Option<String>,
    #[serde(default)]
    pub primary_entry_files: Vec<PluginPrimaryEntryFile>,
    #[serde(default)]
    pub install_instructions: Vec<String>,
    #[serde(default)]
    pub obs_followup_steps: Vec<String>,
    #[serde(default)]
    pub setup_actions: Vec<PluginSetupAction>,
    pub status_note: Option<String>,
    pub last_updated: String,
    pub download_count: String,
    pub accent_from: String,
    pub accent_to: String,
    #[serde(default)]
    pub install_strategy: Option<PluginInstallStrategy>,
    pub packages: Vec<PluginPackage>,
}

impl PluginCatalogEntry {
    pub fn package_for(
        &self,
        package_id: Option<&str>,
        platform: &SupportedPlatform,
    ) -> Option<&PluginPackage> {
        if let Some(package_id) = package_id {
            self.packages
                .iter()
                .find(|package| package.id == package_id)
        } else {
            self.packages
                .iter()
                .find(|package| &package.os == platform && package.recommended)
                .or_else(|| self.packages.iter().find(|package| &package.os == platform))
        }
    }
}
