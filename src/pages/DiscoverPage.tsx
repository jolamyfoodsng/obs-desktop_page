import { useDeferredValue, useEffect, useRef } from 'react'
import { SearchX } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { EmptyState } from '../components/EmptyState'
import { PluginCard } from '../components/PluginCard'
import { Badge } from '../components/ui/Badge'
import { getAnalyticsContext, trackEvent } from '../lib/analytics'
import { getCatalogPluginState, getPluginCompatibility } from '../lib/utils'
import { useAppStore } from '../stores/appStore'

export function DiscoverPage() {
  const navigate = useNavigate()
  const trackedSearchRef = useRef<string | null>(null)
  const bootstrap = useAppStore((state) => state.bootstrap)
  const currentPlatform = bootstrap?.currentPlatform ?? 'windows'
  const searchQuery = useAppStore((state) => state.searchQuery)
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)
  const selectedCategory = useAppStore((state) => state.selectedCategory)
  const setSelectedCategory = useAppStore((state) => state.setSelectedCategory)
  const catalogViewMode = useAppStore((state) => state.catalogViewMode)
  const setCatalogViewMode = useAppStore((state) => state.setCatalogViewMode)
  const installPlugin = useAppStore((state) => state.installPlugin)
  const deferredSearch = useDeferredValue(searchQuery.trim().toLowerCase())

  const installedByPluginId = new Map(
    (bootstrap?.installedPlugins ?? []).map((plugin) => [plugin.pluginId, plugin]),
  )

  const categories = [
    'Compatible',
    'All',
    'Installed',
    'Updates',
    ...Array.from(new Set((bootstrap?.plugins ?? []).map((plugin) => plugin.category))).sort(),
  ]

  const categoryCounts = new Map(
    categories.map((category) => {
      const count = (bootstrap?.plugins ?? []).filter((plugin) => {
        const installedPlugin = installedByPluginId.get(plugin.id)
        const pluginState = getCatalogPluginState(plugin, installedPlugin)
        const compatibility = getPluginCompatibility(plugin, currentPlatform)

        if (category === 'Compatible') {
          return compatibility.canInstall
        }

        if (category === 'All') {
          return true
        }

        if (category === 'Installed') {
          return pluginState !== 'install'
        }

        if (category === 'Updates') {
          return pluginState === 'update-available'
        }

        return plugin.category === category
      }).length

      return [category, count]
    }),
  )

  const filteredPlugins = (bootstrap?.plugins ?? [])
    .filter((plugin) => {
      const installedPlugin = installedByPluginId.get(plugin.id)
      const pluginState = getCatalogPluginState(plugin, installedPlugin)
      const compatibility = getPluginCompatibility(plugin, currentPlatform)

      const matchesCategory =
        selectedCategory === 'All' ||
        (selectedCategory === 'Compatible' && compatibility.canInstall) ||
        (selectedCategory === 'Installed' && pluginState !== 'install') ||
        (selectedCategory === 'Updates' && pluginState === 'update-available') ||
        plugin.category === selectedCategory

      const haystack = [
        plugin.name,
        plugin.author,
        plugin.description,
        plugin.category,
      ]
        .join(' ')
        .toLowerCase()

      const matchesSearch =
        deferredSearch.length === 0 || haystack.includes(deferredSearch)

      return matchesCategory && matchesSearch
    })
    .sort((left, right) => {
      const leftCompatibility = getPluginCompatibility(left, currentPlatform)
      const rightCompatibility = getPluginCompatibility(right, currentPlatform)
      const leftInstalled = getCatalogPluginState(left, installedByPluginId.get(left.id))
      const rightInstalled = getCatalogPluginState(right, installedByPluginId.get(right.id))

      const leftRank =
        leftInstalled === 'update-available'
          ? 0
          : leftInstalled === 'installed'
            ? 1
            : leftCompatibility.canInstall
              ? 2
              : 3
      const rightRank =
        rightInstalled === 'update-available'
          ? 0
          : rightInstalled === 'installed'
            ? 1
            : rightCompatibility.canInstall
              ? 2
              : 3

      return leftRank - rightRank || left.name.localeCompare(right.name)
    })

  const compatibleCount = categoryCounts.get('Compatible') ?? 0
  const catalogCount = bootstrap?.plugins.length ?? 0

  useEffect(() => {
    if (!bootstrap || deferredSearch.length === 0) {
      return
    }

    const signature = `${selectedCategory}:${deferredSearch}:${filteredPlugins.length}`
    if (trackedSearchRef.current === signature) {
      return
    }
    trackedSearchRef.current = signature

    trackEvent('plugin_search', {
      ...getAnalyticsContext(bootstrap),
      query: deferredSearch,
      queryLength: deferredSearch.length,
      selectedCategory,
      resultCount: filteredPlugins.length,
    })
  }, [bootstrap, deferredSearch, filteredPlugins.length, selectedCategory])

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[18px] font-semibold text-white">Plugin Catalog</h1>
            <p className="mt-1 text-[14px] text-slate-400">
              Browse curated plugins and official OBS resources for {currentPlatform === 'macos' ? 'macOS' : currentPlatform}.
            </p>
            <p className="mt-1 text-[9px] text-slate-400">
            Note: We don’t host or store plugin files. All plugins are downloaded directly from their official sources (such as OBS or the original developer) and installed on your system.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{catalogCount} total</Badge>
            <Badge tone="success">{compatibleCount} compatible</Badge>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                className={[
                  'rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors',
                  selectedCategory === category
                    ? 'border-primary bg-primary text-on-accent'
                    : 'border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-white',
                ].join(' ')}
                key={category}
                onClick={() => setSelectedCategory(category)}
                type="button"
              >
                {category}
                <span
                  className={[
                    'ml-2',
                    selectedCategory === category ? 'text-on-accent' : 'text-slate-500',
                  ].join(' ')}
                >
                  {categoryCounts.get(category) ?? 0}
                </span>
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-1">
            {(['list', 'grid'] as const).map((mode) => (
              <button
                className={[
                  'rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
                  catalogViewMode === mode
                    ? 'bg-primary text-on-accent'
                    : 'text-slate-400 hover:text-white',
                ].join(' ')}
                key={mode}
                onClick={() => setCatalogViewMode(mode)}
                type="button"
              >
                {mode === 'list' ? 'List' : 'Grid'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section
        className={
          filteredPlugins.length === 0
            ? 'space-y-3'
            : catalogViewMode === 'grid'
              ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'
              : 'space-y-3'
        }
      >
        {filteredPlugins.length === 0 ? (
          <EmptyState
            description={
              deferredSearch.length > 0 ? (
                <>
                  We couldn’t find anything matching{' '}
                  <span className="font-medium text-primary">“{searchQuery.trim()}”</span>.
                </>
              ) : (
                'No resources match the current catalog filter.'
              )
            }
            icon={<SearchX className="size-5" />}
            primaryAction={
              deferredSearch.length > 0
                ? {
                    label: 'Clear search',
                    onClick: () => setSearchQuery(''),
                    variant: 'secondary',
                  }
                : undefined
            }
            secondaryAction={
              selectedCategory !== 'All'
                ? {
                    label: 'Browse all',
                    onClick: () => setSelectedCategory('All'),
                    variant: 'outline',
                  }
                : undefined
            }
            suggestions={[
              'Try a broader search',
              'Check spelling',
              'Browse categories',
            ]}
            title="No results found"
          />
        ) : (
          filteredPlugins.map((plugin) => (
            <PluginCard
              currentPlatform={currentPlatform}
              installedPlugin={installedByPluginId.get(plugin.id)}
              key={plugin.id}
              onInstall={(pluginId, options) => void installPlugin(pluginId, options)}
              onSelect={(pluginId) => navigate(`/plugin/${pluginId}`)}
              plugin={plugin}
              viewMode={catalogViewMode}
            />
          ))
        )}
      </section>
    </div>
  )
}
