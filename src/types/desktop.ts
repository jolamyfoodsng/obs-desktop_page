import type {
  PluginCatalogEntry,
  PluginPackageFileType,
  PluginPackageInstallType,
} from './plugin'

export type InstallProgressStage =
  | 'preparing'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'inspecting'
  | 'installing'
  | 'launching-installer'
  | 'completed'
  | 'manual'
  | 'review'
  | 'canceled'
  | 'error'

export type InstalledPluginStatus =
  | 'installed'
  | 'manual-step'
  | 'missing-files'

export type ThemeMode = 'light' | 'dark' | 'system'
export type InstallScope = 'user' | 'global'
export type AccentColor = 'purple' | 'blue' | 'emerald' | 'amber' | 'rose' | 'slate'

export interface AppSettings {
  obsPath: string | null
  setupCompleted: boolean
  launchOnStartup: boolean
  minimizeToTray: boolean
  language: string
  autoDetectObsVersion: boolean
  installScope: InstallScope
  theme: ThemeMode
  accentColor: AccentColor
  autoUpdatePlugins: boolean
  betaUpdates: boolean
  desktopNotifications: boolean
  releaseNotifications: boolean
  developerNews: boolean
  developerMode: boolean
}

export interface ObsDetectionState {
  platform: string
  storedPath: string | null
  detectedPath: string | null
  installTargetPath: string | null
  installTargetLabel: string | null
  validationKind: string | null
  isValid: boolean
  isSupported: boolean
  requiresManualSelection: boolean
  message: string
  checkedPaths: string[]
}

export type InstalledPluginSourceType =
  | 'archive'
  | 'external-installer'
  | 'script'
  | 'standalone-tool'
  | 'manual'

export type InstallKind = 'full' | 'guided'

export type InstallReviewDetectedKind = 'obs-plugin' | 'standalone-tool' | 'ambiguous'

export interface InstallReviewItem {
  sourcePath: string
  proposedDestination: string
  reason: string
}

export interface InstallReviewPlan {
  detectedKind: InstallReviewDetectedKind
  summary: string
  nextAction: string
  items: InstallReviewItem[]
}

export interface GitHubReleaseAssetOption {
  name: string
  downloadUrl: string
  label: string
  fileType: PluginPackageFileType
  installType: PluginPackageInstallType
  score: number
  reason: string
}

export interface GitHubRejectedAsset {
  name: string
  reason: string
}

export interface GitHubReleaseInfo {
  repo: string
  releaseName: string
  tagName: string
  releaseUrl: string
  publishedAt?: string | null
  selectedAsset?: GitHubReleaseAssetOption | null
  alternativeAssets: GitHubReleaseAssetOption[]
  rejectedAssets: GitHubRejectedAsset[]
}

export interface InstalledPluginRecord {
  pluginId: string
  installedVersion: string
  installedAt: string
  managed: boolean
  installLocation: string
  installedFiles: string[]
  status: InstalledPluginStatus
  sourceType: InstalledPluginSourceType
  installKind: InstallKind
  packageId?: string | null
  downloadPath?: string | null
}

export interface BootstrapPayload {
  settings: AppSettings
  obsDetection: ObsDetectionState
  plugins: PluginCatalogEntry[]
  installedPlugins: InstalledPluginRecord[]
  currentPlatform: string
  currentVersion: string
}

export type AppUpdateStatus =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'no-update'
  | 'update-available'
  | 'update-required'
  | 'downloading'
  | 'ready-to-restart'
  | 'failed'

export interface AppUpdateSnapshot {
  status: Exclude<AppUpdateStatus, 'idle' | 'checking' | 'downloading'>
  message: string
  currentVersion: string
  latestVersion?: string | null
  minimumSupportedVersion?: string | null
  releaseNotes?: string | null
  publishedAt?: string | null
  updateChannel: string
  releaseTag?: string | null
  releaseUrl?: string | null
  selectedAssetName?: string | null
  selectedAssetReason?: string | null
  selectedAssetUrl?: string | null
  selectedAssetSize?: number | null
}

export interface AppUpdateProgressEvent {
  stage: 'started' | 'progress' | 'finished'
  downloadedBytes: number
  totalBytes?: number | null
  progressPercent?: number | null
  message: string
}

export interface InstallRequest {
  pluginId: string
  packageId?: string | null
  overwrite?: boolean
  githubAssetName?: string | null
  githubAssetUrl?: string | null
}

export interface CancelInstallResponse {
  canceled: boolean
  message: string
}

export interface InstallResponse {
  success: boolean
  code?: string
  message: string
  installedPlugin?: InstalledPluginRecord
  manualInstallerPath?: string
  downloadPath?: string
  installerStarted?: boolean
  canOpenInstallerManually?: boolean
  requiresRestart?: boolean
  conflicts?: string[]
  reviewPlan?: InstallReviewPlan | null
  selectedAssetName?: string | null
  selectedAssetReason?: string | null
  githubReleaseUrl?: string | null
}

export interface InstallProgressEvent {
  pluginId: string
  stage: InstallProgressStage
  progress: number
  message: string
  detail?: string
  terminal?: boolean
}

export interface DesktopActionResponse {
  message: string
  path?: string | null
  count?: number | null
}

export interface UninstallResponse {
  success: boolean
  message: string
  removedFiles: number
  removedDirectories: number
}
