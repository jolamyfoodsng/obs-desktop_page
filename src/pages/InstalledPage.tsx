import { type ReactNode, useDeferredValue, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { EmptyState } from '../components/EmptyState'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { CopyPathField } from '../components/ui/CopyPathField'
import {
  formatDisplayDate,
  getInstallMethod,
  getInstallOwnershipLabel,
  getPluginCompatibility,
  getRecommendedPackage,
  hasGitHubReleaseSource,
  isScriptPlugin,
  isUpdateAvailable,
  resolvePrimaryEntryFiles,
} from '../lib/utils'
import { useAppStore } from '../stores/appStore'
import type { InstallHistoryEntry, InstalledPluginRecord } from '../types/desktop'
import type { PluginCatalogEntry } from '../types/plugin'

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger'

interface TrackedPluginRow {
  plugin: PluginCatalogEntry
  installedPlugin: InstalledPluginRecord
  section: 'installed' | 'attention'
  statusLabel: string
  statusTone: BadgeTone
  helperText: string
  hasUpdate: boolean
  installMethod: ReturnType<typeof getInstallMethod>
  ownershipLabel: string
  compatibility: ReturnType<typeof getPluginCompatibility>
  recommendedPackage: ReturnType<typeof getRecommendedPackage>
  isInstallerInstall: boolean
  isExternalInstall: boolean
  isScriptEntry: boolean
  isStandaloneTool: boolean
  isScriptAttachPending: boolean
  resolvedEntryFiles: ReturnType<typeof resolvePrimaryEntryFiles>
  canDelete: boolean
  deleteDisabledReason: string | null
}

interface RemovedPluginRow {
  pluginId: string
  plugin: PluginCatalogEntry | null
  pluginName: string
  helperText: string
  removedAt: string
  removedVersion: string | null
  installLocation: string | null
  sourcePage: string | null
  compatibility: ReturnType<typeof getPluginCompatibility> | null
  recommendedPackage: ReturnType<typeof getRecommendedPackage>
}

function matchesSearch(query: string, values: Array<string | null | undefined>) {
  if (!query) {
    return true
  }

  return values.join(' ').toLowerCase().includes(query)
}

function getSourcePage(plugin?: PluginCatalogEntry | null) {
  if (!plugin) {
    return null
  }

  return plugin.sourceUrl ?? plugin.manualInstallUrl ?? plugin.homepageUrl ?? null
}

function buildTrackedPluginRow(
  plugin: PluginCatalogEntry,
  installedPlugin: InstalledPluginRecord,
  currentPlatform: string,
): TrackedPluginRow {
  const hasUpdate = isUpdateAvailable(installedPlugin.installedVersion, plugin.version)
  const compatibility = getPluginCompatibility(plugin, currentPlatform)
  const recommendedPackage = getRecommendedPackage(plugin, currentPlatform)
  const installMethod = getInstallMethod(installedPlugin)
  const isInstallerInstall = installMethod === 'installer'
  const isExternalInstall = installMethod === 'external'
  const isScriptEntry = isScriptPlugin(plugin, installedPlugin)
  const isStandaloneTool = installedPlugin.sourceType === 'standalone-tool'
  const isScriptAttachPending =
    installedPlugin.status === 'manual-step' && installedPlugin.sourceType === 'script'
  const resolvedEntryFiles = resolvePrimaryEntryFiles(plugin, installedPlugin)
  const needsAttention =
    installedPlugin.status === 'manual-step' ||
    installedPlugin.status === 'missing-files' ||
    installedPlugin.verificationStatus === 'missing-files'
  const canDelete =
    installedPlugin.managed &&
    (installedPlugin.installedFiles.length > 0 ||
      !['external-installer', 'manual'].includes(installedPlugin.sourceType))

  let statusLabel = 'Installed'
  let statusTone: BadgeTone = 'success'
  let helperText = 'All tracked installation files are present and the plugin is ready to use.'

  if (installedPlugin.status === 'missing-files' || installedPlugin.verificationStatus === 'missing-files') {
    statusLabel = 'Missing installation files'
    statusTone = 'danger'
    helperText = isScriptEntry
      ? 'The script record still exists, but one or more tracked files are missing from the OBS scripts folder.'
      : isStandaloneTool
        ? 'This tool was installed before, but one or more tracked files are no longer present in its install folder.'
        : 'OBS Plugin Installer expected this plugin in your OBS folders, but one or more tracked files are missing.'
  } else if (installedPlugin.status === 'manual-step') {
    statusLabel = 'Installation incomplete'
    statusTone = 'warning'
    helperText = isScriptAttachPending
      ? 'The script file was copied successfully, but OBS still needs you to add it in Tools -> Scripts.'
      : isStandaloneTool
        ? 'The files are present, but the last setup step still needs to be completed before this tool is fully ready.'
        : 'The install started, but OBS Plugin Installer could not verify the final plugin files yet.'
  } else if (hasUpdate) {
    statusLabel = 'Update available'
    statusTone = 'warning'
    helperText = `A newer catalog version is available. Reinstall to move from v${installedPlugin.installedVersion} to v${plugin.version}.`
  } else if (isExternalInstall) {
    statusTone = 'neutral'
    helperText =
      'This plugin is present in your OBS folders, but this copy was not installed by OBS Plugin Installer.'
  } else if (isInstallerInstall) {
    statusTone = 'neutral'
    helperText =
      'This plugin was installed through a guided installer flow and the install completed successfully.'
  }

  let deleteDisabledReason: string | null = null
  if (!canDelete) {
    deleteDisabledReason = isExternalInstall
      ? 'This copy was detected in OBS and was not installed by OBS Plugin Installer, so automatic removal is unavailable.'
      : 'OBS Plugin Installer cannot remove this install automatically because it does not have a safe tracked file list to delete.'
  }

  return {
    plugin,
    installedPlugin,
    section: needsAttention ? 'attention' : 'installed',
    statusLabel,
    statusTone,
    helperText,
    hasUpdate,
    installMethod,
    ownershipLabel: getInstallOwnershipLabel(installedPlugin),
    compatibility,
    recommendedPackage,
    isInstallerInstall,
    isExternalInstall,
    isScriptEntry,
    isStandaloneTool,
    isScriptAttachPending,
    resolvedEntryFiles,
    canDelete,
    deleteDisabledReason,
  }
}

function buildRemovedPluginRows(
  installHistory: InstallHistoryEntry[],
  installedPlugins: InstalledPluginRecord[],
  pluginsById: Map<string, PluginCatalogEntry>,
  currentPlatform: string,
) {
  const installedIds = new Set(installedPlugins.map((record) => record.pluginId))
  const latestHistoryByPlugin = new Map<string, InstallHistoryEntry>()

  for (const entry of installHistory) {
    const current = latestHistoryByPlugin.get(entry.pluginId)
    if (!current || new Date(entry.timestamp).getTime() >= new Date(current.timestamp).getTime()) {
      latestHistoryByPlugin.set(entry.pluginId, entry)
    }
  }

  const removedRows: RemovedPluginRow[] = []

  for (const [pluginId, latestEntry] of latestHistoryByPlugin) {
    if (installedIds.has(pluginId) || latestEntry.action !== 'uninstall') {
      continue
    }

    const plugin = pluginsById.get(pluginId) ?? null
    const sourcePage = getSourcePage(plugin)
    removedRows.push({
      pluginId,
      plugin,
      pluginName: plugin?.name ?? latestEntry.pluginName,
      helperText: latestEntry.installLocation
        ? `This plugin was removed from ${latestEntry.installLocation}. Install it again if you want to restore it.`
        : 'This plugin was removed from your OBS setup. Install it again if you want to restore it.',
      removedAt: latestEntry.timestamp,
      removedVersion: latestEntry.version ?? null,
      installLocation: latestEntry.installLocation ?? null,
      sourcePage,
      compatibility: plugin ? getPluginCompatibility(plugin, currentPlatform) : null,
      recommendedPackage: plugin ? getRecommendedPackage(plugin, currentPlatform) : undefined,
    })
  }

  return removedRows
}

function SectionHeader({
  count,
  description,
  icon,
  title,
}: {
  count: number
  description: string
  icon: ReactNode
  title: string
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-white/10 p-5 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-primary">
          {icon}
        </div>
        <div>
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
        </div>
      </div>
      <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300">
        {count} plugin{count === 1 ? '' : 's'}
      </div>
    </div>
  )
}

export function InstalledPage() {
  const navigate = useNavigate()
  const bootstrap = useAppStore((state) => state.bootstrap)
  const currentPlatform = bootstrap?.currentPlatform ?? 'windows'
  const developerMode = bootstrap?.settings.developerMode ?? false
  const searchQuery = useAppStore((state) => state.searchQuery)
  const installPlugin = useAppStore((state) => state.installPlugin)
  const uninstallPlugin = useAppStore((state) => state.uninstallPlugin)
  const uninstallingPluginId = useAppStore((state) => state.uninstallingPluginId)
  const openExternal = useAppStore((state) => state.openExternal)
  const revealPath = useAppStore((state) => state.revealPath)
  const deferredSearch = useDeferredValue(searchQuery.trim().toLowerCase())
  const [pendingDelete, setPendingDelete] = useState<{
    pluginId: string
    pluginName: string
    installLocation: string
  } | null>(null)

  const { installedRows, attentionRows, removedRows, totalRows } = useMemo(() => {
    const pluginsById = new Map((bootstrap?.plugins ?? []).map((plugin) => [plugin.id, plugin]))

    const trackedRows = (bootstrap?.installedPlugins ?? [])
      .map((installedPlugin) => {
        const plugin = pluginsById.get(installedPlugin.pluginId)
        if (!plugin) {
          return null
        }

        return buildTrackedPluginRow(plugin, installedPlugin, currentPlatform)
      })
      .filter((row): row is TrackedPluginRow => Boolean(row))

    const removed = buildRemovedPluginRows(
      bootstrap?.installHistory ?? [],
      bootstrap?.installedPlugins ?? [],
      pluginsById,
      currentPlatform,
    )

    const filteredTrackedRows = trackedRows.filter((row) =>
      matchesSearch(deferredSearch, [
        row.plugin.name,
        row.plugin.author,
        row.plugin.category,
        row.statusLabel,
        row.helperText,
      ]),
    )

    const filteredRemovedRows = removed.filter((row) =>
      matchesSearch(deferredSearch, [
        row.pluginName,
        row.plugin?.author,
        row.plugin?.category,
        row.helperText,
      ]),
    )

    return {
      installedRows: filteredTrackedRows.filter((row) => row.section === 'installed'),
      attentionRows: filteredTrackedRows.filter((row) => row.section === 'attention'),
      removedRows: filteredRemovedRows,
      totalRows: filteredTrackedRows.length + filteredRemovedRows.length,
    }
  }, [bootstrap, currentPlatform, deferredSearch])

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return
    }

    const response = await uninstallPlugin(pendingDelete.pluginId)
    if (response?.success) {
      setPendingDelete(null)
    }
  }

  function installOptionsForRow(
    plugin: PluginCatalogEntry,
    recommendedPackage: ReturnType<typeof getRecommendedPackage>,
  ) {
    return {
      overwrite: true,
      packageId: hasGitHubReleaseSource(plugin) ? null : recommendedPackage?.id ?? null,
    }
  }

  function installOptionsForFreshInstall(
    plugin: PluginCatalogEntry,
    recommendedPackage: ReturnType<typeof getRecommendedPackage>,
  ) {
    return {
      overwrite: false,
      packageId: hasGitHubReleaseSource(plugin) ? null : recommendedPackage?.id ?? null,
    }
  }

  function renderTrackedRow(row: TrackedPluginRow) {
    const sourcePage = getSourcePage(row.plugin)
    const canRetry = row.compatibility.canInstall
    const canOpenManualFix =
      row.section === 'attention' &&
      (row.isScriptAttachPending ||
        (row.installedPlugin.status === 'manual-step' && row.isStandaloneTool))
    const primaryActionLabel = row.section === 'attention' ? 'Fix installation' : 'Reinstall'
    const secondaryActionLabel = row.section === 'attention' ? 'Retry' : null
    const removeButton = (
      <Button
        disabled={!row.canDelete || uninstallingPluginId === row.plugin.id}
        size="sm"
        variant="ghost"
        onClick={() =>
          setPendingDelete({
            pluginId: row.plugin.id,
            pluginName: row.plugin.name,
            installLocation: row.installedPlugin.installLocation,
          })
        }
      >
        <Trash2 className="size-4" />
        Remove
      </Button>
    )

    return (
      <article
        className="rounded-[24px] border border-white/10 bg-black/20 p-5"
        key={row.plugin.id}
      >
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="text-left text-lg font-semibold text-white transition hover:text-primary"
                  onClick={() => navigate(`/plugins/${row.plugin.id}`)}
                  type="button"
                >
                  {row.plugin.name}
                </button>
                {row.plugin.verified ? (
                  <ShieldCheck className="size-4 text-primary" />
                ) : null}
                <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
              </div>
              <p className="text-sm text-slate-400">{row.plugin.tagline}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {row.isScriptEntry ? <Badge tone="script">OBS Script</Badge> : null}
              {row.isStandaloneTool ? <Badge tone="neutral">Standalone Tool</Badge> : null}
              {row.isExternalInstall ? <Badge tone="neutral">Detected in OBS</Badge> : null}
              {row.installedPlugin.verificationStatus === 'verified' ? (
                <Badge tone="success">Verified files</Badge>
              ) : null}
              {row.installedPlugin.backup ? (
                <Badge tone="neutral">Rollback snapshot</Badge>
              ) : null}
            </div>

            <p className="text-sm leading-6 text-slate-300">{row.helperText}</p>

            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
              <span>Installed v{row.installedPlugin.installedVersion}</span>
              <span>Catalog v{row.plugin.version}</span>
              <span>{row.ownershipLabel}</span>
              <span>Installed {formatDisplayDate(row.installedPlugin.installedAt)}</span>
              {row.installedPlugin.lastVerifiedAt ? (
                <span>Last verified {formatDisplayDate(row.installedPlugin.lastVerifiedAt)}</span>
              ) : null}
            </div>

            {row.isScriptEntry && row.installedPlugin.downloadPath ? (
              <CopyPathField
                buttonClassName="h-7 w-7"
                codeClassName="rounded-md px-2 py-1 text-[11px] leading-5"
                value={row.installedPlugin.downloadPath}
              />
            ) : null}
            {!row.isScriptEntry && row.resolvedEntryFiles.length ? (
              <CopyPathField
                buttonClassName="h-7 w-7"
                codeClassName="rounded-md px-2 py-1 text-[11px] leading-5"
                value={row.resolvedEntryFiles[0].absolutePath}
              />
            ) : null}
            {developerMode ? (
              <p className="break-all text-[11px] leading-5 text-slate-500">
                {row.installedPlugin.sourceType} • {row.installedPlugin.installLocation}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-start gap-2 xl:max-w-[320px] xl:justify-end">
            {sourcePage ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void openExternal(sourcePage)}
              >
                <ExternalLink className="size-4" />
                Source
              </Button>
            ) : null}
            <Button
              disabled={!canOpenManualFix && !row.compatibility.canInstall}
              size="sm"
              variant={row.section === 'attention' ? 'primary' : 'secondary'}
              onClick={() => {
                if (canOpenManualFix) {
                  void revealPath(row.installedPlugin.installLocation)
                  return
                }

                void installPlugin(
                  row.plugin.id,
                  installOptionsForRow(row.plugin, row.recommendedPackage),
                )
              }}
            >
              {row.section === 'attention' ? (
                <Wrench className="size-4" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {primaryActionLabel}
            </Button>
            {secondaryActionLabel ? (
              <Button
                disabled={!canRetry}
                size="sm"
                variant="secondary"
                onClick={() =>
                  void installPlugin(
                    row.plugin.id,
                    installOptionsForRow(row.plugin, row.recommendedPackage),
                  )
                }
              >
                <RefreshCw className="size-4" />
                {secondaryActionLabel}
              </Button>
            ) : null}
            {row.isScriptEntry ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void revealPath(row.installedPlugin.installLocation)}
              >
                <FolderOpen className="size-4" />
                Open Scripts Folder
              </Button>
            ) : null}
            {row.canDelete ? (
              removeButton
            ) : (
              <span title={row.deleteDisabledReason ?? undefined}>{removeButton}</span>
            )}
          </div>
        </div>
      </article>
    )
  }

  function renderRemovedRow(row: RemovedPluginRow) {
    const plugin = row.plugin
    const sourcePage = row.sourcePage
    const canInstallAgain = Boolean(row.plugin && row.compatibility?.canInstall)
    const installAgainButton = (
      <Button
        disabled={!canInstallAgain}
        size="sm"
        variant="primary"
        onClick={() => {
          if (!plugin) {
            return
          }

          void installPlugin(
            plugin.id,
            installOptionsForFreshInstall(plugin, row.recommendedPackage),
          )
        }}
      >
        <RotateCcw className="size-4" />
        Install again
      </Button>
    )

    return (
      <article
        className="rounded-[24px] border border-white/10 bg-black/20 p-5"
        key={`${row.pluginId}-${row.removedAt}`}
      >
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {plugin ? (
                  <button
                    className="text-left text-lg font-semibold text-white transition hover:text-primary"
                    onClick={() => navigate(`/plugins/${plugin.id}`)}
                    type="button"
                  >
                    {row.pluginName}
                  </button>
                ) : (
                  <p className="text-lg font-semibold text-white">{row.pluginName}</p>
                )}
                <Badge tone="neutral">Removed</Badge>
              </div>
              <p className="text-sm leading-6 text-slate-300">{row.helperText}</p>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
              {row.removedVersion ? <span>Last installed v{row.removedVersion}</span> : null}
              <span>Removed {formatDisplayDate(row.removedAt)}</span>
              {row.installLocation ? <span>{row.installLocation}</span> : null}
            </div>

            {!plugin ? (
              <p className="text-sm text-amber-200">
                This plugin is no longer in the current catalog, so only the historical record is available.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-start gap-2 xl:max-w-[280px] xl:justify-end">
            {sourcePage ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void openExternal(sourcePage)}
              >
                <ExternalLink className="size-4" />
                Source
              </Button>
            ) : null}
            {canInstallAgain ? (
              installAgainButton
            ) : (
              <span
                title={
                  row.plugin
                    ? row.compatibility?.disabledActionLabel || row.compatibility?.reason
                    : 'This plugin is no longer available in the current catalog.'
                }
              >
                {installAgainButton}
              </span>
            )}
          </div>
        </div>
      </article>
    )
  }

  return (
    <>
      <div className="space-y-8">
        <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">
              Installed
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">Plugin states</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
              Plugins are grouped by what is actually true on this machine: working installs,
              installs that need repair, and plugins you previously removed.
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
            {totalRows} visible item{totalRows === 1 ? '' : 's'}
          </div>
        </section>

        {totalRows === 0 ? (
          <section className="overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] shadow-panel">
            <div className="p-6">
              <EmptyState
                description="Installed plugins, broken installs, and removed plugins appear here after OBS Plugin Installer tracks them."
                icon={<PackageOpen className="size-5" />}
                primaryAction={{
                  label: 'Browse plugins',
                  onClick: () => navigate('/plugins'),
                  variant: 'primary',
                }}
                title="No tracked plugins"
              />
            </div>
          </section>
        ) : null}

        {installedRows.length > 0 ? (
          <section className="overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] shadow-panel">
            <SectionHeader
              count={installedRows.length}
              description="These plugins are fully installed and currently valid."
              icon={<CheckCircle2 className="size-5" />}
              title="Installed Plugins"
            />
            <div className="space-y-4 p-5">{installedRows.map(renderTrackedRow)}</div>
          </section>
        ) : null}

        {attentionRows.length > 0 ? (
          <section className="overflow-hidden rounded-[32px] border border-amber-400/20 bg-white/[0.04] shadow-panel">
            <SectionHeader
              count={attentionRows.length}
              description="These plugins need another step, a repair, or a reinstall before they are fully usable."
              icon={<AlertTriangle className="size-5" />}
              title="Needs Attention"
            />
            <div className="space-y-4 p-5">{attentionRows.map(renderTrackedRow)}</div>
          </section>
        ) : null}

        {removedRows.length > 0 ? (
          <section className="overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] shadow-panel">
            <SectionHeader
              count={removedRows.length}
              description="These plugins were previously installed and later removed from this machine."
              icon={<RotateCcw className="size-5" />}
              title="Removed Plugins"
            />
            <div className="space-y-4 p-5">{removedRows.map(renderRemovedRow)}</div>
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        cancelLabel="Keep plugin"
        confirmLabel="Remove plugin"
        description={
          pendingDelete
            ? `This will remove ${pendingDelete.pluginName} from ${pendingDelete.installLocation}.`
            : ''
        }
        isBusy={Boolean(pendingDelete && uninstallingPluginId === pendingDelete.pluginId)}
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Remove ${pendingDelete.pluginName}?` : 'Remove plugin?'}
        onCancel={() => {
          if (!uninstallingPluginId) {
            setPendingDelete(null)
          }
        }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </>
  )
}
