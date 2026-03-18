import { ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react'

import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/ui/Button'
import {
  getInstallMethod,
  getPluginCompatibility,
  getRecommendedPackage,
  hasGitHubReleaseSource,
  isUpdateAvailable,
} from '../lib/utils'
import { useAppStore } from '../stores/appStore'

export function UpdatesPage() {
  const bootstrap = useAppStore((state) => state.bootstrap)
  const currentPlatform = bootstrap?.currentPlatform ?? 'windows'
  const installPlugin = useAppStore((state) => state.installPlugin)

  const installedByPluginId = new Map(
    (bootstrap?.installedPlugins ?? []).map((plugin) => [plugin.pluginId, plugin]),
  )

  const updates = (bootstrap?.plugins ?? []).filter((plugin) => {
    const installed = installedByPluginId.get(plugin.id)
    if (
      !installed ||
      getInstallMethod(installed) !== 'managed' ||
      installed.installKind !== 'full'
    ) {
      return false
    }

    if (!getPluginCompatibility(plugin, currentPlatform).canInstall) {
      return false
    }

    return isUpdateAvailable(installed.installedVersion, plugin.version)
  })

  async function updateAll() {
    for (const plugin of updates) {
      const packageId = hasGitHubReleaseSource(plugin)
        ? null
        : getRecommendedPackage(plugin, currentPlatform)?.id ?? null
      await installPlugin(plugin.id, { overwrite: true, packageId })
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 border-b border-white/10 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-white">
            {updates.length} update{updates.length === 1 ? '' : 's'} ready
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-7 text-slate-400">
            Only managed installations with compatible packages appear here. Externally installed
            plugins stay out of automated update flows until you adopt them.
          </p>
        </div>
        <Button disabled={updates.length === 0} onClick={() => void updateAll()}>
          <RefreshCw className="size-4" />
          Update all
        </Button>
      </section>

      <section className="space-y-4">
        {updates.length === 0 ? (
          <EmptyState
            description="Managed plugins are already current, or the remaining installs are external and not eligible for automatic updates yet."
            icon={<ShieldCheck className="size-5" />}
            title="No updates available"
          />
        ) : (
          updates.map((plugin) => {
            const installed = installedByPluginId.get(plugin.id)
            if (!installed) {
              return null
            }

            return (
              <article
                className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 md:flex-row md:items-center md:justify-between"
                key={plugin.id}
              >
                <div>
                  <h2 className="text-[18px] font-semibold text-white">{plugin.name}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{plugin.description}</p>
                  <div className="mt-4 flex items-center gap-3 text-sm font-medium text-slate-300">
                    <span className="rounded-full bg-white/[0.06] px-3 py-1 font-mono">
                      v{installed.installedVersion}
                    </span>
                    <ArrowRight className="size-4 text-primary" />
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 font-mono text-primary">
                      v{plugin.version}
                    </span>
                  </div>
                </div>

                <Button
                  onClick={() =>
                    void installPlugin(plugin.id, {
                      overwrite: true,
                      packageId: hasGitHubReleaseSource(plugin)
                        ? null
                        : getRecommendedPackage(plugin, currentPlatform)?.id ?? null,
                    })
                  }
                >
                  <RefreshCw className="size-4" />
                  Update
                </Button>
              </article>
            )
          })
        )}
      </section>
    </div>
  )
}
