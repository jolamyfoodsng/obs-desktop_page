import clsx from 'clsx'
import semver from 'semver'

import { APP_NAME } from './branding'
import type {
  GitHubReleaseInfo,
  InstallMethod,
  InstalledPluginRecord,
} from '../types/desktop'
import type {
  PluginCatalogEntry,
  PluginPrimaryEntryFile,
  PluginPackage,
  ResourceInstallType,
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

export function toFileUrlPath(absolutePath: string) {
  const normalized = absolutePath.replace(/\\/g, '/')
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`
  return encodeURI(`file://${prefixed}`)
}

export function resolvePrimaryEntryFiles(
  plugin?: PluginCatalogEntry | null,
  installedPlugin?: Pick<InstalledPluginRecord, 'installLocation'> | null,
) {
  if (!plugin || !installedPlugin?.installLocation || !plugin.primaryEntryFiles?.length) {
    return [] as Array<PluginPrimaryEntryFile & { absolutePath: string; fileUrl: string }>
  }

  const basePath = installedPlugin.installLocation.replace(/[\\/]+$/, '')

  return plugin.primaryEntryFiles.map((entry) => {
    const relativePath = entry.relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/')
    const absolutePath = `${basePath}/${relativePath}`.replace(/\/+/g, '/')

    return {
      ...entry,
      absolutePath,
      fileUrl: toFileUrlPath(absolutePath),
    }
  })
}

export interface InstalledLocationEntry {
  id: string
  label: string
  path: string
  openLabel: string
  description?: string | null
  isPrimary?: boolean
}

export type InstalledThemeLayout = 'modern' | 'legacy-qss' | 'unknown'

function normalizeRelativeInstallPath(value: string) {
  return value.replace(/^[/\\]+/, '').replace(/\\/g, '/').replace(/\/+/g, '/')
}

function splitRelativeInstallPath(value: string) {
  return normalizeRelativeInstallPath(value).split('/').filter(Boolean)
}

function joinInstallPath(basePath: string, ...segments: string[]) {
  const separator = basePath.includes('\\') ? '\\' : '/'
  const sanitizedBase = basePath.replace(/[\\/]+$/, '')
  const sanitizedSegments = segments
    .map((segment) =>
      segment
        .replace(/^[/\\]+|[/\\]+$/g, '')
        .replace(/[\\/]+/g, separator),
    )
    .filter(Boolean)

  return [sanitizedBase, ...sanitizedSegments].filter(Boolean).join(separator)
}

function normalizePathForComparison(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase()
}

function dedupeInstalledLocationEntries(entries: InstalledLocationEntry[]) {
  const seen = new Set<string>()

  return entries.filter((entry) => {
    const key = `${entry.label}:${normalizePathForComparison(entry.path)}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function detectModuleRootSegment(
  plugin: PluginCatalogEntry,
  installedPlugin: Pick<InstalledPluginRecord, 'installedFiles'>,
) {
  const normalizedCandidates = new Set(
    [plugin.moduleName, ...(plugin.installStrategy?.moduleNameAliases ?? [])]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )

  for (const relativePath of installedPlugin.installedFiles) {
    const [firstSegment, secondSegment] = splitRelativeInstallPath(relativePath)
    if (!firstSegment) {
      continue
    }

    if (normalizedCandidates.has(firstSegment.toLowerCase())) {
      return firstSegment
    }

    if (secondSegment === 'bin' || secondSegment === 'data') {
      return firstSegment
    }
  }

  return splitRelativeInstallPath(installedPlugin.installedFiles[0] ?? '')[0] ?? null
}

export function getInstalledThemeLayout(
  installedPlugin?: Pick<InstalledPluginRecord, 'installedFiles'> | null,
): InstalledThemeLayout {
  const trackedFiles = installedPlugin?.installedFiles ?? []
  const hasModernDescriptor = trackedFiles.some((relativePath) =>
    /\.(obt|ovt)$/i.test(relativePath),
  )
  const hasLegacyStylesheet = trackedFiles.some((relativePath) => /\.qss$/i.test(relativePath))

  if (hasModernDescriptor) {
    return 'modern'
  }

  if (hasLegacyStylesheet) {
    return 'legacy-qss'
  }

  return 'unknown'
}

export function resolveInstalledLocationEntries(
  plugin?: PluginCatalogEntry | null,
  installedPlugin?:
    | Pick<
        InstalledPluginRecord,
        'downloadPath' | 'installLocation' | 'installedFiles' | 'sourceType'
      >
    | null,
) {
  if (!installedPlugin?.installLocation) {
    return [] as InstalledLocationEntry[]
  }

  if (isThemeResource(plugin)) {
    const themeLayout = getInstalledThemeLayout(installedPlugin)

    return [
      {
        id: 'theme-path',
        label: 'Theme path',
        path: installedPlugin.installLocation,
        openLabel: 'Open Theme Folder',
        description:
          themeLayout === 'legacy-qss'
            ? 'Installed as an OBS theme in your OBS themes directory. This package only includes a legacy .qss theme file.'
            : 'Installed as an OBS theme in your OBS themes directory.',
        isPrimary: true,
      },
    ]
  }

  if (installedPlugin.sourceType === 'script') {
    return [
      {
        id: 'scripts-path',
        label: 'Scripts path',
        path: installedPlugin.installLocation,
        openLabel: 'Open Scripts Folder',
        description: 'Installed into your OBS scripts directory.',
        isPrimary: true,
      },
    ]
  }

  if (installedPlugin.sourceType === 'standalone-tool') {
    return [
      {
        id: 'managed-tools-path',
        label: 'Managed tools path',
        path: installedPlugin.installLocation,
        openLabel: 'Open Tool Folder',
        description: `Managed by ${APP_NAME} in the desktop tools library.`,
        isPrimary: true,
      },
    ]
  }

  if (plugin && installedPlugin.sourceType === 'archive' && installedPlugin.installedFiles.length > 0) {
    const moduleRoot = detectModuleRootSegment(plugin, installedPlugin)
    const relativeFiles = installedPlugin.installedFiles.map(splitRelativeInstallPath)
    const entries: InstalledLocationEntry[] = []

    if (moduleRoot) {
      const hasPluginBinPath = relativeFiles.some(
        ([firstSegment, secondSegment]) =>
          firstSegment === moduleRoot && secondSegment === 'bin',
      )
      const hasPluginDataPath = relativeFiles.some(
        ([firstSegment, secondSegment]) =>
          firstSegment === moduleRoot && secondSegment === 'data',
      )
      const hasModuleRootFiles = relativeFiles.some(
        ([firstSegment, secondSegment]) =>
          firstSegment === moduleRoot && secondSegment && secondSegment !== 'bin' && secondSegment !== 'data',
      )

      if (hasPluginBinPath) {
        entries.push({
          id: 'plugin-binary-path',
          label: 'Plugin binary path',
          path: joinInstallPath(installedPlugin.installLocation, moduleRoot, 'bin'),
          openLabel: 'Open Plugin Folder',
          description: 'OBS loads the plugin binaries from this folder.',
          isPrimary: true,
        })
      }

      if (hasPluginDataPath) {
        entries.push({
          id: 'plugin-data-path',
          label: 'Data path',
          path: joinInstallPath(installedPlugin.installLocation, moduleRoot, 'data'),
          openLabel: 'Open Data Folder',
          description: 'Plugin resources and support files are installed here.',
        })
      }

      if (!hasPluginBinPath || hasModuleRootFiles) {
        entries.push({
          id: 'plugin-install-path',
          label: hasPluginBinPath ? 'Plugin root path' : 'Install path',
          path: joinInstallPath(installedPlugin.installLocation, moduleRoot),
          openLabel: 'Open Install Folder',
          description: hasPluginBinPath
            ? 'The managed plugin bundle lives under this root.'
            : 'Installed into your OBS plugin directory.',
          isPrimary: !hasPluginBinPath,
        })
      }
    }

    if (entries.length > 0) {
      return dedupeInstalledLocationEntries(entries)
    }
  }

  return [
    {
      id: 'install-path',
      label: 'Install path',
      path: installedPlugin.installLocation,
      openLabel: 'Open Install Folder',
      description:
        installedPlugin.sourceType === 'external-installer'
          ? `This install was completed outside ${APP_NAME}. This is the tracked folder for the installed resource.`
          : 'This is the tracked install location for the resource.',
      isPrimary: true,
    },
  ]
}

export function getPrimaryInstalledLocation(
  plugin?: PluginCatalogEntry | null,
  installedPlugin?:
    | Pick<
        InstalledPluginRecord,
        'downloadPath' | 'installLocation' | 'installedFiles' | 'sourceType'
      >
    | null,
) {
  const locations = resolveInstalledLocationEntries(plugin, installedPlugin)
  return locations.find((entry) => entry.isPrimary) ?? locations[0] ?? null
}

export function compactPathForDisplay(path: string, maxLength = 72) {
  if (path.length <= maxLength) {
    return path
  }

  const prefixLength = Math.max(18, Math.floor((maxLength - 1) / 2))
  const suffixLength = Math.max(18, maxLength - prefixLength - 1)

  return `${path.slice(0, prefixLength)}…${path.slice(-suffixLength)}`
}

export function getPluginTypeLabel(
  plugin?: PluginCatalogEntry | null,
  installedPlugin?: Pick<InstalledPluginRecord, 'sourceType'> | null,
  assetName?: string | null,
) {
  if (isScriptPlugin(plugin, installedPlugin, assetName)) {
    return 'OBS Script'
  }

  switch (resolveResourceInstallType(plugin)) {
    case 'dock_bundle':
      return 'Dock Extension'
    case 'browser_source_bundle':
      return 'Browser Widget'
    case 'theme_bundle':
      return 'OBS Theme'
    case 'zip_extract':
      return 'Tool Bundle'
    default:
      return 'OBS Plugin'
  }
}

export function resolveResourceInstallType(
  plugin?: PluginCatalogEntry | null,
): ResourceInstallType | null {
  const resourceInstallType = plugin?.resourceInstallType ?? null

  if (resourceInstallType && resourceInstallType !== 'manual_guide') {
    return resourceInstallType
  }

  if (plugin?.resourceType === 'theme') {
    return 'theme_bundle'
  }

  return resourceInstallType
}

export function isThemeResource(plugin?: PluginCatalogEntry | null) {
  return resolveResourceInstallType(plugin) === 'theme_bundle'
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

function isOfficialObsResourceUrl(url?: string | null) {
  return Boolean(url && /^https?:\/\/obsproject\.com\/forum\/resources\//i.test(url))
}

export function hasOfficialObsResourceSource(plugin: PluginCatalogEntry) {
  return [plugin.manualInstallUrl, plugin.officialObsUrl, plugin.homepageUrl].some(
    isOfficialObsResourceUrl,
  )
}

export function hasGitHubReleaseSource(plugin: PluginCatalogEntry) {
  return Boolean(getGitHubRepoUrl(plugin) || getGitHubReleasesUrl(plugin))
}

export function canAttemptManagedInstall(plugin: PluginCatalogEntry) {
  const resourceInstallType = resolveResourceInstallType(plugin)

  if (
    resourceInstallType &&
    resourceInstallType !== 'manual_guide' &&
    resourceInstallType !== 'external_installer'
  ) {
    return true
  }

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
    plugin.resourceInstallType === 'script_file' ||
    /\b(lua|python)\s+script\b/.test(haystack) ||
    /\bobs\s+script\b/.test(haystack) ||
    /\bscript plugin\b/.test(haystack) ||
    /tools\s*(?:->|→)\s*scripts/.test(haystack)
  )
}

export function isExternallyInstalled(
  installedPlugin?:
    | Pick<InstalledPluginRecord, 'managed' | 'sourceType' | 'installMethod'>
    | null,
) {
  return getInstallMethod(installedPlugin) === 'external'
}

export function getInstallMethod(
  installedPlugin?:
    | Pick<InstalledPluginRecord, 'managed' | 'sourceType' | 'installMethod'>
    | null,
): InstallMethod | null {
  if (!installedPlugin) {
    return null
  }

  if (installedPlugin.installMethod) {
    return installedPlugin.installMethod
  }

  if (installedPlugin.sourceType === 'external-installer') {
    return 'installer'
  }

  if (!installedPlugin.managed) {
    return 'external'
  }

  return 'managed'
}

export function getInstallOwnershipLabel(
  installedPlugin?:
    | Pick<InstalledPluginRecord, 'managed' | 'sourceType' | 'installMethod'>
    | null,
) {
  const installMethod = getInstallMethod(installedPlugin)

  switch (installMethod) {
    case 'managed':
      return `Installed by ${APP_NAME}`
    case 'installer':
      return 'Installed using external installer'
    case 'external':
      return 'Installed outside the app'
    default:
      return 'Not installed'
  }
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

function resourceInstallTypeLabel(resourceInstallType?: ResourceInstallType | null) {
  switch (resourceInstallType) {
    case 'native_plugin':
      return 'OBS plugin package'
    case 'script_file':
      return 'OBS Script'
    case 'external_installer':
      return 'Guided installer'
    case 'zip_extract':
      return 'Extracted bundle'
    case 'browser_source_bundle':
      return 'Browser source bundle'
    case 'dock_bundle':
      return 'Dock bundle'
    case 'theme_bundle':
      return 'OBS Theme'
    default:
      return 'Guide-only resource'
  }
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
  const hasOfficialResourceSource = hasOfficialObsResourceSource(plugin)
  const resourceInstallType = resolveResourceInstallType(plugin)

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
      label: resourceInstallTypeLabel(resourceInstallType),
      tone: plugin.guideOnly ? 'warning' : 'neutral',
      canInstall: true,
      isGuided: plugin.guideOnly,
      reason:
        resourceInstallType === 'dock_bundle'
          ? `This resource installs as a managed dock bundle on ${platformLabel(normalizedPlatform)} and then requires follow-up setup in OBS.`
          : resourceInstallType === 'browser_source_bundle'
            ? `This resource installs as a managed browser-source bundle on ${platformLabel(normalizedPlatform)} and then requires follow-up setup in OBS.`
            : resourceInstallType === 'theme_bundle'
              ? `This resource installs as a managed theme bundle on ${platformLabel(normalizedPlatform)}.`
              : resourceInstallType === 'zip_extract'
                ? `This resource installs by extracting its bundle into the managed tools library on ${platformLabel(normalizedPlatform)}.`
                : isScriptPlugin(plugin)
                ? `This resource installs as an OBS script on ${platformLabel(normalizedPlatform)}.`
                : `This resource has a managed install strategy for ${platformLabel(normalizedPlatform)}.`,
      disabledActionLabel: '',
      canViewSource: true,
      requiresReleaseCheck: false,
    }
  }

  if (hasOfficialResourceSource) {
    return {
      label:
        resourceInstallType && resourceInstallType !== 'manual_guide'
          ? resourceInstallTypeLabel(resourceInstallType)
          : 'Official OBS download',
      tone: 'neutral',
      canInstall: true,
      isGuided: false,
      reason:
        resourceInstallType && resourceInstallType !== 'manual_guide'
          ? resourceInstallType === 'theme_bundle'
            ? `${APP_NAME} can attempt the official OBS resource download and install it into your OBS theme folder on ${platformLabel(normalizedPlatform)}.`
            : `${APP_NAME} can attempt the official OBS resource download and handle it as a ${resourceInstallTypeLabel(resourceInstallType).toLowerCase()} on ${platformLabel(normalizedPlatform)}.`
          : `${APP_NAME} can attempt the official OBS resource download for ${platformLabel(normalizedPlatform)}.`,
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
