import { create } from 'zustand'
import { coerce, lt } from 'semver'
import { toast } from 'sonner'

import { getAnalyticsContext, getPluginAnalyticsProperties, trackEvent } from '../lib/analytics'
import { APP_NAME } from '../lib/branding'
import { getErrorMessage } from '../lib/errors'
import { desktopApi } from '../lib/tauri'
import type {
  AppUpdateProgressEvent,
  AppUpdateSnapshot,
  AppUpdateStatus,
  AppSettings,
  BootstrapPayload,
  InstallProgressEvent,
  InstallResponse,
  ObsDetectionState,
  UninstallResponse,
} from '../types/desktop'

type CatalogViewMode = 'list' | 'grid'

const CATALOG_VIEW_MODE_STORAGE_KEY = 'obs-plugin-installer.catalog-view-mode'
const DISMISSED_APP_UPDATE_STORAGE_KEY =
  'obs-plugin-installer.dismissed-app-update-version'

function readCatalogViewMode(): CatalogViewMode {
  if (typeof window === 'undefined') {
    return 'list'
  }

  const stored = window.localStorage.getItem(CATALOG_VIEW_MODE_STORAGE_KEY)
  return stored === 'grid' ? 'grid' : 'list'
}

function readDismissedAppUpdateVersion() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(DISMISSED_APP_UPDATE_STORAGE_KEY)
}

function writeDismissedAppUpdateVersion(version: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  if (version) {
    window.localStorage.setItem(DISMISSED_APP_UPDATE_STORAGE_KEY, version)
  } else {
    window.localStorage.removeItem(DISMISSED_APP_UPDATE_STORAGE_KEY)
  }
}

function normalizeVersion(version?: string | null) {
  return version ? coerce(version)?.version ?? null : null
}

function classifyAppUpdate(snapshot: AppUpdateSnapshot): AppUpdateStatus {
  if (snapshot.status === 'disabled' || snapshot.status === 'failed' || snapshot.status === 'ready-to-restart') {
    return snapshot.status
  }

  const currentVersion = normalizeVersion(snapshot.currentVersion)
  const latestVersion = normalizeVersion(snapshot.latestVersion ?? null)
  const minimumSupportedVersion = normalizeVersion(snapshot.minimumSupportedVersion ?? null)

  if (!currentVersion || !latestVersion) {
    console.debug('classifyAppUpdate: Missing version info', { currentVersion, latestVersion, status: snapshot.status })
    return snapshot.status
  }

  if (minimumSupportedVersion && lt(currentVersion, minimumSupportedVersion)) {
    return 'update-required'
  }

  if (lt(currentVersion, latestVersion)) {
    return 'update-available'
  }

  return 'no-update'
}

function createFailedAppUpdateSnapshot(
  currentVersion: string,
  updateChannel: 'stable' | 'beta',
  message: string,
): AppUpdateSnapshot {
  return {
    status: 'failed',
    message,
    currentVersion,
    latestVersion: null,
    minimumSupportedVersion: null,
    releaseNotes: null,
    publishedAt: null,
    updateChannel,
    releaseTag: null,
    releaseUrl: null,
    selectedAssetName: null,
    selectedAssetReason: null,
    selectedAssetUrl: null,
    selectedAssetSize: null,
    manualFallbackName: null,
    manualFallbackReason: null,
    manualFallbackUrl: null,
    manualFallbackSize: null,
  }
}

interface AppStoreState {
  bootstrap: BootstrapPayload | null
  bootError: string | null
  isBootstrapping: boolean
  isSetupWorking: boolean
  isSettingsWorking: boolean
  uninstallingPluginId: string | null
  adoptingPluginId: string | null
  cancelingInstallPluginId: string | null
  searchQuery: string
  selectedCategory: string
  catalogViewMode: CatalogViewMode
  appUpdate: AppUpdateSnapshot | null
  appUpdateStatus: AppUpdateStatus
  appUpdateProgress: AppUpdateProgressEvent | null
  isCheckingAppUpdate: boolean
  isApplyingAppUpdate: boolean
  dismissedAppUpdateVersion: string | null
  installProgress: InstallProgressEvent | null
  isInstallProgressVisible: boolean
  lastInstallResponse: InstallResponse | null
  lastInstallRequest: {
    pluginId: string
    options?: {
      packageId?: string | null
      overwrite?: boolean
      githubAssetName?: string | null
      githubAssetUrl?: string | null
    }
  } | null
  loadApp: (options?: { silent?: boolean }) => Promise<void>
  checkForAppUpdate: (options?: { silent?: boolean; forcePrompt?: boolean }) => Promise<AppUpdateSnapshot | undefined>
  downloadAppUpdate: () => Promise<AppUpdateSnapshot | undefined>
  installAppUpdate: () => Promise<void>
  dismissAppUpdate: () => void
  applyDetection: (detection: ObsDetectionState) => void
  detectObs: () => Promise<void>
  chooseObsDirectory: () => Promise<void>
  saveObsPath: (path: string) => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  clearCache: () => Promise<void>
  exportLogs: () => Promise<void>
  resetAppData: () => Promise<void>
  installPlugin: (
    pluginId: string,
    options?: {
      packageId?: string | null
      overwrite?: boolean
      githubAssetName?: string | null
      githubAssetUrl?: string | null
    },
  ) => Promise<InstallResponse | undefined>
  retryLastInstall: () => Promise<InstallResponse | undefined>
  cancelInstall: (pluginId: string) => Promise<void>
  adoptInstallation: (pluginId: string) => Promise<void>
  uninstallPlugin: (pluginId: string) => Promise<UninstallResponse | undefined>
  openExternal: (url: string) => Promise<void>
  openLocalPath: (path: string) => Promise<void>
  revealPath: (path: string) => Promise<void>
  setSearchQuery: (query: string) => void
  setSelectedCategory: (category: string) => void
  setCatalogViewMode: (mode: CatalogViewMode) => void
  showInstallProgress: () => void
  hideInstallProgress: () => void
  clearInstallProgress: () => void
  handleInstallProgress: (progress: InstallProgressEvent) => void
  handleAppUpdateProgress: (progress: AppUpdateProgressEvent) => void
}

let bootstrapRequest: Promise<void> | null = null

export const useAppStore = create<AppStoreState>((set, get) => ({
  bootstrap: null,
  bootError: null,
  isBootstrapping: true,
  isSetupWorking: false,
  isSettingsWorking: false,
  uninstallingPluginId: null,
  adoptingPluginId: null,
  cancelingInstallPluginId: null,
  searchQuery: '',
  selectedCategory: 'Compatible',
  catalogViewMode: readCatalogViewMode(),
  appUpdate: null,
  appUpdateStatus: 'idle',
  appUpdateProgress: null,
  isCheckingAppUpdate: false,
  isApplyingAppUpdate: false,
  dismissedAppUpdateVersion: readDismissedAppUpdateVersion(),
  installProgress: null,
  isInstallProgressVisible: false,
  lastInstallResponse: null,
  lastInstallRequest: null,

  async loadApp(options) {
    if (bootstrapRequest) {
      return bootstrapRequest
    }

    const silent = options?.silent ?? false

    if (!silent) {
      set({ isBootstrapping: true, bootError: null })
    }

    bootstrapRequest = (async () => {
      try {
        const bootstrap = await desktopApi.bootstrap()
        set((state) => ({
          bootstrap,
          bootError: silent ? state.bootError : null,
          isBootstrapping: silent ? state.isBootstrapping : false,
        }))
      } catch (error) {
        const message = getErrorMessage(error, 'Failed to load the desktop app state.')
        if (silent) {
          toast.error(message)
        } else {
          set({ bootError: message, isBootstrapping: false })
        }
        if (!silent) {
          toast.error(message)
        }
      } finally {
        bootstrapRequest = null
      }
    })()

    return bootstrapRequest
  },

  async checkForAppUpdate(options) {
    set({
      appUpdateStatus: 'checking',
      appUpdateProgress: null,
      isCheckingAppUpdate: true,
    })

    try {
      const snapshot = await desktopApi.checkAppUpdate()
      const nextStatus = classifyAppUpdate(snapshot)

      // Debug: log snapshot and classification to help diagnose UI visibility issues
      // Remove or guard behind a dev flag if this is noisy in production.
      console.debug('checkForAppUpdate: snapshot=', snapshot, 'nextStatus=', nextStatus, 'dismissed=', get().dismissedAppUpdateVersion)

      if (options?.forcePrompt && snapshot.latestVersion) {
        writeDismissedAppUpdateVersion(null)
      }

      set((state) => ({
        appUpdate: snapshot,
        appUpdateStatus: nextStatus,
        appUpdateProgress: null,
        isCheckingAppUpdate: false,
        dismissedAppUpdateVersion: options?.forcePrompt
          ? null
          : state.dismissedAppUpdateVersion,
      }))
      trackEvent('update_check', {
        ...getAnalyticsContext(get().bootstrap),
        status: nextStatus,
        latestVersion: snapshot.latestVersion ?? null,
        minimumSupportedVersion: snapshot.minimumSupportedVersion ?? null,
        updateChannel: snapshot.updateChannel,
      })

      if (!options?.silent) {
        if (nextStatus === 'no-update') {
          toast.success('You are already on the latest desktop app build.')
        } else if (nextStatus === 'disabled') {
          toast(snapshot.message)
        } else if (nextStatus === 'failed') {
          toast.error(snapshot.message)
        }
      }

      return snapshot
    } catch (error) {
      const message = getErrorMessage(error, 'Could not check for app updates.')
      set((state) => ({
        appUpdate:
          state.appUpdateStatus === 'ready-to-restart' && state.appUpdate
            ? state.appUpdate
            : createFailedAppUpdateSnapshot(
                state.bootstrap?.currentVersion ?? '0.0.0',
                state.bootstrap?.settings.betaUpdates ? 'beta' : 'stable',
                message,
              ),
        appUpdateStatus: state.appUpdateStatus === 'ready-to-restart' ? 'ready-to-restart' : 'failed',
        appUpdateProgress: null,
        isCheckingAppUpdate: false,
      }))
      trackEvent('update_check', {
        ...getAnalyticsContext(get().bootstrap),
        status: 'failed',
        error: message,
      })

      if (!options?.silent) {
        toast.error(message)
      }

      return undefined
    }
  },

  async downloadAppUpdate() {
    const currentUpdate = get().appUpdate
    if (!currentUpdate) {
      return undefined
    }

    set({
      appUpdateStatus: 'downloading',
      appUpdateProgress: null,
    })

    try {
      const snapshot = await desktopApi.downloadAppUpdate()
      const nextStatus = classifyAppUpdate(snapshot)

      // Debug: log download result and classification
      console.debug('downloadAppUpdate: snapshot=', snapshot, 'nextStatus=', nextStatus)
      set({
        appUpdate: snapshot,
        appUpdateStatus: nextStatus,
        appUpdateProgress: null,
      })
      trackEvent('update_success', {
        ...getAnalyticsContext(get().bootstrap),
        phase: 'download',
        status: nextStatus,
        latestVersion: snapshot.latestVersion ?? null,
        updateChannel: snapshot.updateChannel,
      })
      return snapshot
    } catch (error) {
      const message = getErrorMessage(error, 'Could not download the app update.')
      set({
        appUpdate: {
          ...currentUpdate,
          status: 'failed',
          message,
        },
        appUpdateStatus: 'failed',
      })
      toast.error(message)
      return undefined
    }
  },

  async installAppUpdate() {
    set({ isApplyingAppUpdate: true })

    try {
      await desktopApi.installAppUpdate()
      trackEvent('update_success', {
        ...getAnalyticsContext(get().bootstrap),
        phase: 'install',
        latestVersion: get().appUpdate?.latestVersion ?? null,
      })
    } catch (error) {
      const message = getErrorMessage(error, 'Could not finish installing the app update.')
      set((state) => ({
        isApplyingAppUpdate: false,
        appUpdate: state.appUpdate
          ? {
            ...state.appUpdate,
            status: 'failed',
            message,
          }
          : state.appUpdate,
        appUpdateStatus: 'failed',
      }))
      toast.error(message)
      return
    }

    set({ isApplyingAppUpdate: false })
  },

  dismissAppUpdate() {
    const latestVersion = get().appUpdate?.latestVersion ?? null
    writeDismissedAppUpdateVersion(latestVersion)
    set({
      dismissedAppUpdateVersion: latestVersion,
    })
  },

  applyDetection(detection) {
    set((state) => {
      if (!state.bootstrap) {
        return state
      }

      return {
        bootstrap: {
          ...state.bootstrap,
          obsDetection: detection,
          settings: {
            ...state.bootstrap.settings,
            obsPath: detection.storedPath,
            setupCompleted: Boolean(detection.storedPath),
          },
        },
      }
    })
  },

  async detectObs() {
    set({ isSetupWorking: true })

    try {
      const detection = await desktopApi.detectObs()
      get().applyDetection(detection)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Automatic detection could not be completed.'))
    } finally {
      set({ isSetupWorking: false })
    }
  },

  async chooseObsDirectory() {
    set({ isSetupWorking: true })

    try {
      const detection = await desktopApi.chooseObsDirectory()
      get().applyDetection(detection)

      if (detection.storedPath) {
        await get().loadApp()
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not open the folder chooser.'))
    } finally {
      set({ isSetupWorking: false })
    }
  },

  async saveObsPath(path) {
    set({ isSetupWorking: true })

    try {
      const detection = await desktopApi.saveObsPath(path)
      get().applyDetection(detection)

      if (detection.storedPath) {
        await get().loadApp()
      } else {
        toast.error(detection.message)
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save the OBS folder.'))
    } finally {
      set({ isSetupWorking: false })
    }
  },

  async updateSettings(patch) {
    const currentSettings = get().bootstrap?.settings
    if (!currentSettings) {
      return
    }

    const nextSettings: AppSettings = {
      ...currentSettings,
      ...patch,
    }

    set((state) => ({
      isSettingsWorking: true,
      bootstrap: state.bootstrap
        ? {
          ...state.bootstrap,
          settings: nextSettings,
        }
        : state.bootstrap,
    }))

    try {
      const savedSettings = await desktopApi.saveAppSettings(nextSettings)
      set((state) => ({
        isSettingsWorking: false,
        bootstrap: state.bootstrap
          ? {
            ...state.bootstrap,
            settings: savedSettings,
          }
          : state.bootstrap,
      }))

      if (Object.prototype.hasOwnProperty.call(patch, 'installScope')) {
        const detection = await desktopApi.detectObs()
        get().applyDetection(detection)
      }
    } catch (error) {
      set((state) => ({
        isSettingsWorking: false,
        bootstrap: state.bootstrap
          ? {
            ...state.bootstrap,
            settings: currentSettings,
          }
          : state.bootstrap,
      }))
      toast.error(getErrorMessage(error, 'Could not save these app settings.'))
    }
  },

  async clearCache() {
    set({ isSettingsWorking: true })

    try {
      const response = await desktopApi.clearAppCache()
      set({ isSettingsWorking: false })
      toast.success(response.message)
    } catch (error) {
      set({ isSettingsWorking: false })
      toast.error(getErrorMessage(error, 'Could not clear the app cache.'))
    }
  },

  async exportLogs() {
    set({ isSettingsWorking: true })

    try {
      const response = await desktopApi.exportLogs()
      set({ isSettingsWorking: false })
      toast.success(response.message)

      if (response.path) {
        await desktopApi.revealPath(response.path)
      }
    } catch (error) {
      set({ isSettingsWorking: false })
      toast.error(getErrorMessage(error, 'Could not export diagnostics.'))
    }
  },

  async resetAppData() {
    set({ isSettingsWorking: true })

    try {
      const response = await desktopApi.resetAppState()
      set({
        isSettingsWorking: false,
        searchQuery: '',
        selectedCategory: 'Compatible',
        catalogViewMode: 'list',
        appUpdate: null,
        appUpdateStatus: 'idle',
        appUpdateProgress: null,
        dismissedAppUpdateVersion: null,
        installProgress: null,
        isInstallProgressVisible: false,
        lastInstallResponse: null,
        lastInstallRequest: null,
        cancelingInstallPluginId: null,
      })
      window.localStorage.setItem(CATALOG_VIEW_MODE_STORAGE_KEY, 'list')
      writeDismissedAppUpdateVersion(null)
      toast.success(response.message)
      await get().loadApp()
    } catch (error) {
      set({ isSettingsWorking: false })
      toast.error(getErrorMessage(error, 'Could not reset the local app data.'))
    }
  },

  async installPlugin(pluginId, options) {
    const bootstrap = get().bootstrap
    const plugin = bootstrap?.plugins.find((entry) => entry.id === pluginId)
    const existingInstall = bootstrap?.installedPlugins.find((entry) => entry.pluginId === pluginId)

    set({
      installProgress: {
        pluginId,
        stage: 'preparing',
        progress: 4,
        message: 'Preparing installation',
        detail: 'Starting plugin install workflow.',
      },
      isInstallProgressVisible: true,
      lastInstallResponse: null,
      lastInstallRequest: { pluginId, options },
      cancelingInstallPluginId: null,
    })
    trackEvent(
      'plugin_install_start',
      getPluginAnalyticsProperties(plugin, bootstrap, existingInstall, {
        overwrite: Boolean(options?.overwrite),
        packageId: options?.packageId ?? null,
        githubAssetName: options?.githubAssetName ?? null,
        installSource: options?.githubAssetName
          ? 'github-release'
          : options?.packageId
            ? 'catalog-package'
            : 'auto',
      }),
    )

    try {
      const response = await desktopApi.installPlugin({
        pluginId,
        packageId: options?.packageId,
        overwrite: options?.overwrite,
        githubAssetName: options?.githubAssetName,
        githubAssetUrl: options?.githubAssetUrl,
      })

      if (!response.success) {
        if (response.code === 'CANCELED') {
          set((state) => ({
            lastInstallResponse: response,
            cancelingInstallPluginId: null,
            installProgress:
              state.installProgress?.pluginId === pluginId &&
                state.installProgress.stage === 'canceled'
                ? state.installProgress
                : {
                  pluginId,
                  stage: 'canceled',
                  progress: 100,
                  message: 'Download canceled',
                  detail: response.message,
                  terminal: true,
                },
          }))
          await get().loadApp({ silent: true })
          return response
        }

        set({ lastInstallResponse: response })

        trackEvent(
          'plugin_install_fail',
          getPluginAnalyticsProperties(plugin, bootstrap, existingInstall, {
            code: response.code ?? 'unknown',
            message: response.message,
          }),
        )

        if (response.code === 'MANUAL_ONLY') {
          const plugin = get().bootstrap?.plugins.find((entry) => entry.id === pluginId)
          if (plugin) {
            await get().openExternal(plugin.manualInstallUrl ?? plugin.homepageUrl)
          }
          return response
        }

        if (response.code === 'FILE_CONFLICT' && !options?.overwrite) {
          const preview = response.conflicts?.slice(0, 6).join('\n') ?? ''
          const accepted = window.confirm(
            `${response.message}\n\n${preview}\n\nContinue and overwrite these files?`,
          )

          if (accepted) {
            return get().installPlugin(pluginId, {
              ...options,
              overwrite: true,
            })
          }
        }

        if (response.code === 'REVIEW_REQUIRED') {
          return response
        }

        toast.error(response.message)
        return response
      }

      set({ lastInstallResponse: response })
      const installedPlugin = response.installedPlugin
      if (installedPlugin) {
        set((state) => ({
          bootstrap: state.bootstrap
            ? {
                ...state.bootstrap,
                installedPlugins: [
                  ...state.bootstrap.installedPlugins.filter(
                    (entry) => entry.pluginId !== installedPlugin.pluginId,
                  ),
                  installedPlugin,
                ],
              }
            : state.bootstrap,
        }))
      }

      if (response.installerStarted) {
        toast.success(response.message)
      } else if (response.manualInstallerPath) {
        toast(response.message)
      } else if (response.installedPlugin) {
        toast.success(response.message)
      }
      trackEvent(
        'plugin_install_success',
        getPluginAnalyticsProperties(plugin, bootstrap, response.installedPlugin ?? existingInstall, {
          installerStarted: Boolean(response.installerStarted),
          requiresRestart: response.requiresRestart,
          installKind: response.installedPlugin?.installKind ?? null,
          sourceType: response.installedPlugin?.sourceType ?? null,
        }),
      )

      await get().loadApp({ silent: true })
      set({ cancelingInstallPluginId: null })
      return response
    } catch (error) {
      const message = getErrorMessage(error, 'Unexpected plugin install failure.')

      set({
        cancelingInstallPluginId: null,
        installProgress: {
          pluginId,
          stage: 'error',
          progress: 100,
          message: 'Installation failed',
          detail: message,
          terminal: true,
        },
      })
      trackEvent(
        'plugin_install_fail',
        getPluginAnalyticsProperties(plugin, bootstrap, existingInstall, {
          code: 'unexpected-error',
          message,
        }),
      )
      toast.error(message)
      return undefined
    }
  },

  async retryLastInstall() {
    const request = get().lastInstallRequest
    if (!request) {
      return undefined
    }

    return get().installPlugin(request.pluginId, request.options)
  },

  async cancelInstall(pluginId) {
    set({ cancelingInstallPluginId: pluginId })

    try {
      const response = await desktopApi.cancelPluginInstall(pluginId)
      if (!response.canceled) {
        set({ cancelingInstallPluginId: null })
        toast.error(response.message)
      }
    } catch (error) {
      set({ cancelingInstallPluginId: null })
      toast.error(getErrorMessage(error, 'Could not stop the install safely.'))
    }
  },

  async uninstallPlugin(pluginId) {
    const bootstrap = get().bootstrap
    const plugin = bootstrap?.plugins.find((entry) => entry.id === pluginId)
    const existingInstall = bootstrap?.installedPlugins.find((entry) => entry.pluginId === pluginId)

    set({ uninstallingPluginId: pluginId })

    try {
      const response = await desktopApi.uninstallPlugin(pluginId)
      set((state) => ({
        uninstallingPluginId: null,
        bootstrap: state.bootstrap
          ? {
              ...state.bootstrap,
              installedPlugins: state.bootstrap.installedPlugins.filter(
                (entry) => entry.pluginId !== pluginId,
              ),
              installHistory: [
                ...state.bootstrap.installHistory,
                {
                  pluginId,
                  pluginName: plugin?.name ?? pluginId,
                  version: existingInstall?.installedVersion ?? null,
                  action: 'uninstall',
                  managed: existingInstall?.managed ?? true,
                  installLocation: existingInstall?.installLocation ?? null,
                  message: response.message,
                  timestamp: new Date().toISOString(),
                  fileCount: response.removedFiles,
                  backupRoot: existingInstall?.backup?.backupRoot ?? null,
                  verificationStatus: existingInstall?.verificationStatus ?? null,
                },
              ],
            }
          : state.bootstrap,
      }))
      toast.success(`${plugin?.name ?? pluginId} was deleted.`)
      void get().loadApp({ silent: true })
      return response
    } catch (error) {
      set({ uninstallingPluginId: null })
      toast.error(getErrorMessage(error, 'This plugin could not be removed automatically.'))
      return undefined
    }
  },

  async adoptInstallation(pluginId) {
    set({ adoptingPluginId: pluginId })

    try {
      await desktopApi.adoptInstallation(pluginId)
      set({ adoptingPluginId: null })
      toast.success(`This installation is now managed by ${APP_NAME}.`)
      await get().loadApp()
    } catch (error) {
      set({ adoptingPluginId: null })
      toast.error(getErrorMessage(error, 'Could not adopt that installation.'))
    }
  },

  async openExternal(url) {
    try {
      await desktopApi.openExternal(url)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not open the external link.'))
    }
  },

  async openLocalPath(path) {
    try {
      await desktopApi.openLocalPath(path)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not open the downloaded installer file.'))
    }
  },

  async revealPath(path) {
    try {
      await desktopApi.revealPath(path)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not open that folder in your file manager.'))
    }
  },

  setSearchQuery(query) {
    set({ searchQuery: query })
  },

  setSelectedCategory(category) {
    set({ selectedCategory: category })
  },

  setCatalogViewMode(mode) {
    window.localStorage.setItem(CATALOG_VIEW_MODE_STORAGE_KEY, mode)
    set({ catalogViewMode: mode })
  },

  showInstallProgress() {
    set((state) => ({
      isInstallProgressVisible: Boolean(state.installProgress),
    }))
  },

  hideInstallProgress() {
    set({ isInstallProgressVisible: false })
  },

  clearInstallProgress() {
    set({
      installProgress: null,
      isInstallProgressVisible: false,
      lastInstallResponse: null,
      lastInstallRequest: null,
      cancelingInstallPluginId: null,
    })
  },

  handleInstallProgress(progress) {
    set((state) => {
      if (
        state.installProgress?.pluginId === progress.pluginId &&
        state.installProgress.stage === 'canceled' &&
        state.installProgress.terminal
      ) {
        return {
          installProgress: state.installProgress,
          isInstallProgressVisible: state.isInstallProgressVisible,
          cancelingInstallPluginId: null,
        }
      }

      const isSameInstall = state.installProgress?.pluginId === progress.pluginId

      return {
        installProgress: progress,
        isInstallProgressVisible: isSameInstall ? state.isInstallProgressVisible : true,
        cancelingInstallPluginId: progress.terminal ? null : state.cancelingInstallPluginId,
      }
    })
  },

  handleAppUpdateProgress(progress) {
    console.debug('handleAppUpdateProgress:', progress)

    set({
      appUpdateProgress: progress,
      appUpdateStatus: progress.stage === 'finished' ? 'ready-to-restart' : 'downloading',
    })
  },
}))
