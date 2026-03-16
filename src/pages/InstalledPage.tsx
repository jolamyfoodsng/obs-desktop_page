import { useDeferredValue, useState } from 'react'
import { ExternalLink, FolderOpen, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'

import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { CopyPathField } from '../components/ui/CopyPathField'
import {
  formatDisplayDate,
  getPluginCompatibility,
  getRecommendedPackage,
  hasGitHubReleaseSource,
  isScriptPlugin,
  isUpdateAvailable,
} from '../lib/utils'
import { useAppStore } from '../stores/appStore'

export function InstalledPage() {
  const bootstrap = useAppStore((state) => state.bootstrap)
  const currentPlatform = bootstrap?.currentPlatform ?? 'windows'
  const developerMode = bootstrap?.settings.developerMode ?? false
  const searchQuery = useAppStore((state) => state.searchQuery)
  const installPlugin = useAppStore((state) => state.installPlugin)
  const adoptInstallation = useAppStore((state) => state.adoptInstallation)
  const adoptingPluginId = useAppStore((state) => state.adoptingPluginId)
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

  const pluginsById = new Map((bootstrap?.plugins ?? []).map((plugin) => [plugin.id, plugin]))
  const installedRows = (bootstrap?.installedPlugins ?? [])
    .map((installedPlugin) => ({
      installedPlugin,
      plugin: pluginsById.get(installedPlugin.pluginId),
    }))
    .filter((row) => row.plugin)
    .filter((row) => {
      const haystack = [
        row.plugin?.name,
        row.plugin?.author,
        row.plugin?.category,
      ]
        .join(' ')
        .toLowerCase()

      return deferredSearch.length === 0 || haystack.includes(deferredSearch)
    })

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return
    }

    const response = await uninstallPlugin(pendingDelete.pluginId)
    if (response?.success) {
      setPendingDelete(null)
    }
  }

  return (
    <>
      <div className="space-y-8">
        <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">
              Installed
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">
              Installed Plugins
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
              Managed installs, detected external installs, and update readiness are tracked
              separately so the app stays honest about ownership.
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
            {installedRows.length} tracked plugin{installedRows.length === 1 ? '' : 's'}
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] shadow-panel">
          {installedRows.length === 0 ? (
            <div className="p-10">
              <h3 className="text-xl font-semibold text-white">No plugins installed yet</h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                Installed plugins appear here after they go through OBS Plugin Installer. Guided vendor installers are tracked too, but they stay clearly marked until you finish the external flow.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="border-b border-white/10 bg-white/[0.04] text-xs uppercase tracking-[0.22em] text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Plugin</th>
                    <th className="px-6 py-4 font-semibold">Installed</th>
                    <th className="px-6 py-4 font-semibold">Catalog</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8">
                  {installedRows.map(({ installedPlugin, plugin }) => {
                    if (!plugin) {
                      return null
                    }

                    const hasUpdate = isUpdateAvailable(
                      installedPlugin.installedVersion,
                      plugin.version,
                    )
                    const compatibility = getPluginCompatibility(plugin, currentPlatform)
                    const recommendedPackage = getRecommendedPackage(plugin, currentPlatform)
                    const isManagedInstall = installedPlugin.managed
                    const isScriptAttachPending =
                      installedPlugin.status === 'manual-step' &&
                      installedPlugin.sourceType === 'script'
                    const isScriptEntry = isScriptPlugin(plugin, installedPlugin)
                    const isStandaloneTool =
                      installedPlugin.sourceType === 'standalone-tool'
                    const canDelete =
                      isManagedInstall &&
                      (installedPlugin.installedFiles.length > 0 ||
                        !['external-installer', 'manual'].includes(installedPlugin.sourceType))

                    return (
                      <tr className="hover:bg-white/[0.03]" key={plugin.id}>
                        <td className="px-6 py-5">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-white">{plugin.name}</p>
                              {plugin.verified ? (
                                <ShieldCheck className="size-4 text-primary" />
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {isScriptEntry ? <Badge tone="script">OBS Script</Badge> : null}
                              {isStandaloneTool ? (
                                <Badge tone="neutral">Standalone Tool</Badge>
                              ) : null}
                            </div>
                            <p className="text-sm text-slate-400">{plugin.tagline}</p>
                            <p className="text-xs text-slate-500">{compatibility.label}</p>
                            <p className="text-xs text-slate-500">
                              {isManagedInstall
                                ? `Installed ${formatDisplayDate(installedPlugin.installedAt)}`
                                : 'Detected in OBS folders on this device'}
                            </p>
                            {isScriptEntry && installedPlugin.downloadPath ? (
                              <CopyPathField
                                buttonClassName="h-7 w-7"
                                codeClassName="rounded-md px-2 py-1 text-[11px] leading-5"
                                value={installedPlugin.downloadPath}
                              />
                            ) : null}
                            {developerMode ? (
                              <p className="break-all text-[11px] leading-5 text-slate-500">
                                {installedPlugin.sourceType} • {installedPlugin.installLocation}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-sm text-slate-300">
                          v{installedPlugin.installedVersion}
                        </td>
                        <td className="px-6 py-5 text-sm text-slate-300">v{plugin.version}</td>
                        <td className="px-6 py-5">
                          {!isManagedInstall ? (
                            <Badge tone="warning">Installed externally</Badge>
                          ) : installedPlugin.status === 'missing-files' ? (
                            <Badge tone="danger">Files missing</Badge>
                          ) : isScriptAttachPending ? (
                            <Badge tone="warning">Needs OBS attach</Badge>
                          ) : installedPlugin.status === 'manual-step' ? (
                            <Badge tone="warning">Installer pending</Badge>
                          ) : hasUpdate ? (
                            <Badge tone="warning">Update available</Badge>
                          ) : isStandaloneTool ? (
                            <Badge tone="neutral">Tool installed</Badge>
                          ) : (
                            <Badge tone="success">Installed (managed)</Badge>
                          )}
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void openExternal(
                                  plugin.sourceUrl ?? plugin.manualInstallUrl ?? plugin.homepageUrl,
                                )
                              }
                            >
                              <ExternalLink className="size-4" />
                              Source
                            </Button>
                            {!isManagedInstall ? (
                              <Button
                                disabled={adoptingPluginId === plugin.id}
                                size="sm"
                                variant="secondary"
                                onClick={() => void adoptInstallation(plugin.id)}
                              >
                                {adoptingPluginId === plugin.id ? (
                                  'Adopting…'
                                ) : (
                                  'Adopt installation'
                                )}
                              </Button>
                            ) : (
                              <Button
                                disabled={!compatibility.canInstall}
                                size="sm"
                                variant={hasUpdate ? 'primary' : 'secondary'}
                                onClick={() =>
                                  void installPlugin(plugin.id, {
                                    overwrite: true,
                                    packageId: hasGitHubReleaseSource(plugin)
                                      ? null
                                      : recommendedPackage?.id ?? null,
                                  })
                                }
                              >
                                <RefreshCw className="size-4" />
                                {installedPlugin.status === 'manual-step'
                                  ? 'Retry'
                                  : hasUpdate
                                    ? 'Update'
                                    : isStandaloneTool
                                      ? 'Reinstall'
                                      : 'Repair'}
                              </Button>
                            )}
                            {isScriptEntry ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void revealPath(installedPlugin.installLocation)}
                              >
                                <FolderOpen className="size-4" />
                                Open Scripts Folder
                              </Button>
                            ) : null}
                            <Button
                              disabled={!canDelete || uninstallingPluginId === plugin.id}
                              size="sm"
                              title={
                                canDelete
                                  ? 'Delete this installed plugin'
                                  : 'Only managed installs can be removed automatically.'
                              }
                              variant="ghost"
                              onClick={() =>
                                setPendingDelete({
                                  pluginId: plugin.id,
                                  pluginName: plugin.name,
                                  installLocation: installedPlugin.installLocation,
                                })
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        confirmLabel="Delete Plugin"
        description={
          pendingDelete
            ? `This will remove the tracked files that OBS Plugin Installer placed in ${pendingDelete.installLocation}. Use this only if you want to remove the plugin from your local OBS setup.`
            : ''
        }
        isBusy={Boolean(pendingDelete && uninstallingPluginId === pendingDelete.pluginId)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void handleConfirmDelete()}
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete ${pendingDelete.pluginName}?` : 'Delete plugin?'}
      />
    </>
  )
}
