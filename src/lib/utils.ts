import clsx from 'clsx'
import semver from 'semver'

import type { GitHubReleaseInfo, InstalledPluginRecord } from '../types/desktop'
import type {
  PluginCatalogEntry,
  PluginPackage,
  SupportedPlatform,
} from '../types/plugin'

export function cn(...inputs: Array<string | false | null | undefined>) {
  return clsx(inputs)
}

export function compareVersions(leftVersion: string, rightVersion: string) {
  const left = semver.coerce(leftVersion)
  const right = semver.coerce(rightVersion)

  if (!left && !right) {
    return 0
  }

  if (!left) {
    return -1
  }

  if (!right) {
    return 1
  }

  return semver.compare(left, right)
}

export function isUpdateAvailable(
  installedVersion: string,
  catalogVersion: string,
) {
  return compareVersions(installedVersion, catalogVersion) < 0
}

export function formatDisplayDate(isoDate: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(isoDate))
}

export function platformLabel(platform: string) {
  switch (platform) {
    case 'windows':
      return 'Windows'
    case 'macos':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

export function formatSupportedPlatforms(platforms: string[]) {
  if (platforms.length === 0) {
    return 'Platform info unavailable'
  }

  return platforms.map(platformLabel).join(', ')
}

export function getPluginTypeLabel(
  plugin?: PluginCatalogEntry | null,
  installedPlugin?: Pick<InstalledPluginRecord, 'sourceType'> | null,
  assetName?: string | null,
) {
  return isScriptPlugin(plugin, installedPlugin, assetName) ? 'OBS Script' : 'OBS Plugin'
}

export function normalizePlatform(platform: string): SupportedPlatform {
  if (platform === 'macos' || platform === 'linux' || platform === 'windows') {
    return platform
  }

  if (platform === 'darwin') {
    return 'macos'
  }

  return 'linux'
}

export function getRecommendedPackage(
  plugin: PluginCatalogEntry,
  platform: string,
): PluginPackage | undefined {
  const normalizedPlatform = normalizePlatform(platform)
  return (
    plugin.packages.find(
      (candidate) => candidate.os === normalizedPlatform && candidate.recommended,
    ) ?? plugin.packages.find((candidate) => candidate.os === normalizedPlatform)
  )
}

export function getPlatformPackages(
  plugin: PluginCatalogEntry,
  platform: string,
): PluginPackage[] {
  const normalizedPlatform = normalizePlatform(platform)
  return plugin.packages.filter((candidate) => candidate.os === normalizedPlatform)
}

function isGitHubUrl(url?: string | null) {
  return Boolean(url && url.includes('github.com'))
}

export function getGitHubRepoUrl(plugin: PluginCatalogEntry) {
  if (plugin.githubRepo) {
    return `https://github.com/${plugin.githubRepo}`
  }

  const candidates = [plugin.sourceUrl, plugin.githubReleaseUrl, plugin.homepageUrl, plugin.manualInstallUrl]
  return candidates.find((url) => isGitHubUrl(url) && !url?.includes('/releases')) ?? null
}

export function getGitHubReleasesUrl(plugin: PluginCatalogEntry) {
  if (plugin.githubReleaseUrl) {
    return plugin.githubReleaseUrl
  }

  const repoUrl = getGitHubRepoUrl(plugin)
  if (repoUrl) {
    return `${repoUrl.replace(/\/$/, '')}/releases`
  }

  const candidates = [plugin.sourceUrl, plugin.homepageUrl, plugin.manualInstallUrl]
  return candidates.find((url) => isGitHubUrl(url) && url?.includes('/releases')) ?? null
}

export function hasGitHubReleaseSource(plugin: PluginCatalogEntry) {
  return Boolean(getGitHubRepoUrl(plugin) || getGitHubReleasesUrl(plugin))
}

export function canAttemptManagedInstall(plugin: PluginCatalogEntry) {
  return Boolean(
    plugin.manualInstallUrl ||
      plugin.packages.length > 0 ||
      hasGitHubReleaseSource(plugin) ||
      plugin.installStrategy ||
      isScriptPlugin(plugin),
  )
}

export type CatalogPluginState =
  | 'install'
  | 'installed'
  | 'update-available'
  | 'installed-externally'

export function isScriptAssetName(value?: string | null) {
  return Boolean(value && /\.(lua|py)$/i.test(value))
}

export function isScriptPlugin(
  plugin?: PluginCatalogEntry | null,
  installedPlugin?: Pick<InstalledPluginRecord, 'sourceType'> | null,
  assetName?: string | null,
) {
  if (installedPlugin?.sourceType === 'script') {
    return true
  }

  if (
    installedPlugin &&
    ['archive', 'external-installer', 'standalone-tool'].includes(
      installedPlugin.sourceType,
    )
  ) {
    return false
  }

  if (isScriptAssetName(assetName)) {
    return true
  }

  if (!plugin) {
    return false
  }

  const haystack = [
    plugin.category,
    plugin.tagline,
    plugin.description,
    plugin.longDescription,
    plugin.homepageUrl,
    plugin.sourceUrl,
    plugin.manualInstallUrl,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    plugin.category.toLowerCase() === 'scripts' ||
    /\b(lua|python)\s+script\b/.test(haystack) ||
    /\bobs\s+script\b/.test(haystack) ||
    /\bscript plugin\b/.test(haystack) ||
    /tools\s*(?:->|→)\s*scripts/.test(haystack)
  )
}

export function isExternallyInstalled(
  installedPlugin?: Pick<InstalledPluginRecord, 'managed'> | null,
) {
  return Boolean(installedPlugin && !installedPlugin.managed)
}

export function getCatalogPluginState(
  plugin: PluginCatalogEntry,
  installedPlugin?: InstalledPluginRecord | null,
): CatalogPluginState {
  if (!installedPlugin) {
    return 'install'
  }

  if (isExternallyInstalled(installedPlugin)) {
    return 'installed-externally'
  }

  if (isUpdateAvailable(installedPlugin.installedVersion, plugin.version)) {
    return 'update-available'
  }

  return 'installed'
}

function unsupportedActionLabel(
  plugin: PluginCatalogEntry,
  normalizedPlatform: SupportedPlatform,
) {
  if (
    plugin.supportedPlatforms.length === 1 &&
    plugin.supportedPlatforms[0] !== normalizedPlatform
  ) {
    return `${platformLabel(plugin.supportedPlatforms[0])}-only`
  }

  return `Not available for ${platformLabel(normalizedPlatform)}`
}

export interface PluginCompatibility {
  label: string
  tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger'
  canInstall: boolean
  isGuided: boolean
  reason: string
  disabledActionLabel: string
  canViewSource: boolean
  requiresReleaseCheck: boolean
}

export function getPluginCompatibility(
  plugin: PluginCatalogEntry,
  platform: string,
  options?: {
    releaseInfo?: GitHubReleaseInfo | null
  },
): PluginCompatibility {
  const normalizedPlatform = normalizePlatform(platform)
  const recommendedPackage = getRecommendedPackage(plugin, normalizedPlatform)
  const releaseAsset = options?.releaseInfo?.selectedAsset ?? null
  const metadataSupportsPlatform =
    plugin.supportedPlatforms.length === 0 ||
    plugin.supportedPlatforms.includes(normalizedPlatform)
  const hasRuntimeStrategy = Boolean(plugin.installStrategy) || isScriptPlugin(plugin)
  const hasReleaseSource = hasGitHubReleaseSource(plugin)

  if (!metadataSupportsPlatform) {
    return {
      label: unsupportedActionLabel(plugin, normalizedPlatform),
      tone: 'warning',
      canInstall: false,
      isGuided: false,
      reason: `${plugin.name} does not advertise ${platformLabel(normalizedPlatform)} support in the catalog metadata.`,
      disabledActionLabel: unsupportedActionLabel(plugin, normalizedPlatform),
      canViewSource: true,
      requiresReleaseCheck: false,
    }
  }

  if (recommendedPackage) {
    return {
      label:
        recommendedPackage.installType === 'archive'
          ? 'Ready to install'
          : 'Guided installer',
      tone: recommendedPackage.installType === 'archive' ? 'success' : 'warning',
      canInstall: true,
      isGuided: recommendedPackage.installType !== 'archive',
      reason:
        recommendedPackage.installType === 'archive'
          ? `A ${platformLabel(normalizedPlatform)} package is available for direct install.`
          : `A ${platformLabel(normalizedPlatform)} package is available, but it finishes through an external installer flow.`,
      disabledActionLabel: '',
      canViewSource: true,
      requiresReleaseCheck: false,
    }
  }

  if (releaseAsset) {
    return {
      label:
        releaseAsset.installType === 'archive'
          ? 'GitHub release asset'
          : 'GitHub installer',
      tone: releaseAsset.installType === 'archive' ? 'success' : 'warning',
      canInstall: true,
      isGuided: releaseAsset.installType !== 'archive',
      reason: releaseAsset.reason,
      disabledActionLabel: '',
      canViewSource: true,
      requiresReleaseCheck: false,
    }
  }

  if (hasRuntimeStrategy) {
    return {
      label: isScriptPlugin(plugin) ? 'OBS Script' : 'Managed resource import',
      tone: plugin.guideOnly ? 'warning' : 'neutral',
      canInstall: true,
      isGuided: plugin.guideOnly,
      reason: isScriptPlugin(plugin)
        ? `This resource installs as an OBS script on ${platformLabel(normalizedPlatform)}.`
        : `This resource has a managed install strategy for ${platformLabel(normalizedPlatform)}.`,
      disabledActionLabel: '',
      canViewSource: true,
      requiresReleaseCheck: false,
    }
  }

  if (hasReleaseSource) {
    if (options?.releaseInfo) {
      return {
        label: unsupportedActionLabel(plugin, normalizedPlatform),
        tone: 'warning',
        canInstall: false,
        isGuided: false,
        reason: `The latest release does not expose an installable ${platformLabel(normalizedPlatform)} asset.`,
        disabledActionLabel: unsupportedActionLabel(plugin, normalizedPlatform),
        canViewSource: true,
        requiresReleaseCheck: false,
      }
    }

    return {
      label: 'Needs asset check',
      tone: 'neutral',
      canInstall: false,
      isGuided: false,
      reason: `Open the details page to inspect the latest release assets for ${platformLabel(normalizedPlatform)}.`,
      disabledActionLabel: 'Needs asset check',
      canViewSource: true,
      requiresReleaseCheck: true,
    }
  }

  return {
    label: unsupportedActionLabel(plugin, normalizedPlatform),
    tone: 'warning',
    canInstall: false,
    isGuided: false,
    reason: `No ${platformLabel(normalizedPlatform)} package or install strategy is available for this resource.`,
    disabledActionLabel: unsupportedActionLabel(plugin, normalizedPlatform),
    canViewSource: true,
    requiresReleaseCheck: false,
  }
}
