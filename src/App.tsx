import { useEffect, useRef, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react'
import { coerce, lt } from 'semver'
import { Toaster } from 'sonner'

import { AppUpdateDialog } from './components/AppUpdateDialog'
import { RequiredUpdateScreen } from './components/RequiredUpdateScreen'
import { SetupWizard } from './components/SetupWizard'
import { AppShell } from './components/layout/AppShell'
import { Button } from './components/ui/Button'
import { desktopApi } from './lib/tauri'
import { DiscoverPage } from './pages/DiscoverPage'
import { InstalledPage } from './pages/InstalledPage'
import { PluginDetailsPage } from './pages/PluginDetailsPage'
import { SettingsPage } from './pages/SettingsPage'
import { UpdatesPage } from './pages/UpdatesPage'
import { useAppStore } from './stores/appStore'
import type { AccentColor, AppUpdateSnapshot, ThemeMode } from './types/desktop'

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

function isRequiredUpdate(snapshot: AppUpdateSnapshot | null) {
  if (!snapshot?.minimumSupportedVersion) {
    return false
  }

  const currentVersion = coerce(snapshot.currentVersion)?.version
  const minimumSupportedVersion = coerce(snapshot.minimumSupportedVersion)?.version

  if (!currentVersion || !minimumSupportedVersion) {
    return false
  }

  return lt(currentVersion, minimumSupportedVersion)
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
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-dark px-4">
      <div className="w-full max-w-2xl rounded-xl border border-rose-400/20 bg-white/[0.03] p-6 shadow-panel">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-rose-500/10 p-3 text-rose-300">
            <AlertTriangle className="size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-semibold tracking-tight text-white">
              OBS Plugin Installer could not finish loading
            </h1>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              The backend returned this error during the initial bootstrap step.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-rose-100">
              {error}
            </pre>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button disabled={isRetrying} onClick={onRetry}>
                {isRetrying ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                Retry startup
              </Button>
            </div>
          </div>
        </div>
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
  const requiredUpdateBlocked = isRequiredUpdate(appUpdate) && !allowRequiredUpdateBypass
  const showOptionalUpdateDialog = Boolean(
    appUpdate &&
      !requiredUpdateBlocked &&
      ((appUpdateStatus === 'update-available' &&
        dismissedAppUpdateVersion !== appUpdate.latestVersion) ||
        appUpdateStatus === 'downloading' ||
        appUpdateStatus === 'ready-to-restart' ||
        (appUpdateStatus === 'failed' &&
          Boolean(appUpdate.latestVersion || appUpdate.selectedAssetUrl))),
  )

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
              <Route element={<DiscoverPage />} index />
              <Route element={<InstalledPage />} path="installed" />
              <Route element={<UpdatesPage />} path="updates" />
              <Route element={<SettingsPage />} path="settings" />
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
