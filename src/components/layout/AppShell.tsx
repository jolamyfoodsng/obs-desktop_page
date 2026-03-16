import { useEffect, useRef } from 'react'
import { ArrowLeft, Search, Settings } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { getInstallMethod, isUpdateAvailable } from '../../lib/utils'
import { useAppStore } from '../../stores/appStore'
import type { InstallProgressEvent } from '../../types/desktop'
import { InstallProgressModal } from '../InstallProgressModal'
import { Button } from '../ui/Button'
import { CopyPathField } from '../ui/CopyPathField'
import { ShortcutHint } from '../ui/ShortcutHint'

const navItems = [
  { to: '/', label: 'Catalog', badge: null, shortcut: ['Alt', '1'] },
  { to: '/installed', label: 'Installed', badge: null, shortcut: ['Alt', '2'] },
  { to: '/updates', label: 'Updates', badge: 'updates' as const, shortcut: ['Alt', '3'] },
  { to: '/settings', label: 'Settings', badge: null, shortcut: ['Alt', '4'] },
]

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function canDismissInstallProgress(progress: InstallProgressEvent | null) {
  if (!progress) {
    return false
  }

  return (
    progress.terminal === true ||
    progress.stage === 'completed' ||
    progress.stage === 'error' ||
    progress.stage === 'canceled' ||
    progress.stage === 'review' ||
    progress.stage === 'manual'
  )
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const bootstrap = useAppStore((state) => state.bootstrap)
  const searchQuery = useAppStore((state) => state.searchQuery)
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)
  const installProgress = useAppStore((state) => state.installProgress)
  const clearInstallProgress = useAppStore((state) => state.clearInstallProgress)
  const lastInstallResponse = useAppStore((state) => state.lastInstallResponse)
  const cancelingInstallPluginId = useAppStore((state) => state.cancelingInstallPluginId)
  const cancelInstall = useAppStore((state) => state.cancelInstall)
  const openExternal = useAppStore((state) => state.openExternal)
  const openLocalPath = useAppStore((state) => state.openLocalPath)
  const revealPath = useAppStore((state) => state.revealPath)

  const installPluginEntry = installProgress
    ? bootstrap?.plugins.find((plugin) => plugin.id === installProgress.pluginId)
    : undefined
  const showBackButton = location.pathname !== '/'

  const installedByPluginId = new Map(
    (bootstrap?.installedPlugins ?? []).map((plugin) => [plugin.pluginId, plugin]),
  )
  const updatesReady = (bootstrap?.plugins ?? []).filter((plugin) => {
    const installed = installedByPluginId.get(plugin.id)
    return Boolean(
      installed &&
        getInstallMethod(installed) === 'managed' &&
        isUpdateAvailable(installed.installedVersion, plugin.version),
    )
  }).length

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }

    navigate('/')
  }

  useEffect(() => {
    function focusSearch() {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return
      }

      const key = event.key.toLowerCase()
      const modifierKey = event.metaKey || event.ctrlKey
      const editableTarget = isEditableTarget(event.target)

      if (modifierKey && key === 'k') {
        event.preventDefault()
        focusSearch()
        return
      }

      if (modifierKey && key === ',') {
        event.preventDefault()
        navigate('/settings')
        return
      }

      if (!modifierKey && !event.altKey && !event.shiftKey && key === '/' && !editableTarget) {
        event.preventDefault()
        focusSearch()
        return
      }

      if (event.altKey && !modifierKey && !event.shiftKey) {
        const route =
          key === '1'
            ? '/'
            : key === '2'
              ? '/installed'
              : key === '3'
                ? '/updates'
                : key === '4'
                  ? '/settings'
                  : null

        if (route) {
          event.preventDefault()
          navigate(route)
          return
        }
      }

      if (key !== 'escape') {
        return
      }

      if (document.activeElement === searchInputRef.current) {
        event.preventDefault()
        if (searchQuery.trim().length > 0) {
          setSearchQuery('')
          return
        }

        searchInputRef.current?.blur()
        return
      }

      if (editableTarget) {
        return
      }

      if (canDismissInstallProgress(installProgress)) {
        event.preventDefault()
        clearInstallProgress()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearInstallProgress, installProgress, navigate, searchQuery, setSearchQuery])

  return (
    <>
      <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100">
        <aside className="hidden w-56 shrink-0 border-r border-white/10 bg-background-dark lg:flex lg:flex-col">
          <div className="border-b border-white/10 px-4 py-4">
            <p className="text-[18px] font-semibold text-white">OBS Plugin Installer</p>
            <p className="mt-1 text-[12px] text-slate-500">
              Desktop plugin manager
            </p>
          </div>

          <nav className="flex-1 space-y-1 px-3 py-3">
            {navItems.map((item, index) => (
              <NavLink
                className={({ isActive }) =>
                  [
                    'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary text-on-accent'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-white',
                  ].join(' ')
                }
                end={item.to === '/'}
                key={item.to}
                title={`Go to ${item.label} (Alt+${index + 1})`}
                to={item.to}
              >
                {({ isActive }) => (
                  <>
                    <span>{item.label}</span>
                    <span className="flex items-center gap-2">
                      {item.badge === 'updates' && updatesReady > 0 ? (
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">
                          {updatesReady}
                        </span>
                      ) : null}
                      <ShortcutHint
                        className={isActive ? 'text-on-accent/80' : 'text-slate-500'}
                        keyClassName={
                          isActive
                            ? 'border-white/20 bg-white/15 text-on-accent'
                            : undefined
                        }
                        keys={item.shortcut}
                      />
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-white/10 px-4 py-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              OBS Path
            </p>
            {bootstrap?.settings.obsPath ? (
              <CopyPathField
                buttonClassName="h-7 w-7"
                className="mt-2"
                codeClassName="rounded-md bg-transparent px-0 py-0 text-[12px] leading-6 text-slate-300"
                value={bootstrap.settings.obsPath}
              />
            ) : (
              <p className="mt-2 break-all text-[12px] leading-6 text-slate-300">
                Not configured
              </p>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-white/10 bg-background-dark px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                {showBackButton ? (
                  <Button size="sm" variant="secondary" onClick={handleBack}>
                    <ArrowLeft className="size-4" />
                    Back
                  </Button>
                ) : null}
                <label className="relative min-w-[280px] max-w-xl flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                  <input
                    className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.03] pl-10 pr-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-primary/30 sm:pr-28"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search plugins"
                    ref={searchInputRef}
                    title="Search plugins (Ctrl/Cmd+K or /)"
                    value={searchQuery}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 hidden items-center gap-2 sm:flex">
                    <ShortcutHint keys={['Ctrl/Cmd', 'K']} />
                    <span className="text-[11px] text-slate-600">or</span>
                    <ShortcutHint keys={['/']} />
                  </span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-lg border border-white/10 px-3 py-2 text-[12px] text-slate-400">
                  {bootstrap?.settings.obsPath ? 'OBS configured' : 'Setup required'}
                </span>
                <Button
                  size="sm"
                  title="Open settings (Ctrl/Cmd+, or Alt+4)"
                  variant="ghost"
                  onClick={() => navigate('/settings')}
                >
                  <Settings className="size-4" />
                  Settings
                  <ShortcutHint className="ml-1 hidden md:inline-flex" keys={['Ctrl/Cmd', ',']} />
                </Button>
              </div>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
            <Outlet />
          </main>
        </div>
      </div>

      <InstallProgressModal
        isCanceling={Boolean(
          installProgress &&
            cancelingInstallPluginId &&
            cancelingInstallPluginId === installProgress.pluginId,
        )}
        lastResponse={lastInstallResponse}
        onCancelInstall={
          installProgress
            ? () => void cancelInstall(installProgress.pluginId)
            : undefined
        }
        onClose={clearInstallProgress}
        onOpenInstallFolder={
          lastInstallResponse?.installedPlugin?.installLocation
            ? () => void revealPath(lastInstallResponse.installedPlugin?.installLocation ?? '')
            : undefined
        }
        onOpenInstallerManually={
          lastInstallResponse?.canOpenInstallerManually && lastInstallResponse.manualInstallerPath
            ? () => void openLocalPath(lastInstallResponse.manualInstallerPath ?? '')
            : undefined
        }
        onOpenSource={
          installPluginEntry
            ? () =>
                void openExternal(
                  lastInstallResponse?.githubReleaseUrl ??
                    installPluginEntry.githubReleaseUrl ??
                    installPluginEntry.manualInstallUrl ??
                    installPluginEntry.sourceUrl ??
                    installPluginEntry.homepageUrl,
                )
            : undefined
        }
        onViewPlugin={
          installPluginEntry
            ? () => navigate(`/plugin/${installPluginEntry.id}`)
            : undefined
        }
        plugin={installPluginEntry}
        progress={installProgress}
      />
    </>
  )
}
