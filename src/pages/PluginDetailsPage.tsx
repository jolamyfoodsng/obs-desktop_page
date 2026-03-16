import { useEffect, useState } from 'react'
import {
  ArrowUpCircle,
  ChevronDown,
  Download,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react'
import { useParams } from 'react-router-dom'

import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { CopyPathField } from '../components/ui/CopyPathField'
import { getErrorMessage } from '../lib/errors'
import { PluginGlyph } from '../lib/pluginVisuals'
import { desktopApi } from '../lib/tauri'
import {
  formatDisplayDate,
  formatSupportedPlatforms,
  getCatalogPluginState,
  getGitHubReleasesUrl,
  getGitHubRepoUrl,
  getPlatformPackages,
  getPluginCompatibility,
  getPluginTypeLabel,
  getRecommendedPackage,
  hasGitHubReleaseSource,
  isScriptPlugin,
} from '../lib/utils'
import { useAppStore } from '../stores/appStore'
import type { GitHubReleaseInfo } from '../types/desktop'

export function PluginDetailsPage() {
  const { pluginId } = useParams()
  const bootstrap = useAppStore((state) => state.bootstrap)
  const currentPlatform = bootstrap?.currentPlatform ?? 'windows'
  const installPlugin = useAppStore((state) => state.installPlugin)
  const adoptInstallation = useAppStore((state) => state.adoptInstallation)
  const adoptingPluginId = useAppStore((state) => state.adoptingPluginId)
  const openExternal = useAppStore((state) => state.openExternal)

  const plugin = bootstrap?.plugins.find((entry) => entry.id === pluginId)
  const installedPlugin = bootstrap?.installedPlugins.find(
    (entry) => entry.pluginId === pluginId,
  )
  const recommendedPackage = plugin
    ? getRecommendedPackage(plugin, currentPlatform)
    : undefined
  const alternatePackages = plugin
    ? getPlatformPackages(plugin, currentPlatform).filter(
        (entry) => entry.id !== recommendedPackage?.id,
      )
    : []
  const githubRepoUrl = plugin ? getGitHubRepoUrl(plugin) : null
  const githubReleasesUrl = plugin ? getGitHubReleasesUrl(plugin) : null

  const [githubRelease, setGitHubRelease] = useState<GitHubReleaseInfo | null>(null)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [isReleaseLoading, setIsReleaseLoading] = useState(false)
  const [showAdvancedAssets, setShowAdvancedAssets] = useState(false)
  const [selectedGitHubAssetName, setSelectedGitHubAssetName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadReleaseInfo() {
      if (!plugin || !hasGitHubReleaseSource(plugin)) {
        setGitHubRelease(null)
        setReleaseError(null)
        setIsReleaseLoading(false)
        return
      }

      setIsReleaseLoading(true)
      setReleaseError(null)
      setGitHubRelease(null)
      setSelectedGitHubAssetName(null)
      setShowAdvancedAssets(false)

      try {
        const release = await desktopApi.getGitHubReleaseInfo(plugin.id)
        if (!cancelled) {
          setGitHubRelease(release)
        }
      } catch (error) {
        if (!cancelled) {
          setReleaseError(getErrorMessage(error, 'Could not load release assets.'))
        }
      } finally {
        if (!cancelled) {
          setIsReleaseLoading(false)
        }
      }
    }

    void loadReleaseInfo()

    return () => {
      cancelled = true
    }
  }, [plugin])

  if (!plugin) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h1 className="text-[18px] font-semibold text-white">Plugin not found</h1>
        <p className="mt-1 text-sm text-slate-400">
          The selected resource is not part of the current catalog.
        </p>
      </div>
    )
  }

  const activePlugin = plugin

  const githubAssets = [] as NonNullable<GitHubReleaseInfo['selectedAsset']>[]
  if (githubRelease?.selectedAsset) {
    githubAssets.push(githubRelease.selectedAsset)
  }
  if (githubRelease) {
    githubAssets.push(...githubRelease.alternativeAssets)
  }

  const selectedGitHubAsset =
    githubAssets.find((asset) => asset.name === selectedGitHubAssetName) ??
    githubRelease?.selectedAsset ??
    null
  const isScriptEntry = isScriptPlugin(plugin, installedPlugin, selectedGitHubAsset?.name)
  const pluginTypeLabel = getPluginTypeLabel(plugin, installedPlugin, selectedGitHubAsset?.name)
  const pluginState = getCatalogPluginState(plugin, installedPlugin)
  const compatibility = getPluginCompatibility(plugin, currentPlatform, {
    releaseInfo: githubRelease,
  })
  const releaseCheckPending =
    isReleaseLoading &&
    !recommendedPackage &&
    !activePlugin.installStrategy &&
    hasGitHubReleaseSource(activePlugin)
  const canInstall = compatibility.canInstall && !releaseCheckPending
  const isInstalledManaged = pluginState === 'installed'
  const isInstalledExternal = pluginState === 'installed-externally'
  const isUpdateAvailable = pluginState === 'update-available'
  const sourcePage =
    activePlugin.sourceUrl ??
    activePlugin.manualInstallUrl ??
    githubReleasesUrl ??
    activePlugin.homepageUrl

  function handleInstall() {
    if (selectedGitHubAsset) {
      void installPlugin(activePlugin.id, {
        overwrite: Boolean(installedPlugin),
        githubAssetName: selectedGitHubAsset.name,
        githubAssetUrl: selectedGitHubAsset.downloadUrl,
      })
      return
    }

    void installPlugin(activePlugin.id, {
      overwrite: Boolean(installedPlugin),
      packageId: recommendedPackage?.id ?? null,
    })
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="flex size-16 items-center justify-center rounded-xl border border-white/10 bg-primary/12 text-primary">
              {plugin.iconUrl ? (
                <img
                  alt={`${plugin.name} icon`}
                  className="size-full rounded-xl object-cover"
                  src={plugin.iconUrl}
                />
              ) : (
                <PluginGlyph className="size-8" iconKey={plugin.iconKey} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h1 className="text-[18px] font-semibold text-white">{plugin.name}</h1>
                  <p className="mt-1 text-sm text-slate-400">
                    {plugin.author} • v{plugin.version}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={pluginTypeLabel === 'OBS Script' ? 'script' : 'neutral'}>
                      {pluginTypeLabel === 'OBS Script' ? 'OBS Script' : plugin.category}
                    </Badge>
                    <Badge tone={compatibility.tone}>{compatibility.label}</Badge>
                    {plugin.verified ? (
                      <Badge tone="verified">
                        <ShieldCheck className="size-3.5" />
                        Verified
                      </Badge>
                    ) : null}
                    {isInstalledManaged ? <Badge tone="success">Installed (managed)</Badge> : null}
                    {isInstalledExternal ? (
                      <Badge tone="warning">Installed externally</Badge>
                    ) : null}
                    {isUpdateAvailable ? <Badge tone="warning">Update available</Badge> : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {isInstalledExternal ? (
                    <Button
                      disabled={adoptingPluginId === plugin.id}
                      onClick={() => void adoptInstallation(plugin.id)}
                    >
                      {adoptingPluginId === plugin.id
                        ? 'Adopting…'
                        : 'Adopt installation'}
                    </Button>
                  ) : isInstalledManaged ? (
                    <Badge className="px-3 py-2 text-[12px]" tone="success">
                      Installed (managed)
                    </Badge>
                  ) : canInstall ? (
                    <Button onClick={handleInstall}>
                      {isUpdateAvailable ? (
                        <>
                          <ArrowUpCircle className="size-4" />
                          Update
                        </>
                      ) : (
                        <>
                          <Download className="size-4" />
                          {compatibility.isGuided ? 'Download' : 'Install'}
                        </>
                      )}
                    </Button>
                  ) : (
                    <span className="rounded-lg border border-white/10 px-3 py-2 text-[12px] text-slate-500">
                      {releaseCheckPending
                        ? 'Checking release assets…'
                        : compatibility.disabledActionLabel}
                    </span>
                  )}

                  <Button variant="outline" onClick={() => void openExternal(sourcePage)}>
                    <ExternalLink className="size-4" />
                    View source page
                  </Button>
                </div>
              </div>

              <p className="mt-4 text-sm leading-7 text-slate-300">{plugin.longDescription}</p>

              <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Installation availability
                </p>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  {releaseCheckPending
                    ? `Checking the latest release assets for ${currentPlatform}.`
                    : compatibility.reason}
                </p>
                {isScriptEntry ? (
                  <div className="mt-3 text-sm leading-7 text-slate-300">
                    <p>Scripts are copied into the OBS scripts directory.</p>
                    <p>
                      After install: open OBS, go to <strong>Tools → Scripts</strong>, click{' '}
                      <strong>+</strong>, and select the installed file.
                    </p>
                    {installedPlugin?.downloadPath ? (
                      <CopyPathField
                        className="mt-2"
                        value={installedPlugin.downloadPath}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>

              {(alternatePackages.length > 0 || githubAssets.length > 1) && canInstall ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {alternatePackages.map((candidate) => (
                    <Button
                      key={candidate.id}
                      variant="secondary"
                      onClick={() =>
                        void installPlugin(plugin.id, {
                          overwrite: Boolean(installedPlugin),
                          packageId: candidate.id,
                        })
                      }
                    >
                      <Download className="size-4" />
                      {candidate.label}
                    </Button>
                  ))}
                  {githubAssets.length > 1 ? (
                    <Button
                      variant="secondary"
                      onClick={() => setShowAdvancedAssets((value) => !value)}
                    >
                      <ChevronDown className="size-4" />
                      Choose another release asset
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <h2 className="text-[18px] font-semibold text-white">Details</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Platforms</dt>
                <dd className="text-right text-slate-300">
                  {formatSupportedPlatforms(plugin.supportedPlatforms)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">OBS support</dt>
                <dd className="text-right text-slate-300">{plugin.supportedOBSVersions}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Type</dt>
                <dd className="text-right text-slate-300">
                  {pluginTypeLabel}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Updated</dt>
                <dd className="text-right text-slate-300">{formatDisplayDate(plugin.lastUpdated)}</dd>
              </div>
              {installedPlugin?.managed ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Installed</dt>
                  <dd className="text-right text-slate-300">
                    {formatDisplayDate(installedPlugin.installedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          {hasGitHubReleaseSource(plugin) ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <h2 className="text-[18px] font-semibold text-white">Release Assets</h2>
              {isReleaseLoading ? (
                <p className="mt-3 text-sm text-slate-400">
                  Checking the latest release assets for this OS.
                </p>
              ) : releaseError ? (
                <p className="mt-3 text-sm text-amber-200">{releaseError}</p>
              ) : githubRelease ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-sm font-semibold text-white">
                      {githubRelease.releaseName}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {githubRelease.tagName}
                      {githubRelease.publishedAt
                        ? ` • ${formatDisplayDate(githubRelease.publishedAt)}`
                        : ''}
                    </p>
                  </div>

                  {githubAssets.length > 0 ? (
                    <div className="space-y-2">
                      {githubAssets
                        .slice(0, showAdvancedAssets ? githubAssets.length : 1)
                        .map((asset) => (
                          <button
                            className={[
                              'w-full rounded-lg border p-3 text-left transition-colors',
                              selectedGitHubAsset?.name === asset.name
                                ? 'border-primary/30 bg-primary/10'
                                : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
                            ].join(' ')}
                            key={asset.name}
                            onClick={() => setSelectedGitHubAssetName(asset.name)}
                            type="button"
                          >
                            <p className="break-all text-sm font-semibold text-white">
                              {asset.name}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">{asset.reason}</p>
                          </button>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">
                      No installable asset was found for this OS in the latest release.
                    </p>
                  )}

                  {githubAssets.length > 1 ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowAdvancedAssets((value) => !value)}
                    >
                      {showAdvancedAssets ? 'Show fewer assets' : 'Show all matched assets'}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">
                  Release metadata is available, but no asset summary was loaded.
                </p>
              )}
            </div>
          ) : null}
        </aside>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-[18px] font-semibold text-white">Screenshots</h2>
          {plugin.screenshots.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              No screenshots are included in the local catalog for this resource yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {plugin.screenshots.map((screenshot) => (
                <div
                  className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]"
                  key={screenshot}
                >
                  <img
                    alt={`${plugin.name} screenshot`}
                    className="aspect-video h-full w-full object-cover"
                    src={screenshot}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <h2 className="text-[18px] font-semibold text-white">Install Notes</h2>
          <div className="mt-4 space-y-3">
            {plugin.installNotes.map((note) => (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3" key={note}>
                <p className="text-sm leading-7 text-slate-300">{note}</p>
              </div>
            ))}
            {githubRepoUrl ? (
              <Button
                className="w-full justify-center"
                variant="outline"
                onClick={() => void openExternal(githubRepoUrl)}
              >
                <ExternalLink className="size-4" />
                Open repository
              </Button>
            ) : null}
          </div>
        </aside>
      </section>
    </div>
  )
}
