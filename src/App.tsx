import { useEffect, useRef, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react'

import { Toaster } from 'sonner'

import { AppUpdateDialog } from './components/AppUpdateDialog'
import { EmptyState } from './components/EmptyState'
import { ErrorState } from './components/ErrorState'
import { RequiredUpdateScreen } from './components/RequiredUpdateScreen'
import { SetupWizard } from './components/SetupWizard'
import { AppShell } from './components/layout/AppShell'
import { getAnalyticsContext, trackAppOpenOnce } from './lib/analytics'
import { desktopApi } from './lib/tauri'
import { DashboardPage } from './pages/DashboardPage'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { DiscoverPage } from './pages/DiscoverPage'
import { FeedbackPage } from './pages/FeedbackPage'
import { InstalledPage } from './pages/InstalledPage'
import { PluginDetailsPage } from './pages/PluginDetailsPage'
import { SettingsPage } from './pages/SettingsPage'
import { UpdatesPage } from './pages/UpdatesPage'
import { useAppStore } from './stores/appStore'
import type { AccentColor, ThemeMode } from './types/desktop'

const accentColorMap: Record<AccentColor, string> = {
  purple: '78 121 255',
  blue: '78 121 255',
  emerald: '78 121 255',
  amber: '78 121 255',
  rose: '78 121 255',
  slate: '78 121 255',
}

function toHtmlLang(label: string) {
  switch (label) {
    case 'Deutsch':
      return 'de'
    case 'Español':
      return 'es'
    case 'Français':
      return 'fr'
    case '日本語':
      return 'ja'
    default:
      return 'en'
  }
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-dark">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-6 py-4 shadow-panel">
        <div className="flex items-center gap-3 text-slate-300">
          <LoaderCircle className="size-5 animate-spin text-primary" />
          Loading OBS Plugin Installer…
        </div>
      </div>
    </div>
  )
}


function StartupErrorScreen({
  error,
  isRetrying,
  onRetry,
}: {
  error: string
  isRetrying: boolean
  onRetry: () => void
}) {
  const lowerError = error.toLowerCase()
  const isNetworkError =
    lowerError.includes('network') ||
    lowerError.includes('internet') ||
    lowerError.includes('timed out') ||
    lowerError.includes('connection') ||
    lowerError.includes('dns')

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-dark px-4">
      <div className="w-full max-w-2xl">
        {isNetworkError ? (
          <EmptyState
            description="We couldn’t reach the plugin catalog. Check your connection and try again."
            icon={<AlertTriangle className="size-6" />}
            primaryAction={{
              label: isRetrying ? 'Retrying…' : 'Retry connection',
              icon: isRetrying ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />,
              onClick: onRetry,
              variant: 'primary',
              disabled: isRetrying,
            }}
            title="No internet connection"
          />
        ) : (
          <ErrorState
            description="The desktop backend returned this error during the initial bootstrap step."
            details={error}
            primaryAction={{
              label: isRetrying ? 'Retrying…' : 'Retry startup',
              icon: isRetrying ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />,
              onClick: onRetry,
              variant: 'primary',
              disabled: isRetrying,
            }}
            title="OBS Plugin Installer could not finish loading"
          />
        )}
      </div>
    </div>
  )
}

function App() {
  const bootstrap = useAppStore((state) => state.bootstrap)
  const bootError = useAppStore((state) => state.bootError)
  const isBootstrapping = useAppStore((state) => state.isBootstrapping)
  const isSetupWorking = useAppStore((state) => state.isSetupWorking)
  const loadApp = useAppStore((state) => state.loadApp)
  const appUpdate = useAppStore((state) => state.appUpdate)
  const appUpdateStatus = useAppStore((state) => state.appUpdateStatus)
  const appUpdateProgress = useAppStore((state) => state.appUpdateProgress)
  const dismissedAppUpdateVersion = useAppStore((state) => state.dismissedAppUpdateVersion)
  const isApplyingAppUpdate = useAppStore((state) => state.isApplyingAppUpdate)
  const checkForAppUpdate = useAppStore((state) => state.checkForAppUpdate)
  const downloadAppUpdate = useAppStore((state) => state.downloadAppUpdate)
  const installAppUpdate = useAppStore((state) => state.installAppUpdate)
  const dismissAppUpdate = useAppStore((state) => state.dismissAppUpdate)
  const detectObs = useAppStore((state) => state.detectObs)
  const chooseObsDirectory = useAppStore((state) => state.chooseObsDirectory)
  const saveObsPath = useAppStore((state) => state.saveObsPath)
  const handleInstallProgress = useAppStore((state) => state.handleInstallProgress)
  const handleAppUpdateProgress = useAppStore((state) => state.handleAppUpdateProgress)
  const openExternal = useAppStore((state) => state.openExternal)
  const [systemPrefersLight, setSystemPrefersLight] = useState(() =>
    window.matchMedia('(prefers-color-scheme: light)').matches,
  )
  const [isStartupUpdateCheckComplete, setIsStartupUpdateCheckComplete] = useState(false)
  const [bypassedRequiredUpdateVersion, setBypassedRequiredUpdateVersion] = useState<string | null>(null)
  const startupUpdateCheckStartedRef = useRef(false)
  const updateCheckInFlightRef = useRef(false)

  const themePreference: ThemeMode = bootstrap?.settings.theme ?? 'dark'
  const effectiveTheme =
    themePreference === 'system'
      ? systemPrefersLight
        ? 'light'
        : 'dark'
      : themePreference
  const toasterTheme = effectiveTheme === 'light' ? 'light' : 'dark'

  useEffect(() => {
    void loadApp()

    let unlistenInstall: (() => void) | undefined
    let unlistenAppUpdate: (() => void) | undefined
    let disposed = false

    void desktopApi.onInstallProgress((progress) => {
      handleInstallProgress(progress)
    }).then((cleanup) => {
      if (disposed) {
        cleanup()
        return
      }
      unlistenInstall = cleanup
    })

    void desktopApi.onAppUpdateProgress((progress) => {
      handleAppUpdateProgress(progress)
    }).then((cleanup) => {
      if (disposed) {
        cleanup()
        return
      }
      unlistenAppUpdate = cleanup
    })

    return () => {
      disposed = true
      unlistenInstall?.()
      unlistenAppUpdate?.()
    }
  }, [handleAppUpdateProgress, handleInstallProgress, loadApp])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setSystemPrefersLight(mediaQuery.matches)

    onChange()

    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const accentColor = bootstrap?.settings.accentColor ?? 'purple'
    const language = bootstrap?.settings.language ?? 'English (US)'

    document.documentElement.dataset.theme = effectiveTheme
    document.documentElement.dataset.accent = accentColor
    document.documentElement.lang = toHtmlLang(language)
    document.documentElement.classList.toggle('dark', effectiveTheme !== 'light')
    document.documentElement.style.setProperty(
      '--accent-rgb',
      accentColorMap[accentColor],
    )
  }, [bootstrap?.settings.accentColor, bootstrap?.settings.language, effectiveTheme])

  useEffect(() => {
    if (!bootstrap || startupUpdateCheckStartedRef.current) {
      return
    }

    startupUpdateCheckStartedRef.current = true
    void checkForAppUpdate({ silent: true }).finally(() => {
      setIsStartupUpdateCheckComplete(true)
    })
  }, [bootstrap, checkForAppUpdate])

  useEffect(() => {
    if (!bootstrap || !isStartupUpdateCheckComplete) {
      return
    }

    const runSilentUpdateCheck = () => {
      if (updateCheckInFlightRef.current) {
        return
      }

      updateCheckInFlightRef.current = true
      void checkForAppUpdate({ silent: true }).finally(() => {
        updateCheckInFlightRef.current = false
      })
    }

    const intervalId = window.setInterval(runSilentUpdateCheck, 5 * 60 * 1000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runSilentUpdateCheck()
      }
    }
    const handleFocus = () => {
      runSilentUpdateCheck()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [bootstrap, checkForAppUpdate, isStartupUpdateCheckComplete])

  useEffect(() => {
    if (!bootstrap) {
      return
    }

    trackAppOpenOnce({
      ...getAnalyticsContext(bootstrap),
      setupCompleted: bootstrap.settings.setupCompleted,
      installedPluginCount: bootstrap.installedPlugins.length,
    })
  }, [bootstrap])

  if (isBootstrapping) {
    return (
      <>
        <LoadingScreen />
        <Toaster position="top-right" richColors theme={toasterTheme} />
      </>
    )
  }

  if (!bootstrap && bootError) {
    return (
      <>
        <StartupErrorScreen
          error={bootError}
          isRetrying={isBootstrapping}
          onRetry={() => {
            void loadApp()
          }}
        />
        <Toaster position="top-right" richColors theme={toasterTheme} />
      </>
    )
  }

  if (!bootstrap) {
    return (
      <>
        <LoadingScreen />
        <Toaster position="top-right" richColors theme={toasterTheme} />
      </>
    )
  }

  if (!isStartupUpdateCheckComplete) {
    return (
      <>
        <LoadingScreen />
        <Toaster position="top-right" richColors theme={toasterTheme} />
      </>
    )
  }

  const canBypassRequiredUpdate = import.meta.env.DEV && bootstrap.settings.developerMode
  const allowRequiredUpdateBypass =
    canBypassRequiredUpdate && bypassedRequiredUpdateVersion === appUpdate?.latestVersion

  // Treat any update (optional or required) as a blocking update for this app.
  // Use appUpdateStatus from the store to ensure we capture server-classified updates.
  const requiredUpdateBlocked =
    (appUpdateStatus === 'update-available' || appUpdateStatus === 'update-required') &&
    !allowRequiredUpdateBypass

  const showOptionalUpdateDialog = Boolean(
    appUpdate &&
    !requiredUpdateBlocked &&
    (appUpdateStatus === 'downloading' ||
      appUpdateStatus === 'ready-to-restart' ||
      (appUpdateStatus === 'failed' &&
        (Boolean(appUpdate.latestVersion || appUpdate.selectedAssetUrl) ||
          appUpdate.status === 'failed'))),
  )

  // Trace the decision path for the update modal
  if (import.meta.env.DEV || bootstrap.settings.developerMode) {
    // eslint-disable-next-line no-console
    console.debug('[App] Update state:', {
      appUpdateStatus,
      requiredUpdateBlocked,
      showOptionalUpdateDialog,
      latestVersion: appUpdate?.latestVersion,
      dismissedVersion: dismissedAppUpdateVersion,
      minimumSupportedVersion: appUpdate?.minimumSupportedVersion,
      hasSelectedAsset: Boolean(appUpdate?.selectedAssetUrl),
    })
  }

  const needsSetup =
    !bootstrap.settings.setupCompleted || !bootstrap.settings.obsPath

  return (
    <>
      {requiredUpdateBlocked && appUpdate ? (
        <RequiredUpdateScreen
          canBypass={canBypassRequiredUpdate}
          isApplying={isApplyingAppUpdate}
          onBypass={() => setBypassedRequiredUpdateVersion(appUpdate.latestVersion ?? '__dev__')}
          onDownload={() => {
            void downloadAppUpdate()
          }}
          onInstall={() => {
            void installAppUpdate()
          }}
          onOpenManualFallback={
            appUpdate.selectedAssetUrl
              ? () => void openExternal(appUpdate.selectedAssetUrl ?? '')
              : undefined
          }
          onRetry={() => {
            void checkForAppUpdate({ forcePrompt: true })
          }}
          progress={appUpdateProgress}
          snapshot={appUpdate}
          status={appUpdateStatus}
        />
      ) : needsSetup ? (
        <SetupWizard
          detection={bootstrap.obsDetection}
          isBusy={isSetupWorking}
          onAcceptDetectedPath={saveObsPath}
          onChooseDirectory={chooseObsDirectory}
          onDetectAgain={detectObs}
        />
      ) : (
        <HashRouter>
          <Routes>
            <Route element={<AppShell />} path="/">
              <Route element={<DashboardPage />} index />
              <Route element={<DiagnosticsPage />} path="diagnostics" />
              <Route element={<DiscoverPage />} path="plugins" />
              <Route element={<InstalledPage />} path="installed" />
              <Route element={<UpdatesPage />} path="updates" />
              <Route element={<SettingsPage />} path="settings" />
              <Route element={<FeedbackPage />} path="feedback" />
              <Route element={<PluginDetailsPage />} path="plugin/:pluginId" />
            </Route>
          </Routes>
        </HashRouter>
      )}
      {showOptionalUpdateDialog && appUpdate ? (
        <AppUpdateDialog
          isApplying={isApplyingAppUpdate}
          onDismiss={dismissAppUpdate}
          onDownload={() => {
            void downloadAppUpdate()
          }}
          onInstall={() => {
            void installAppUpdate()
          }}
          onOpenManualFallback={
            appUpdate.selectedAssetUrl
              ? () => void openExternal(appUpdate.selectedAssetUrl ?? '')
              : undefined
          }
          onRetry={() => {
            void checkForAppUpdate({ forcePrompt: true })
          }}
          progress={appUpdateProgress}
          snapshot={appUpdate}
          status={appUpdateStatus}
        />
      ) : null}
      <Toaster position="top-right" richColors theme={toasterTheme} />
    </>
  )
}

export default App
