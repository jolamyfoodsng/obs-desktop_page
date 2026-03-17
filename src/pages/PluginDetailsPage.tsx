import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpCircle,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react'
import { useParams } from 'react-router-dom'

import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { CopyPathField } from '../components/ui/CopyPathField'
import { getPluginAnalyticsProperties, trackEvent } from '../lib/analytics'
import { getErrorMessage } from '../lib/errors'
import { PluginGlyph } from '../lib/pluginVisuals'
import { desktopApi } from '../lib/tauri'
import {
  formatDisplayDate,
  formatSupportedPlatforms,
  getCatalogPluginState,
  getGitHubReleasesUrl,
  getGitHubRepoUrl,
  getInstallMethod,
  getInstallOwnershipLabel,
  getPlatformPackages,
  getPluginCompatibility,
  getPluginTypeLabel,
  getRecommendedPackage,
  hasGitHubReleaseSource,
  isScriptPlugin,
  resolvePrimaryEntryFiles,
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
  const recentHistory = (bootstrap?.installHistory ?? [])
    .filter((entry) => entry.pluginId === pluginId)
    .slice(-3)
    .reverse()
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
  const trackedPluginViewRef = useRef<string | null>(null)

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

  const pluginState = plugin ? getCatalogPluginState(plugin, installedPlugin) : 'install'
  const compatibility = plugin
    ? getPluginCompatibility(plugin, currentPlatform, {
        releaseInfo: githubRelease,
      })
    : {
        label: 'Unavailable',
        tone: 'neutral' as const,
        canInstall: false,
        isGuided: false,
        reason: '',
        disabledActionLabel: 'Unavailable',
        canViewSource: false,
        requiresReleaseCheck: false,
      }

  useEffect(() => {
    if (!plugin) {
      return
    }

    if (trackedPluginViewRef.current === plugin.id) {
      return
    }

    trackedPluginViewRef.current = plugin.id
    trackEvent(
      'plugin_view',
      getPluginAnalyticsProperties(plugin, bootstrap, installedPlugin, {
        compatibility: compatibility.label,
        pluginState,
      }),
    )
  }, [bootstrap, compatibility.label, installedPlugin, plugin, pluginState])

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
  const hasManualAssetSelection =
    Boolean(selectedGitHubAssetName) &&
    selectedGitHubAsset?.name !== githubRelease?.selectedAsset?.name
  const isScriptEntry = isScriptPlugin(plugin, installedPlugin, selectedGitHubAsset?.name)
  const pluginTypeLabel = getPluginTypeLabel(plugin, installedPlugin, selectedGitHubAsset?.name)
  const resolvedEntryFiles = resolvePrimaryEntryFiles(plugin, installedPlugin)
  const releaseCheckPending =
    isReleaseLoading &&
    !recommendedPackage &&
    !activePlugin.installStrategy &&
    hasGitHubReleaseSource(activePlugin)
  const canInstall = compatibility.canInstall && !releaseCheckPending
  const installMethod = getInstallMethod(installedPlugin)
  const isInstalledManaged = pluginState === 'installed' && installMethod !== 'external'
  const isInstalledExternal = pluginState === 'installed-externally'
  const isInstallerInstall = installMethod === 'installer'
  const isUpdateAvailable = pluginState === 'update-available'
  const shouldShowInstallerAction =
    canInstall && isInstallerInstall && isInstalledManaged && !isUpdateAvailable
  const sourcePage =
    activePlugin.sourceUrl ??
    activePlugin.manualInstallUrl ??
    githubReleasesUrl ??
    activePlugin.homepageUrl
  const githubAuthorProfile = activePlugin.githubRepo
    ? `https://github.com/${activePlugin.githubRepo.split('/')[0]}`
    : null
  const authorProfileUrl = githubAuthorProfile ?? activePlugin.homepageUrl

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
                      {pluginTypeLabel === 'OBS Plugin' ? plugin.category : pluginTypeLabel}
                    </Badge>
                    <Badge tone={compatibility.tone}>{compatibility.label}</Badge>
                    {plugin.verified ? (
                      <Badge tone="verified">
                        <ShieldCheck className="size-3.5" />
                        Verified
                      </Badge>
                    ) : null}
                    {isInstalledManaged ? (
                      <Badge tone={isInstallerInstall ? 'neutral' : 'success'}>
                        {getInstallOwnershipLabel(installedPlugin)}
                      </Badge>
                    ) : null}
                    {isInstalledExternal ? (
                      <Badge tone="warning">Installed externally</Badge>
                    ) : null}
                    {isUpdateAvailable ? <Badge tone="warning">Update available</Badge> : null}
                    {installedPlugin?.verificationStatus === 'verified' ? (
                      <Badge tone="success">Verified files</Badge>
                    ) : null}
                    {installedPlugin?.verificationStatus === 'missing-files' ? (
                      <Badge tone="danger">Verification failed</Badge>
                    ) : null}
                    {installedPlugin?.backup ? (
                      <Badge tone="neutral">Rollback snapshot</Badge>
                    ) : null}
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
                  ) : shouldShowInstallerAction ? (
                    <Button onClick={handleInstall}>
                      <Download className="size-4" />
                      Download again
                    </Button>
                  ) : isInstalledManaged ? (
                    <Badge
                      className="px-3 py-2 text-[12px]"
                      tone={isInstallerInstall ? 'neutral' : 'success'}
                    >
                      {getInstallOwnershipLabel(installedPlugin)}
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
                {selectedGitHubAsset ? (
                  <div className="mt-3 rounded-lg border border-primary/30 bg-primary/10 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="success">Selected installer</Badge>
                      {hasManualAssetSelection ? (
                        <Badge tone="neutral">Manual override</Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 break-all text-sm font-semibold text-white">
                      {selectedGitHubAsset.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">{selectedGitHubAsset.reason}</p>
                    <p className="mt-2 text-xs text-primary/90">
                      This installer will be used for download/install.
                    </p>
                  </div>
                ) : null}
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
                {installedPlugin?.backup ? (
                  <p className="mt-3 text-sm leading-7 text-slate-300">
                    This managed install kept a rollback snapshot before overwriting existing files.
                  </p>
                ) : null}
              </div>

              {plugin.installInstructions?.length ? (
                <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Standardized install instructions
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-300">
                    {plugin.installInstructions.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {plugin.obsFollowupSteps?.length ? (
                <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-500/10 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                    OBS follow-up steps
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-100">
                    {plugin.obsFollowupSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {resolvedEntryFiles.length ? (
                <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Installed entry files
                  </p>
                  <div className="mt-3 space-y-3">
                    {resolvedEntryFiles.map((entry) => (
                      <div key={entry.role} className="space-y-2">
                        <p className="text-sm text-slate-300">{entry.label}</p>
                        <CopyPathField value={entry.absolutePath} />
                        <CopyPathField value={entry.fileUrl} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

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
              {installedPlugin ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Install status</dt>
                  <dd className="text-right text-slate-300">
                    {getInstallOwnershipLabel(installedPlugin)}
                  </dd>
                </div>
              ) : null}
              {installedPlugin?.lastVerifiedAt ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Last verified</dt>
                  <dd className="text-right text-slate-300">
                    {formatDisplayDate(installedPlugin.lastVerifiedAt)}
                  </dd>
                </div>
              ) : null}
              {installedPlugin?.backup ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Rollback snapshot</dt>
                  <dd className="text-right text-slate-300">Available</dd>
                </div>
              ) : null}
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
              {installMethod !== 'external' && installedPlugin ? (
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
                        .map((asset) => {
                          const isSelected = selectedGitHubAsset?.name === asset.name

                          return (
                            <button
                              className={[
                                'w-full cursor-pointer rounded-lg border p-3 text-left transition-all duration-150',
                                isSelected
                                  ? 'border-primary/70 bg-primary/12 shadow-[0_0_0_1px_rgba(34,197,94,0.22)]'
                                  : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]',
                              ].join(' ')}
                              key={asset.name}
                              onClick={() => setSelectedGitHubAssetName(asset.name)}
                              type="button"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="break-all text-sm font-semibold text-white">{asset.name}</p>
                                {isSelected ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/20 px-2 py-0.5 text-[11px] font-medium text-primary">
                                    <Check className="size-3" />
                                    Selected
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 text-xs text-slate-400">{asset.reason}</p>
                            </button>
                          )
                        })}
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

                  {selectedGitHubAsset ? (
                    <p className="rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-primary/90">
                      Using {selectedGitHubAsset.name}
                    </p>
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

            <button
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.06]"
              onClick={() => void openExternal(authorProfileUrl)}
              type="button"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Author profile
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{plugin.author}</p>
                  <p className="mt-1 text-xs text-slate-400">View author page</p>
                </div>
                <ExternalLink className="size-4 text-slate-300" />
              </div>
            </button>
          </div>

          {recentHistory.length > 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <h2 className="text-[18px] font-semibold text-white">Recent activity</h2>
              <div className="mt-4 space-y-3">
                {recentHistory.map((entry) => (
                  <div
                    className="rounded-lg border border-white/8 bg-white/[0.03] p-3"
                    key={`${entry.timestamp}-${entry.action}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge tone={entry.managed ? 'success' : 'neutral'}>
                        {entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {formatDisplayDate(entry.timestamp)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{entry.message}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </section>
    </div>
  )
}
