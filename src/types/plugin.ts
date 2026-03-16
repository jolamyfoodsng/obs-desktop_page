export type SupportedPlatform = 'windows' | 'macos' | 'linux'

export type PluginPackageInstallType = 'archive' | 'external' | 'guide'

export type PluginInstallStrategyKind = 'obs-plugin' | 'standalone-tool' | 'hybrid'

export interface PluginInstallStrategy {
  kind?: PluginInstallStrategyKind | null
  moduleNameAliases: string[]
  binaryNameHints: string[]
  resourceDirHints: string[]
}

export type PluginPackageFileType =
  | 'zip'
  | 'tar.gz'
  | 'tar.xz'
  | 'exe'
  | 'msi'
  | 'pkg'
  | 'dmg'
  | 'deb'
  | 'rpm'
  | 'appimage'
  | 'url'

export interface PluginPackage {
  id: string
  os: SupportedPlatform
  label: string
  fileType: PluginPackageFileType
  installType: PluginPackageInstallType
  downloadUrl: string
  recommended: boolean
  notes: string[]
}

export interface PluginCatalogEntry {
  id: string
  moduleName: string
  name: string
  tagline: string
  description: string
  longDescription: string
  author: string
  version: string
  supportedPlatforms: SupportedPlatform[]
  supportedOBSVersions: string
  minOBSVersion: string
  maxOBSVersion: string | null
  category: string
  homepageUrl: string
  sourceUrl?: string | null
  officialObsUrl?: string | null
  githubUrl?: string | null
  releaseUrl?: string | null
  githubRepo?: string | null
  githubReleaseUrl?: string | null
  githubReleaseTag?: string | null
  updatedAt?: string | null
  installType?: string | null
  fileType?: string | null
  resourceType?: 'plugin' | 'script' | 'tool' | 'theme' | 'overlay' | 'guide_only' | null
  verifiedSource?: string | null
  downloadCountRaw?: number | null
  githubStars?: number | null
  searchTags?: string[]
  preferredAssetPatterns?: string[]
  fallbackInstallType?: PluginPackageInstallType | null
  iconKey: string
  iconUrl?: string | null
  screenshots: string[]
  installNotes: string[]
  verified: boolean
  featured: boolean
  guideOnly: boolean
  manualInstallUrl?: string | null
  statusNote?: string | null
  lastUpdated: string
  downloadCount: string
  accentFrom: string
  accentTo: string
  installStrategy?: PluginInstallStrategy | null
  packages: PluginPackage[]
}
