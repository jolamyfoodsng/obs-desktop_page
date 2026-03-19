import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Boxes,
  Download,
  FolderSearch2,
  Home,
  MessageSquareMore,
  RefreshCw,
  Search,
  Settings,
  Wrench,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { PluginGlyph } from '../../lib/pluginVisuals'
import { getCatalogPluginState, getInstallMethod, isUpdateAvailable } from '../../lib/utils'
import { useAppStore } from '../../stores/appStore'
import type { InstallProgressEvent, InstalledPluginRecord } from '../../types/desktop'
import type { PluginCatalogEntry } from '../../types/plugin'
import { CommandPalette, type CommandPaletteSection } from '../CommandPalette'
import { GlobalInstallProgressBar } from '../GlobalInstallProgressBar'
import { InstallProgressModal } from '../InstallProgressModal'
import { ObsVersionBadge } from '../ObsVersionBadge'
import { Button } from '../ui/Button'
import { CopyPathField } from '../ui/CopyPathField'
import { ShortcutHint } from '../ui/ShortcutHint'

const RECENT_SEARCHES_STORAGE_KEY = 'obs-plugin-installer.recent-searches'

const navItems = [
  {
    to: '/',
    label: 'Dashboard',
    subtitle: 'See install health, updates, and OBS status',
    icon: <Home className="size-4" />,
    shortcut: ['Alt', '1'],
    paletteShortcut: 'Alt+1',
    badge: null,
  },
  {
    to: '/plugins',
    label: 'Plugins',
    subtitle: 'Browse the full plugin catalog',
    icon: <Boxes className="size-4" />,
    shortcut: ['Alt', '2'],
    paletteShortcut: 'Alt+2',
    badge: null,
  },
  {
    to: '/installed',
    label: 'Installed',
    subtitle: 'Review managed and external installs',
    icon: <Boxes className="size-4" />,
    shortcut: ['Alt', '3'],
    paletteShortcut: 'Alt+3',
    badge: null,
  },
  {
    to: '/updates',
    label: 'Updates',
    subtitle: 'Review update-ready app-owned installs',
    icon: <Download className="size-4" />,
    shortcut: ['Alt', '4'],
    paletteShortcut: 'Alt+4',
    badge: 'updates' as const,
  },
  {
    to: '/settings',
    label: 'Settings',
    subtitle: 'OBS paths, app updates, and preferences',
    icon: <Settings className="size-4" />,
    shortcut: ['Alt', '5'],
    paletteShortcut: 'Alt+5',
    badge: null,
  },
  {
    to: '/feedback',
    label: 'Support',
    subtitle: 'Report problems, send feedback, or request plugins',
    icon: <MessageSquareMore className="size-4" />,
    shortcut: ['Alt', '6'],
    paletteShortcut: 'Alt+6',
    badge: null,
  },
]

const altRouteByKey = new Map(
  navItems.map((item) => [item.shortcut[item.shortcut.length - 1], item.to]),
)

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

function formatShortcutTitle(shortcut: string[]) {
  return shortcut.join('+')
}

function scorePalettePluginMatch(plugin: PluginCatalogEntry, query: string) {
  if (!query) {
    return Number(Boolean(plugin.featured)) * 40 + Number(Boolean(plugin.verified)) * 20
  }

  const normalizedName = plugin.name.toLowerCase()
  const normalizedTagline = plugin.tagline.toLowerCase()
  const normalizedDescription = plugin.description.toLowerCase()
  const normalizedCategory = plugin.category.toLowerCase()

  if (normalizedName === query) {
    return 1000
  }

  if (normalizedName.startsWith(query)) {
    return 900
  }

  if (normalizedName.includes(query)) {
    return 800
  }

  if (normalizedTagline.startsWith(query)) {
    return 650
  }

  if (normalizedTagline.includes(query)) {
    return 600
  }

  if (normalizedDescription.includes(query)) {
    return 500
  }

  if (normalizedCategory.includes(query)) {
    return 350
  }

  return -1
}

function getPalettePluginBadge(
  installedPlugin: InstalledPluginRecord | undefined,
  pluginState: ReturnType<typeof getCatalogPluginState>,
) {
  if (
    installedPlugin?.status === 'manual-step' ||
    installedPlugin?.status === 'missing-files' ||
    installedPlugin?.verificationStatus === 'missing-files'
  ) {
    return 'Needs attention'
  }

  if (pluginState === 'update-available') {
    return 'Update available'
  }

  if (pluginState === 'installed' || pluginState === 'installed-externally') {
    return 'Installed'
  }

  return 'Available'
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const bootstrap = useAppStore((state) => state.bootstrap)
  const searchQuery = useAppStore((state) => state.searchQuery)
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)
  const installProgress = useAppStore((state) => state.installProgress)
  const isInstallProgressVisible = useAppStore((state) => state.isInstallProgressVisible)
  const hideInstallProgress = useAppStore((state) => state.hideInstallProgress)
  const showInstallProgress = useAppStore((state) => state.showInstallProgress)
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
  const [debouncedCommandPaletteQuery, setDebouncedCommandPaletteQuery] = useState('')
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
  const installPluginRouteId = installPluginEntry?.id ?? installProgress?.pluginId ?? null
  const showBackButton = location.pathname !== '/'

  const installedByPluginId = useMemo(
    () => new Map((bootstrap?.installedPlugins ?? []).map((plugin) => [plugin.pluginId, plugin])),
    [bootstrap?.installedPlugins],
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
    setDebouncedCommandPaletteQuery(initialQuery)
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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedCommandPaletteQuery(commandPaletteQuery)
    }, 180)

    return () => window.clearTimeout(timeoutId)
  }, [commandPaletteQuery])

  const palettePlugins = useMemo(() => {
    const query = debouncedCommandPaletteQuery.trim().toLowerCase()
    const haystackEntries = bootstrap?.plugins ?? []

    return haystackEntries
      .map((plugin) => {
        const installedPlugin = installedByPluginId.get(plugin.id)
        return {
          plugin,
          installedPlugin,
          pluginState: getCatalogPluginState(plugin, installedPlugin),
          score: scorePalettePluginMatch(plugin, query),
        }
      })
      .filter((entry) => (!query ? true : entry.score >= 0))
      .sort((left, right) => {
        const installedRank =
          Number(Boolean(right.installedPlugin)) - Number(Boolean(left.installedPlugin))
        return (
          right.score - left.score ||
          installedRank ||
          right.plugin.name.localeCompare(left.plugin.name)
        )
      })
      .slice(0, query ? 8 : 5)
  }, [bootstrap?.plugins, debouncedCommandPaletteQuery, installedByPluginId])

  const commandPaletteSections = useMemo<CommandPaletteSection[]>(() => {
    const query = commandPaletteQuery.trim()
    const navigationItems = navItems.map((item) => ({
      id: `nav-${item.label.toLowerCase()}`,
      title: item.label,
      subtitle: item.subtitle,
      icon: item.icon,
      shortcut: item.paletteShortcut,
      onSelect: () => navigate(item.to),
      badge: item.badge === 'updates' && updatesReady > 0 ? String(updatesReady) : undefined,
    }))

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
        id: 'command-open-support',
        title: 'Open support center',
        subtitle: 'Report issues, send feedback, or request a plugin',
        icon: <MessageSquareMore className="size-4" />,
        onSelect: () => navigate('/feedback'),
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

    const pluginItems = palettePlugins.map(({ plugin, installedPlugin, pluginState }) => ({
      id: `plugin-${plugin.id}`,
      title: plugin.name,
      subtitle: plugin.tagline || plugin.description || `${plugin.author} • ${plugin.category}`,
      icon: plugin.iconUrl ? (
        <img
          alt=""
          className="size-4 rounded object-cover"
          loading="lazy"
          src={plugin.iconUrl}
        />
      ) : (
        <PluginGlyph className="size-4" iconKey={plugin.iconKey} />
      ),
      badge: getPalettePluginBadge(installedPlugin, pluginState),
      onSelect: () => {
        if (query) {
          rememberSearch(query)
        }
        navigate(`/plugin/${plugin.id}`)
      },
    }))

    const resultsSection: CommandPaletteSection = {
      id: 'results',
      title: query ? 'Results' : 'Popular plugins',
      items:
        query && pluginItems.length === 0
          ? [
              {
                id: 'results-empty',
                title: 'No matching plugins found',
                subtitle: 'Try a broader plugin name or description, or use the catalog search action below.',
                icon: <Search className="size-4" />,
                disabled: true,
                onSelect: () => undefined,
              },
            ]
          : pluginItems,
    }

    return [
      resultsSection,
      { id: 'search', title: query ? 'Search' : 'Recent searches', items: searchItems },
      { id: 'navigation', title: 'Navigation', items: navigationItems },
      { id: 'commands', title: 'Commands', items: commandItems },
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
    updatesReady,
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
        const route = altRouteByKey.get(key)

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

      if (installProgress && isInstallProgressVisible) {
        event.preventDefault()
        if (canDismissInstallProgress(installProgress)) {
          clearInstallProgress()
        } else {
          hideInstallProgress()
        }
        return
      }

      if (canDismissInstallProgress(installProgress)) {
        event.preventDefault()
        clearInstallProgress()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    clearInstallProgress,
    closeCommandPalette,
    hideInstallProgress,
    installProgress,
    isCommandPaletteOpen,
    isInstallProgressVisible,
    navigate,
    openCommandPalette,
  ])

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
            {navItems.map((item) => (
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
                title={`Go to ${item.label} (${formatShortcutTitle(item.shortcut)})`}
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
                  title="Open support (Alt+6)"
                  variant="ghost"
                  onClick={() => navigate('/feedback')}
                >
                  <MessageSquareMore className="size-4" />
                  Support
                </Button>
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

          {installProgress ? (
            <GlobalInstallProgressBar
              lastResponse={lastInstallResponse}
              onClear={installProgress.terminal ? clearInstallProgress : undefined}
              onOpenDetails={showInstallProgress}
              pluginName={installPluginEntry?.name ?? installProgress.pluginId}
              progress={installProgress}
            />
          ) : null}

          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
            <Outlet />
          </main>
        </div>
      </div>

      <InstallProgressModal
        open={isInstallProgressVisible}
        isCanceling={Boolean(
          installProgress &&
            cancelingInstallPluginId &&
            cancelingInstallPluginId === installProgress.pluginId,
        )}
        lastResponse={lastInstallResponse}
        onClear={clearInstallProgress}
        onCancelInstall={
          installProgress
            ? () => void cancelInstall(installProgress.pluginId)
            : undefined
        }
        onHide={hideInstallProgress}
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
          installPluginRouteId
            ? () => {
              clearInstallProgress()
              navigate(`/plugin/${installPluginRouteId}`)
            }
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
