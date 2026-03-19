import type { ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpCircle, ShieldCheck } from 'lucide-react'

import { PluginGlyph } from '../lib/pluginVisuals'
import {
  cn,
  formatSupportedPlatforms,
  getCatalogPluginState,
  getPluginCompatibility,
  getInstallMethod,
  getInstallOwnershipLabel,
  getPluginTypeLabel,
  getRecommendedPackage,
  hasGitHubReleaseSource,
} from '../lib/utils'
import type { InstalledPluginRecord } from '../types/desktop'
import type { PluginCatalogEntry } from '../types/plugin'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'

type CatalogViewMode = 'list' | 'grid'
type MetadataTag = {
  label: string
  tone: 'neutral' | 'script' | 'verified'
  icon: ReactNode
}

interface PluginCardProps {
  plugin: PluginCatalogEntry
  currentPlatform: string
  installedPlugin?: InstalledPluginRecord
  viewMode: CatalogViewMode
  onSelect: (pluginId: string) => void
  onInstall: (
    pluginId: string,
    options?: { overwrite?: boolean; packageId?: string | null },
  ) => void
}

function ActionControl({
  compatibilityLabel,
  installOwnershipLabel,
  isInstallerBased,
  isInstalledExternal,
  isInstalledManaged,
  isUnavailable,
  isUpdateAvailable,
  actionLabel,
  onInstall,
  viewMode,
}: {
  compatibilityLabel: string
  installOwnershipLabel: string
  isInstallerBased: boolean
  isInstalledExternal: boolean
  isInstalledManaged: boolean
  isUnavailable: boolean
  isUpdateAvailable: boolean
  actionLabel: string
  onInstall: () => void
  viewMode: CatalogViewMode
}) {
  if (isInstalledManaged && !isInstallerBased && !isUpdateAvailable) {
    return (
      <Badge
        className={cn(
          'justify-center',
          viewMode === 'grid' ? 'w-full px-3 py-2 text-[12px]' : 'px-3 py-2 text-[12px]',
        )}
        tone="success"
      >
        {isInstallerBased ? 'Installer used' : 'Installed'}
      </Badge>
    )
  }

  if (isInstalledExternal) {
    return (
      <Badge
        className={cn(
          'justify-center',
          viewMode === 'grid' ? 'w-full px-3 py-2 text-[12px]' : 'px-3 py-2 text-[12px]',
        )}
        tone="warning"
      >
        {installOwnershipLabel}
      </Badge>
    )
  }

  if (isUnavailable) {
    return (
      <Badge
        className={cn(
          'px-3 py-2 text-center text-[12px]',
          viewMode === 'grid' ? 'block w-full' : 'inline-flex items-center justify-center',
        )}
        tone="warning"
      >
        {compatibilityLabel}
      </Badge>
    )
  }

  return (
    <Button
      className={viewMode === 'grid' ? 'w-full justify-center' : undefined}
      size="sm"
      variant={isUpdateAvailable ? 'primary' : 'action'}
      onClick={onInstall}
    >
      {isUpdateAvailable ? (
        <>
          <ArrowUpCircle className="size-4" />
          Update
        </>
      ) : (
        <>
          <ArrowDownToLine className="size-4" />
          {actionLabel}
        </>
      )}
    </Button>
  )
}

export function PluginCard({
  currentPlatform,
  installedPlugin,
  onInstall,
  onSelect,
  plugin,
  viewMode,
}: PluginCardProps) {
  const pluginState = getCatalogPluginState(plugin, installedPlugin)
  const compatibility = getPluginCompatibility(plugin, currentPlatform)
  const recommendedPackage = getRecommendedPackage(plugin, currentPlatform)
  const pluginTypeLabel = getPluginTypeLabel(plugin, installedPlugin)
  const installMethod = getInstallMethod(installedPlugin)
  const isUnavailable = !compatibility.canInstall
  const isInstalledManaged = pluginState === 'installed' && installMethod !== 'external'
  const isInstallerBased = installMethod === 'installer'
  const isInstalledExternal = pluginState === 'installed-externally'
  const isUpdateAvailable = pluginState === 'update-available'
  const actionLabel =
    isInstallerBased && isInstalledManaged && !isUpdateAvailable
      ? 'Re-install'
      : 'Install'
  const isAttachPending =
    installedPlugin?.status === 'manual-step' && installedPlugin.sourceType === 'script'
  const supportedPlatforms =
    plugin.supportedPlatforms.length > 0
      ? formatSupportedPlatforms(plugin.supportedPlatforms)
      : null
  const metadataItems = [plugin.author, `v${plugin.version}`, supportedPlatforms].filter(Boolean)
  const metadataTags: MetadataTag[] = []
  const seenMetadataTagLabels = new Set<string>()

  function pushMetadataTag(tag: MetadataTag | null) {
    if (!tag || seenMetadataTagLabels.has(tag.label)) {
      return
    }

    seenMetadataTagLabels.add(tag.label)
    metadataTags.push(tag)
  }

  pushMetadataTag(
    pluginTypeLabel === 'OBS Script'
      ? { label: 'OBS Script', tone: 'script', icon: null }
      : pluginTypeLabel !== 'OBS Plugin'
        ? { label: pluginTypeLabel, tone: 'neutral', icon: null }
        : plugin.category
          ? { label: plugin.category, tone: 'neutral', icon: null }
          : null,
  )

  pushMetadataTag(
    plugin.verified
      ? {
          label: 'Verified',
          tone: 'verified',
          icon: <ShieldCheck className="size-3.5" />,
        }
      : null,
  )

  const handleInstall = () =>
    onInstall(plugin.id, {
      overwrite: Boolean(installedPlugin),
      packageId: hasGitHubReleaseSource(plugin)
        ? null
        : recommendedPackage?.id ?? null,
    })

  if (viewMode === 'grid') {
    return (
      <article
        className={cn(
          'catalog-card flex h-full min-h-[232px] cursor-pointer flex-col rounded-xl border p-4 transition-colors',
          isUnavailable ? 'catalog-card-muted opacity-70' : '',
        )}
        onClick={() => onSelect(plugin.id)}
      >
        <div className="flex items-start gap-3">
          <div className="catalog-card-icon flex size-10 shrink-0 items-center justify-center rounded-lg border text-primary">
            {plugin.iconUrl ? (
              <img
                alt={`${plugin.name} icon`}
                className="size-full rounded-lg object-cover"
                loading="lazy"
                src={plugin.iconUrl}
              />
            ) : (
              <PluginGlyph className="size-5" iconKey={plugin.iconKey} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[16px] font-semibold text-white">{plugin.name}</h3>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-slate-300">
          {plugin.description}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
          {metadataItems.map((item, index) => (
            <div className="contents" key={item}>
              {index > 0 ? <span>•</span> : null}
              <span className="truncate">{item}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex min-h-[48px] flex-wrap content-start gap-2">
          {metadataTags.map((tag) => (
            <Badge key={tag.label} tone={tag.tone}>
              {tag.icon}
              {tag.label}
            </Badge>
          ))}
          {isAttachPending ? <Badge tone="warning">Needs OBS attach</Badge> : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <span className="truncate text-[12px] text-slate-500">
            {isInstalledExternal
              ? 'Detected in OBS folders'
              : isInstallerBased && isInstalledManaged
                ? getInstallOwnershipLabel(installedPlugin)
                : isUpdateAvailable
                  ? 'Update ready'
                  : isInstalledManaged
                    ? getInstallOwnershipLabel(installedPlugin)
                    : compatibility.label}
          </span>
          <div className="w-[132px] shrink-0">
            <ActionControl
              compatibilityLabel={compatibility.disabledActionLabel || 'Unsupported'}
              installOwnershipLabel={getInstallOwnershipLabel(installedPlugin)}
              isInstallerBased={isInstallerBased}
              isInstalledExternal={isInstalledExternal}
              isInstalledManaged={isInstalledManaged}
              isUnavailable={isUnavailable}
              isUpdateAvailable={isUpdateAvailable}
              actionLabel={actionLabel}
              onInstall={handleInstall}
              viewMode="grid"
            />
          </div>
        </div>
      </article>
    )
  }

  return (
    <article
      className={cn(
        'catalog-card grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-xl border px-4 py-3 transition-colors',
        isUnavailable ? 'catalog-card-muted opacity-70' : '',
      )}
      onClick={() => onSelect(plugin.id)}
    >
      <div className="catalog-card-icon flex size-10 items-center justify-center rounded-lg border text-primary">
        {plugin.iconUrl ? (
          <img
            alt={`${plugin.name} icon`}
            className="size-full rounded-lg object-cover"
            loading="lazy"
            src={plugin.iconUrl}
          />
        ) : (
          <PluginGlyph className="size-5" iconKey={plugin.iconKey} />
        )}
      </div>

      <div className="min-w-0">
        <h3 className="truncate text-[18px] font-semibold text-white">{plugin.name}</h3>
        <p className="mt-1 text-[14px] text-slate-300">{plugin.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
          {metadataItems.map((item, index) => (
            <div className="contents" key={item}>
              {index > 0 ? <span>•</span> : null}
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {metadataTags.map((tag) => (
            <Badge key={tag.label} tone={tag.tone}>
              {tag.icon}
              {tag.label}
            </Badge>
          ))}
          {isAttachPending ? <Badge tone="warning">Needs OBS attach</Badge> : null}
          {isInstallerBased ? <Badge tone="neutral">Installer-based</Badge> : null}
        </div>
      </div>

      <div className="flex min-w-[168px] justify-end">
        <ActionControl
          compatibilityLabel={compatibility.disabledActionLabel || 'Unsupported'}
          installOwnershipLabel={getInstallOwnershipLabel(installedPlugin)}
          isInstallerBased={isInstallerBased}
          isInstalledExternal={isInstalledExternal}
          isInstalledManaged={isInstalledManaged}
          isUnavailable={isUnavailable}
          isUpdateAvailable={isUpdateAvailable}
          actionLabel={actionLabel}
          onInstall={handleInstall}
          viewMode="list"
        />
      </div>
    </article>
  )
}
