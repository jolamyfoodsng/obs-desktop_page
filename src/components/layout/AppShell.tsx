import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Boxes,
  Download,
  FolderSearch2,
  Home,
  RefreshCw,
  Search,
  Settings,
  Wrench,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { getInstallMethod, isUpdateAvailable } from '../../lib/utils'
import { useAppStore } from '../../stores/appStore'
import type { InstallProgressEvent } from '../../types/desktop'
import { CommandPalette, type CommandPaletteSection } from '../CommandPalette'
import { InstallProgressModal } from '../InstallProgressModal'
import { ObsVersionBadge } from '../ObsVersionBadge'
import { Button } from '../ui/Button'
import { CopyPathField } from '../ui/CopyPathField'
import { ShortcutHint } from '../ui/ShortcutHint'

const navItems = [
  { to: '/', label: 'Dashboard', badge: null, shortcut: ['Alt', '1'] },
  { to: '/plugins', label: 'Plugins', badge: null, shortcut: ['Alt', '2'] },
  { to: '/installed', label: 'Installed', badge: null, shortcut: ['Alt', '3'] },
  { to: '/updates', label: 'Updates', badge: 'updates' as const, shortcut: ['Alt', '4'] },
  { to: '/settings', label: 'Settings', badge: null, shortcut: ['Alt', '5'] },
]

const RECENT_SEARCHES_STORAGE_KEY = 'obs-plugin-installer.recent-searches'

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
  const checkForAppUpdate = useAppStore((state) => state.checkForAppUpdate)
  const loadApp = useAppStore((state) => state.loadApp)
  const detectObs = useAppStore((state) => state.detectObs)
  const retryLastInstall = useAppStore((state) => state.retryLastInstall)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }

    try {
      const stored = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)
      const parsed = stored ? JSON.parse(stored) : []
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 5) : []
    } catch {
      return []
    }
  })

  const installPluginEntry = installProgress
    ? bootstrap?.plugins.find((plugin) => plugin.id === installProgress.pluginId)
    : undefined
  const showBackButton = location.pathname !== '/'

  const installedByPluginId = new Map(
    (bootstrap?.installedPlugins ?? []).map((plugin) => [plugin.pluginId, plugin]),
  )
  const updatesReady = (bootstrap?.plugins ?? []).filter((plugin) => {
    const installed = installedByPluginId.get(plugin.id)
    const installMethod = getInstallMethod(installed)
    return Boolean(
      installed &&
        installMethod &&
        installMethod !== 'external' &&
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

  const openCommandPalette = useCallback((initialQuery = searchQuery) => {
    setCommandPaletteQuery(initialQuery)
    setIsCommandPaletteOpen(true)
  }, [searchQuery])

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false)
  }, [])

  const rememberSearch = useCallback((query: string) => {
    const normalized = query.trim()
    if (!normalized) {
      return
    }

    const next = [normalized, ...recentSearches.filter((item) => item !== normalized)].slice(0, 5)
    setRecentSearches(next)
    window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next))
  }, [recentSearches])

  const palettePlugins = useMemo(() => {
    const query = commandPaletteQuery.trim().toLowerCase()
    const haystackEntries = bootstrap?.plugins ?? []

    if (!query) {
      return haystackEntries
        .slice()
        .sort((left, right) => {
          const leftScore = Number(Boolean(left.featured)) + Number(Boolean(left.verified))
          const rightScore = Number(Boolean(right.featured)) + Number(Boolean(right.verified))
          return rightScore - leftScore || left.name.localeCompare(right.name)
        })
        .slice(0, 3)
    }

    return haystackEntries
      .filter((plugin) =>
        [plugin.name, plugin.author, plugin.description, plugin.category]
          .join(' ')
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 6)
  }, [bootstrap?.plugins, commandPaletteQuery])

  const commandPaletteSections = useMemo<CommandPaletteSection[]>(() => {
    const query = commandPaletteQuery.trim()
    const navigationItems = [
      { id: 'nav-dashboard', title: 'Dashboard', subtitle: 'See install health, updates, and OBS status', icon: <Home className="size-4" />, shortcut: 'Alt+1', onSelect: () => navigate('/') },
      { id: 'nav-plugins', title: 'Plugins', subtitle: 'Browse the full plugin catalog', icon: <Boxes className="size-4" />, shortcut: 'Alt+2', onSelect: () => navigate('/plugins') },
      { id: 'nav-installed', title: 'Installed', subtitle: 'Review managed and external installs', icon: <Boxes className="size-4" />, shortcut: 'Alt+3', onSelect: () => navigate('/installed') },
      { id: 'nav-updates', title: 'Updates', subtitle: 'Review update-ready app-owned installs', icon: <Download className="size-4" />, shortcut: 'Alt+4', onSelect: () => navigate('/updates') },
      { id: 'nav-settings', title: 'Settings', subtitle: 'OBS paths, app updates, and preferences', icon: <Settings className="size-4" />, shortcut: 'Alt+5', onSelect: () => navigate('/settings') },
    ]

    const commandItems = [
      {
        id: 'command-check-updates',
        title: 'Check for updates',
        subtitle: 'Run the desktop updater check now',
        icon: <RefreshCw className="size-4" />,
        onSelect: () => void checkForAppUpdate({ forcePrompt: true }),
      },
      {
        id: 'command-refresh-catalog',
        title: 'Refresh catalog state',
        subtitle: 'Reload local catalog, install state, and detection data',
        icon: <RefreshCw className="size-4" />,
        onSelect: () => void loadApp(),
      },
      {
        id: 'command-detect-obs',
        title: 'Run OBS detection',
        subtitle: 'Re-scan the local machine for OBS Studio',
        icon: <FolderSearch2 className="size-4" />,
        onSelect: () => void detectObs(),
      },
      {
        id: 'command-open-diagnostics',
        title: 'Open diagnostics',
        subtitle: 'Run a system health check for OBS and managed installs',
        icon: <Wrench className="size-4" />,
        onSelect: () => navigate('/diagnostics'),
      },
      {
        id: 'command-open-installed',
        title: 'Open installed plugins',
        subtitle: 'Jump directly to the installed resources list',
        icon: <Wrench className="size-4" />,
        onSelect: () => navigate('/installed'),
      },
    ]

    const searchItems = query
      ? [
          {
            id: `search-${query}`,
            title: `Search catalog for “${query}”`,
            subtitle: 'Apply this search to the catalog page',
            icon: <Search className="size-4" />,
            badge: 'Plugins',
            onSelect: () => {
              rememberSearch(query)
              setSearchQuery(query)
              navigate('/plugins')
            },
          },
        ]
      : recentSearches.map((item) => ({
          id: `recent-${item}`,
          title: item,
          subtitle: 'Recent search',
          icon: <Search className="size-4" />,
          badge: 'Recent',
          onSelect: () => {
            setSearchQuery(item)
            navigate('/plugins')
          },
        }))

    const pluginItems = palettePlugins.map((plugin) => ({
      id: `plugin-${plugin.id}`,
      title: plugin.name,
      subtitle: `${plugin.author} • ${plugin.category}`,
      icon: <Boxes className="size-4" />,
      badge: plugin.verified ? 'Verified' : undefined,
      onSelect: () => {
        if (query) {
          rememberSearch(query)
        }
        navigate(`/plugin/${plugin.id}`)
      },
    }))

    return [
      { id: 'search', title: query ? 'Search' : 'Recent searches', items: searchItems },
      { id: 'navigation', title: 'Navigation', items: navigationItems },
      { id: 'commands', title: 'Commands', items: commandItems },
      {
        id: 'plugins',
        title: query ? 'Matching plugins' : 'Popular plugins',
        items: pluginItems,
      },
    ].filter((section) => section.items.length > 0)
  }, [
    checkForAppUpdate,
    commandPaletteQuery,
    detectObs,
    loadApp,
    navigate,
    palettePlugins,
    recentSearches,
    rememberSearch,
    setSearchQuery,
  ])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return
      }

      const key = event.key.toLowerCase()
      const modifierKey = event.metaKey || event.ctrlKey
      const editableTarget = isEditableTarget(event.target)

      if (modifierKey && key === 'k') {
        event.preventDefault()
        openCommandPalette()
        return
      }

      if (modifierKey && key === ',') {
        event.preventDefault()
        navigate('/settings')
        return
      }

      if (!modifierKey && !event.altKey && !event.shiftKey && key === '/' && !editableTarget) {
        event.preventDefault()
        openCommandPalette()
        return
      }

      if (event.altKey && !modifierKey && !event.shiftKey) {
        const route =
          key === '1'
            ? '/'
            : key === '2'
              ? '/plugins'
            : key === '3'
                ? '/installed'
              : key === '4'
                  ? '/updates'
                : key === '5'
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

      if (isCommandPaletteOpen) {
        event.preventDefault()
        closeCommandPalette()
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
  }, [clearInstallProgress, closeCommandPalette, installProgress, isCommandPaletteOpen, navigate, openCommandPalette, searchQuery, setSearchQuery])

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
                <button
                  className="flex h-10 min-w-[280px] max-w-xl flex-1 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-left text-sm text-slate-400 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
                  onClick={() => openCommandPalette()}
                  title="Open command palette (Ctrl/Cmd+K or /)"
                  type="button"
                >
                  <Search className="size-4 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate">
                    {searchQuery.trim().length > 0 ? searchQuery : 'Search plugins, commands, and navigation'}
                  </span>
                  <span className="hidden items-center gap-2 sm:flex">
                    <ShortcutHint keys={['Ctrl/Cmd', 'K']} />
                    <span className="text-[11px] text-slate-600">or</span>
                    <ShortcutHint keys={['/']} />
                  </span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <ObsVersionBadge detection={bootstrap?.obsDetection} />
                <Button
                  size="sm"
                  title="Open settings (Ctrl/Cmd+, or Alt+5)"
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
        onRetryInstall={() => void retryLastInstall()}
      />

      <CommandPalette
        onClose={closeCommandPalette}
        onQueryChange={setCommandPaletteQuery}
        open={isCommandPaletteOpen}
        query={commandPaletteQuery}
        sections={commandPaletteSections}
      />
    </>
  )
}
