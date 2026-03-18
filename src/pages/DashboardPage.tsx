import {
  Activity,
  ArrowRight,
  Boxes,
  Download,
  LifeBuoy,
  PackageCheck,
  ShieldCheck,
  Stethoscope,
  MessageSquareMore,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { CopyPathField } from '../components/ui/CopyPathField'
import { PluginGlyph } from '../lib/pluginVisuals'
import {
  formatDisplayDate,
  getInstallMethod,
  getPluginCompatibility,
  getRecommendedPackage,
  hasGitHubReleaseSource,
  isUpdateAvailable,
} from '../lib/utils'
import { useAppStore } from '../stores/appStore'

function formatHistoryAction(action: string) {
  switch (action) {
    case 'update':
      return 'Updated'
    case 'repair':
      return 'Repaired'
    case 'adopt':
      return 'Adopted'
    case 'uninstall':
      return 'Removed'
    default:
      return 'Installed'
  }
}

function formatPlatformLabel(platform: string) {
  switch (platform) {
    case 'macos':
      return 'macOS'
    case 'linux':
      return 'Linux'
    case 'windows':
      return 'Windows'
    default:
      return platform
  }
}

export function DashboardPage() {
  const navigate = useNavigate()
  const bootstrap = useAppStore((state) => state.bootstrap)
  const checkForAppUpdate = useAppStore((state) => state.checkForAppUpdate)
  const installPlugin = useAppStore((state) => state.installPlugin)

  if (!bootstrap) {
    return null
  }

  const currentPlatform = bootstrap.currentPlatform
  const currentPlatformLabel = formatPlatformLabel(currentPlatform)
  const pluginsById = new Map(bootstrap.plugins.map((plugin) => [plugin.id, plugin]))

  const installedRows = bootstrap.installedPlugins
    .map((installedPlugin) => ({
      installedPlugin,
      plugin: pluginsById.get(installedPlugin.pluginId),
    }))
    .filter(
      (
        row,
      ): row is {
        installedPlugin: (typeof bootstrap.installedPlugins)[number]
        plugin: NonNullable<ReturnType<typeof pluginsById.get>>
      } => Boolean(row.plugin),
    )

  const managedInstalledCount = installedRows.filter(
    ({ installedPlugin }) => getInstallMethod(installedPlugin) === 'managed',
  ).length

  const updates = installedRows
    .filter(({ installedPlugin, plugin }) => {
      if (getInstallMethod(installedPlugin) !== 'managed' || installedPlugin.installKind !== 'full') {
        return false
      }

      if (!getPluginCompatibility(plugin, currentPlatform).canInstall) {
        return false
      }

      return isUpdateAvailable(installedPlugin.installedVersion, plugin.version)
    })
    .sort((left, right) => left.plugin.name.localeCompare(right.plugin.name))

  const recentActivity = bootstrap.installHistory
    .slice()
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 5)

  const recentManagedInstallsThisMonth = bootstrap.installHistory.filter((entry) => {
    const activityDate = new Date(entry.timestamp)
    const now = new Date()

    return (
      activityDate.getFullYear() === now.getFullYear() &&
      activityDate.getMonth() === now.getMonth() &&
      entry.managed &&
      (entry.action === 'install' || entry.action === 'adopt')
    )
  }).length

  const verificationFailures = bootstrap.installedPlugins.filter(
    (plugin) => plugin.verificationStatus === 'missing-files',
  ).length

  const diagnosticsHealthy =
    verificationFailures === 0 &&
    bootstrap.obsDetection.isValid &&
    bootstrap.obsDetection.isSupported

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-3 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary/80">
            Dashboard
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">System Dashboard</h1>
            <Badge tone="success">Stable</Badge>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            Track managed installs, OBS readiness, diagnostics, and update activity from one place.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          v{bootstrap.currentVersion} • {currentPlatformLabel}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Managed Plugins
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <span className="text-3xl font-black text-white">{managedInstalledCount}</span>
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
              +{recentManagedInstallsThisMonth} new this month
            </span>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Updates Available
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <span className="text-3xl font-black text-primary">{updates.length}</span>
            <Download className="size-5 text-primary/50" />
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            OBS Version
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <span className="text-3xl font-black text-white">
              {bootstrap.obsDetection.obsVersion ?? 'Unknown'}
            </span>
            <span className="text-sm text-slate-500">
              {bootstrap.obsDetection.isSupported ? 'Supported' : 'Needs review'}
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <section className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04]">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
              <Button size="sm" variant="ghost" onClick={() => navigate('/installed')}>
                View installed list
              </Button>
            </div>
            <div className="divide-y divide-white/10">
              {recentActivity.length === 0 ? (
                <div className="px-6 py-8 text-sm text-slate-400">
                  No install activity has been recorded yet.
                </div>
              ) : (
                recentActivity.map((entry) => {
                  const plugin = pluginsById.get(entry.pluginId)
                  const canOpenPlugin = Boolean(plugin)
                  const content = (
                    <>
                      <div className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-primary">
                        {plugin?.iconUrl ? (
                          <img
                            alt={`${entry.pluginName} icon`}
                            className="size-full rounded-xl object-cover"
                            src={plugin.iconUrl}
                          />
                        ) : (
                          <PluginGlyph className="size-5" iconKey={plugin?.iconKey ?? 'effects'} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">{entry.pluginName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {entry.version ? `v${entry.version}` : 'Version unavailable'} •{' '}
                          {formatHistoryAction(entry.action)}
                        </p>
                      </div>
                      <span className="text-[11px] font-mono text-slate-600">
                        {formatDisplayDate(entry.timestamp)}
                      </span>
                    </>
                  )

                  if (!canOpenPlugin) {
                    return (
                      <div
                        className="flex w-full items-center gap-4 px-6 py-4"
                        key={`${entry.pluginId}-${entry.timestamp}`}
                      >
                        {content}
                      </div>
                    )
                  }

                  return (
                    <button
                      className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-white/[0.03]"
                      key={`${entry.pluginId}-${entry.timestamp}`}
                      onClick={() => navigate(`/plugin/${entry.pluginId}`)}
                      type="button"
                    >
                      {content}
                    </button>
                  )
                })
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04]">
            <div className="flex items-center justify-between border-b border-white/10 bg-primary/5 px-6 py-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                <Download className="size-4 text-primary" />
                Updates Available
              </h2>
              <Button size="sm" variant="ghost" onClick={() => navigate('/updates')}>
                Open updates
              </Button>
            </div>
            <div className="space-y-4 p-6">
              {updates.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                  All managed installs are current for this platform.
                </div>
              ) : (
                updates.slice(0, 3).map(({ installedPlugin, plugin }) => {
                  const recommendedPackage = getRecommendedPackage(plugin, currentPlatform)

                  return (
                    <div
                      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:flex-row md:items-center md:justify-between"
                      key={plugin.id}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{plugin.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Current: v{installedPlugin.installedVersion} →{' '}
                          <span className="text-primary">New: v{plugin.version}</span>
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          void installPlugin(plugin.id, {
                            overwrite: true,
                            packageId: hasGitHubReleaseSource(plugin)
                              ? null
                              : recommendedPackage?.id ?? null,
                          })
                        }
                      >
                        Update
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <section className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
              Quick Actions
            </h2>
            <div className="mt-4 flex flex-col gap-3">
              <Button onClick={() => void checkForAppUpdate({ forcePrompt: true })}>
                <Download className="size-4" />
                Check updates
              </Button>
              <Button variant="secondary" onClick={() => navigate('/plugins')}>
                <Boxes className="size-4" />
                Browse plugins
              </Button>
              <Button variant="secondary" onClick={() => navigate('/diagnostics')}>
                <Stethoscope className="size-4" />
                Open diagnostics
              </Button>
              <Button variant="secondary" onClick={() => navigate('/feedback')}>
                <LifeBuoy className="size-4" />
                Open support
              </Button>
            </div>
          </section>

          <section className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
              OBS Status
            </h2>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Installation Path
                </span>
                {bootstrap.settings.obsPath ? (
                  <CopyPathField
                    codeClassName="rounded-xl px-3 py-2 text-xs"
                    value={bootstrap.settings.obsPath}
                  />
                ) : (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
                    OBS path not configured yet.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-b border-white/10 py-2">
                <span className="text-xs text-slate-400">Validation</span>
                <span className="text-xs font-semibold text-primary">
                  {bootstrap.obsDetection.isValid ? 'Validated' : 'Needs setup'}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 py-2">
                <span className="text-xs text-slate-400">Version</span>
                <span className="text-xs font-semibold text-slate-200">
                  {bootstrap.obsDetection.obsVersion ?? 'Unknown'}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 py-2">
                <span className="text-xs text-slate-400">Plugin target</span>
                <span className="text-right text-xs font-semibold text-slate-200">
                  {bootstrap.obsDetection.installTargetLabel ?? 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-slate-400">Platform</span>
                <span className="text-xs font-semibold text-slate-200">{currentPlatformLabel}</span>
              </div>
            </div>
          </section>

          <section className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
            <div className="absolute right-4 top-4 opacity-10">
              <ShieldCheck className="size-16 text-primary" />
            </div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
              Diagnostics
            </h2>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                {diagnosticsHealthy ? (
                  <>
                    <ShieldCheck className="size-5 text-primary" />
                    <span className="text-sm font-semibold text-primary">No issues found.</span>
                  </>
                ) : (
                  <>
                    <Activity className="size-5 text-amber-300" />
                    <span className="text-sm font-semibold text-amber-200">
                      Attention needed
                    </span>
                  </>
                )}
              </div>
              <p className="text-sm leading-7 text-slate-400">
                {diagnosticsHealthy
                  ? 'Managed installs are verified and OBS is ready for plugin operations.'
                  : `${verificationFailures} plugin installation${
                      verificationFailures === 1 ? '' : 's'
                    } need attention, or OBS validation needs review.`}
              </p>
              <Button size="sm" variant="ghost" onClick={() => navigate('/diagnostics')}>
                <PackageCheck className="size-4" />
                Open diagnostics
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
