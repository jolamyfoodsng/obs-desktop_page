import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  AnalyticsCaptureRequest,
  AppUpdateProgressEvent,
  AppUpdateSnapshot,
  AppSettings,
  BootstrapPayload,
  CancelInstallResponse,
  DesktopActionResponse,
  InstalledPluginRecord,
  InstallProgressEvent,
  InstallRequest,
  InstallResponse,
  GitHubReleaseInfo,
  ObsDetectionState,
  UninstallResponse,
} from '../types/desktop'

const INSTALL_PROGRESS_EVENT = 'install-progress'
const APP_UPDATE_PROGRESS_EVENT = 'app-update-progress'

export interface DesktopSupportSubmissionRequest {
  kind: string
  email: string
  subject?: string | null
  message: string
  pluginUrl?: string | null
  obsVersion?: string | null
  appVersion: string
  installId: string
  platform: string
}

export const desktopApi = {
  captureAnalyticsEvent(request: AnalyticsCaptureRequest) {
    return invoke<void>('capture_analytics_event', { request })
  },
  submitSupportRequest(request: DesktopSupportSubmissionRequest) {
    return invoke<{ ok: boolean; message?: string | null }>('submit_support_request', { request })
  },
  bootstrap() {
    return invoke<BootstrapPayload>('bootstrap')
  },
  detectObs() {
    return invoke<ObsDetectionState>('detect_obs')
  },
  chooseObsDirectory() {
    return invoke<ObsDetectionState>('choose_obs_directory')
  },
  saveObsPath(path: string) {
    return invoke<ObsDetectionState>('save_obs_path', { path })
  },
  saveAppSettings(settings: AppSettings) {
    return invoke<AppSettings>('save_app_settings', { settings })
  },
  installPlugin(request: InstallRequest) {
    return invoke<InstallResponse>('install_plugin', { request })
  },
  cancelPluginInstall(pluginId: string) {
    return invoke<CancelInstallResponse>('cancel_plugin_install', { pluginId })
  },
  getGitHubReleaseInfo(pluginId: string) {
    return invoke<GitHubReleaseInfo | null>('get_github_release_info', { pluginId })
  },
  uninstallPlugin(pluginId: string) {
    return invoke<UninstallResponse>('uninstall_plugin', { pluginId })
  },
  adoptInstallation(pluginId: string) {
    return invoke<InstalledPluginRecord>('adopt_installation', { pluginId })
  },
  openExternal(url: string) {
    return invoke<void>('open_external', { url })
  },
  openLocalPath(path: string) {
    return invoke<void>('open_local_path', { path })
  },
  revealPath(path: string) {
    return invoke<void>('reveal_path', { path })
  },
  clearAppCache() {
    return invoke<DesktopActionResponse>('clear_app_cache')
  },
  checkAppUpdate() {
    return invoke<AppUpdateSnapshot>('check_app_update')
  },
  downloadAppUpdate() {
    return invoke<AppUpdateSnapshot>('download_app_update')
  },
  installAppUpdate() {
    return invoke<AppUpdateSnapshot>('install_app_update')
  },
  exportLogs() {
    return invoke<DesktopActionResponse>('export_logs')
  },
  resetAppState() {
    return invoke<DesktopActionResponse>('reset_app_state')
  },
  async onInstallProgress(
    callback: (progress: InstallProgressEvent) => void,
  ): Promise<UnlistenFn> {
    return listen<InstallProgressEvent>(INSTALL_PROGRESS_EVENT, (event) => {
      callback(event.payload)
    })
  },
  async onAppUpdateProgress(
    callback: (progress: AppUpdateProgressEvent) => void,
  ): Promise<UnlistenFn> {
    return listen<AppUpdateProgressEvent>(APP_UPDATE_PROGRESS_EVENT, (event) => {
      callback(event.payload)
    })
  },
}
