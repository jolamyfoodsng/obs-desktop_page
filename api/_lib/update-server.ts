import type { VercelRequest, VercelResponse } from '@vercel/node'
import { coerce, compare, lt } from 'semver'

const GITHUB_API_BASE = 'https://api.github.com'
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=60'

const SUPPORTED_TARGETS = [
  {
    key: 'windows-x86_64-nsis',
    target: 'windows',
    arch: 'x86_64',
    bundleType: 'nsis',
    label: 'Windows x64',
    reasonLabel: 'Windows x64 NSIS',
  },
  {
    key: 'windows-x86_64-msi',
    target: 'windows',
    arch: 'x86_64',
    bundleType: 'msi',
    label: 'Windows x64',
    reasonLabel: 'Windows x64 MSI',
  },
  {
    key: 'windows-aarch64-nsis',
    target: 'windows',
    arch: 'aarch64',
    bundleType: 'nsis',
    label: 'Windows ARM64',
    reasonLabel: 'Windows ARM64 NSIS',
  },
  {
    key: 'windows-aarch64-msi',
    target: 'windows',
    arch: 'aarch64',
    bundleType: 'msi',
    label: 'Windows ARM64',
    reasonLabel: 'Windows ARM64 MSI',
  },
  {
    key: 'linux-x86_64-appimage',
    target: 'linux',
    arch: 'x86_64',
    bundleType: 'appimage',
    label: 'Linux x64',
    reasonLabel: 'Linux x64 AppImage',
  },
  {
    key: 'linux-x86_64-deb',
    target: 'linux',
    arch: 'x86_64',
    bundleType: 'deb',
    label: 'Linux x64',
    reasonLabel: 'Linux x64 DEB',
  },
  {
    key: 'linux-x86_64-rpm',
    target: 'linux',
    arch: 'x86_64',
    bundleType: 'rpm',
    label: 'Linux x64',
    reasonLabel: 'Linux x64 RPM',
  },
  {
    key: 'linux-aarch64-appimage',
    target: 'linux',
    arch: 'aarch64',
    bundleType: 'appimage',
    label: 'Linux ARM64',
    reasonLabel: 'Linux ARM64 AppImage',
  },
  {
    key: 'linux-aarch64-deb',
    target: 'linux',
    arch: 'aarch64',
    bundleType: 'deb',
    label: 'Linux ARM64',
    reasonLabel: 'Linux ARM64 DEB',
  },
  {
    key: 'linux-aarch64-rpm',
    target: 'linux',
    arch: 'aarch64',
    bundleType: 'rpm',
    label: 'Linux ARM64',
    reasonLabel: 'Linux ARM64 RPM',
  },
  {
    key: 'macos-x86_64-app',
    target: 'macos',
    arch: 'x86_64',
    bundleType: 'app',
    label: 'macOS x64',
    reasonLabel: 'macOS x64 app bundle',
  },
  {
    key: 'macos-aarch64-app',
    target: 'macos',
    arch: 'aarch64',
    bundleType: 'app',
    label: 'macOS ARM64',
    reasonLabel: 'macOS ARM64 app bundle',
  },
] as const

const SOURCE_ONLY_PATTERNS = [
  'source code',
  'source-code',
  'source_',
  '-src',
  '.src.',
  'symbols',
  'debugsymbols',
  'checksum',
  'checksums',
  'sha256',
  'sha512',
  'md5',
  '.blockmap',
]

const PLATFORM_TOKENS = {
  windows: ['windows', 'win32', 'win64', 'win', '.exe', '.msi', 'nsis'],
  linux: ['linux', '.appimage', '.deb', '.rpm'],
  macos: ['macos', 'mac', 'darwin', '.app.tar.gz', '.dmg', '.pkg', 'universal'],
} as const

const UPDATE_SELECTION_RULES = {
  nsis: {
    format: 'exe',
    label: 'Windows executable updater',
    requiresSignature: true,
  },
  msi: {
    format: 'msi',
    label: 'Windows MSI updater',
    requiresSignature: true,
  },
  appimage: {
    format: 'appimage',
    label: 'Linux AppImage updater',
    requiresSignature: true,
  },
  deb: {
    format: 'deb',
    label: 'Linux DEB updater',
    requiresSignature: true,
  },
  rpm: {
    format: 'rpm',
    label: 'Linux RPM updater',
    requiresSignature: true,
  },
  app: {
    format: 'app_tar_gz',
    label: 'macOS updater bundle',
    requiresSignature: true,
  },
} as const

const FORMAT_LABELS: Record<ReleaseAssetFormat, string> = {
  dmg: 'DMG installer',
  app_tar_gz: 'app.tar.gz updater bundle',
  exe: 'EXE installer',
  msi: 'MSI installer',
  appimage: 'AppImage',
  deb: 'DEB package',
  rpm: 'RPM package',
  sig: 'signature',
  zip: 'ZIP archive',
  tar_gz: 'tar.gz archive',
  other: 'file',
}

const RELEASE_ARCH_TOKENS = {
  x64: ['x86_64', 'amd64', 'x64', '64bit'],
  arm64: ['aarch64', 'arm64', 'arm64e'],
  universal: ['universal', 'universal2'],
} as const

const DUPLICATE_SUFFIX_EXTENSIONS = ['.app.tar.gz', '.tar.gz', '.tgz', '.appimage', '.deb', '.rpm', '.dmg', '.exe', '.msi', '.zip', '.sig']

type SupportedTarget = (typeof SUPPORTED_TARGETS)[number]

export type UpdateStatus =
  | 'no-update'
  | 'update-available'
  | 'update-required'
  | 'no-installable-asset'
  | 'source-only'
  | 'ambiguous'

interface GitHubReleaseAsset {
  id: number
  name: string
  size: number
  content_type?: string | null
  browser_download_url: string
  url: string
}

interface GitHubRelease {
  id: number
  tag_name: string
  name?: string | null
  body?: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
  published_at?: string | null
  assets: GitHubReleaseAsset[]
}

interface SelectedAssetCandidate {
  asset: GitHubReleaseAsset
  signatureAsset: GitHubReleaseAsset
  score: number
  reason: string
}

interface ManualFallbackCandidate {
  asset: GitHubReleaseAsset
  score: number
  reason: string
}

interface PlatformManifestEntry {
  target: string
  arch: string
  bundleType: string
  url: string
  signature: string
  fileName: string
  size: number
  reason: string
}

export interface SelectionResult {
  kind: 'selected' | 'missing' | 'source-only' | 'ambiguous'
  candidate?: SelectedAssetCandidate
  message?: string
}

export type ReleaseAssetOs = 'macos' | 'windows' | 'linux' | 'unknown'
export type ReleaseAssetArch = 'x64' | 'arm64' | 'universal' | 'unknown'
export type ReleaseAssetKind = 'updater_bundle' | 'installer' | 'signature' | 'archive' | 'source'
export type ReleaseAssetVersionState = 'match' | 'mismatch' | 'absent'
export type ReleaseAssetFormat =
  | 'dmg'
  | 'app_tar_gz'
  | 'exe'
  | 'msi'
  | 'appimage'
  | 'deb'
  | 'rpm'
  | 'sig'
  | 'zip'
  | 'tar_gz'
  | 'other'

export interface ClassifiedReleaseAsset {
  asset: GitHubReleaseAsset
  canonicalName: string
  os: ReleaseAssetOs
  arch: ReleaseAssetArch
  kind: ReleaseAssetKind
  format: ReleaseAssetFormat
  version: string | null
  versionState: ReleaseAssetVersionState
  signatureTargetName?: string
}

export interface ReleaseAssetCatalog {
  releaseVersion: string | null
  assets: ClassifiedReleaseAsset[]
  signatureAssetsByTargetName: Map<string, GitHubReleaseAsset[]>
}

export interface UpdateMetadataPayload {
  latestVersion: string
  minimumSupportedVersion: string
  releaseNotes: string
  publishedAt: string | null
  releaseTag: string
  releaseUrl: string
  channel: string
  platforms: Record<string, PlatformManifestEntry>
  status?: UpdateStatus
  message?: string
  currentVersion?: string
  selectedPlatform?: string
  selectedAssetName?: string
  selectedAssetReason?: string
  selectedAssetUrl?: string
  selectedAssetSize?: number
  manualFallbackName?: string
  manualFallbackReason?: string
  manualFallbackUrl?: string
  manualFallbackSize?: number
}

interface ResolveCatalogOptions {
  request: VercelRequest
  currentVersion?: string
  target?: string
  arch?: string
  bundleType?: string
  channel?: string
  releaseVersion?: string
}

const TARGET_ALIASES = {
  windows: 'windows',
  win32: 'windows',
  win64: 'windows',
  win: 'windows',
  linux: 'linux',
  macos: 'macos',
  mac: 'macos',
  darwin: 'macos',
  osx: 'macos',
} as const

const ARCH_ALIASES = {
  x86_64: 'x86_64',
  amd64: 'x86_64',
  x64: 'x86_64',
  'x86-64': 'x86_64',
  aarch64: 'aarch64',
  arm64: 'aarch64',
  arm64e: 'aarch64',
} as const

const BUNDLE_TYPE_ALIASES = {
  nsis: 'nsis',
  exe: 'nsis',
  msi: 'msi',
  appimage: 'appimage',
  deb: 'deb',
  rpm: 'rpm',
  app: 'app',
  'app.tar.gz': 'app',
  '.app.tar.gz': 'app',
} as const

function getEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Please set this in your .env.local (dev) or Vercel Environment Variables (prod).`,
    )
  }
  return value
}

function getOptionalEnv(name: string) {
  return process.env[name]?.trim() || null
}

function normalizeVersion(value: string | undefined | null) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  return coerce(trimmed)?.version ?? null
}

function readQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function isSourceOnlyAsset(fileName: string) {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.sig')) {
    return false
  }
  return SOURCE_ONLY_PATTERNS.some((pattern) => lower.includes(pattern))
}

function stripReleaseFrontmatter(body: string) {
  if (!body.startsWith('---\n')) {
    return body.trim()
  }

  const end = body.indexOf('\n---\n', 4)
  if (end === -1) {
    return body.trim()
  }

  return body.slice(end + 5).trim()
}

function parseReleaseFrontmatter(body: string) {
  if (!body.startsWith('---\n')) {
    return {}
  }

  const end = body.indexOf('\n---\n', 4)
  if (end === -1) {
    return {}
  }

  const frontmatter = body
    .slice(4, end)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return Object.fromEntries(
    frontmatter
      .map((line) => {
        const separatorIndex = line.indexOf(':')
        if (separatorIndex === -1) {
          return null
        }

        const key = line.slice(0, separatorIndex).trim()
        const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
        return [key, value]
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  )
}

function resolveMinimumSupportedVersion(release: GitHubRelease) {
  const body = release.body ?? ''
  const frontmatter = parseReleaseFrontmatter(body)
  const configured =
    frontmatter.minimumSupportedVersion ??
    frontmatter.minimum_supported_version ??
    process.env.MINIMUM_SUPPORTED_VERSION ??
    process.env.UPDATE_MINIMUM_SUPPORTED_VERSION ??
    '0.0.0'

  return normalizeVersion(configured) ?? '0.0.0'
}

function resolveChannel(rawChannel: string | undefined) {
  const channel = (rawChannel ?? process.env.UPDATE_CHANNEL ?? 'stable').trim().toLowerCase()
  return channel === 'beta' ? 'beta' : 'stable'
}

function inferBaseUrl(request: VercelRequest) {
  const configured = process.env.PUBLIC_BASE_URL?.trim()
  if (configured) {
    return configured.replace(/\/+$/, '')
  }

  const host = request.headers.host
  if (!host) {
    throw new Error('Could not infer the public base URL for update routes.')
  }

  const proto = request.headers['x-forwarded-proto']?.toString() ?? 'https'
  return `${proto}://${host}`.replace(/\/+$/, '')
}

async function githubJson<T>(path: string) {
  const owner = getEnv('GITHUB_OWNER')
  const repo = getEnv('GITHUB_REPO')
  const token = getOptionalEnv('GITHUB_TOKEN')

  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'User-Agent': 'obs-plugin-installer-update-server',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub API request failed (${response.status}): ${text || response.statusText}`)
  }

  return response.json() as Promise<T>
}

async function fetchReleaseByTag(versionOrTag: string) {
  const candidates = versionOrTag.startsWith('v')
    ? [versionOrTag, versionOrTag.slice(1)]
    : [versionOrTag, `v${versionOrTag}`]

  for (const candidate of candidates) {
    try {
      return await githubJson<GitHubRelease>(`/releases/tags/${encodeURIComponent(candidate)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('(404)')) {
        throw error
      }
    }
  }

  throw new Error(`No GitHub release was found for ${versionOrTag}.`)
}

async function fetchLatestRelease(channel: string, releaseVersion?: string) {
  if (releaseVersion) {
    const release = await fetchReleaseByTag(releaseVersion)
    console.info('[update-api] release fetched', {
      tag: release.tag_name,
      version: normalizeVersion(release.tag_name),
      pinned: true,
    })
    return release
  }

  const releases = await githubJson<GitHubRelease[]>('/releases?per_page=20')
  const selected = releases.find((release) => {
    if (release.draft) {
      return false
    }
    if (channel === 'stable') {
      return !release.prerelease
    }
    return true
  })

  if (!selected) {
    throw new Error(`No ${channel} GitHub release is available.`)
  }

  console.info('[update-api] release fetched', {
    tag: selected.tag_name,
    version: normalizeVersion(selected.tag_name),
    prerelease: selected.prerelease,
  })

  return selected
}

function hasAnyToken(fileName: string, tokens: readonly string[]) {
  const lower = fileName.toLowerCase()
  return tokens.some((token) => lower.includes(token))
}

function normalizeTarget(value: string | undefined | null) {
  if (!value) {
    return null
  }

  return TARGET_ALIASES[value.trim().toLowerCase() as keyof typeof TARGET_ALIASES] ?? null
}

function normalizeArch(value: string | undefined | null) {
  if (!value) {
    return null
  }

  return ARCH_ALIASES[value.trim().toLowerCase() as keyof typeof ARCH_ALIASES] ?? null
}

function normalizeBundleType(value: string | undefined | null) {
  if (!value) {
    return null
  }

  return BUNDLE_TYPE_ALIASES[value.trim().toLowerCase() as keyof typeof BUNDLE_TYPE_ALIASES] ?? null
}

function canonicalizeReleaseAssetName(fileName: string) {
  for (const extension of DUPLICATE_SUFFIX_EXTENSIONS) {
    const lower = fileName.toLowerCase()
    if (!lower.endsWith(extension)) {
      continue
    }

    const stem = fileName.slice(0, fileName.length - extension.length)
    const duplicateSuffix = stem.match(/(?:\.\d+| \(\d+\))$/)
    if (!duplicateSuffix) {
      return fileName
    }

    // Preserve genuine semantic version segments like v0.16.0.exe.
    if (
      duplicateSuffix[0].startsWith('.') &&
      /(?:^|[^0-9])v?\d+\.\d+$/.test(stem.slice(0, -duplicateSuffix[0].length))
    ) {
      return fileName
    }

    return `${stem.slice(0, -duplicateSuffix[0].length)}${fileName.slice(fileName.length - extension.length)}`
  }

  return fileName
}

export function resolveSupportedTarget(
  target: string | undefined | null,
  arch: string | undefined | null,
  bundleType: string | undefined | null,
) {
  const normalizedTarget = normalizeTarget(target)
  const normalizedArch = normalizeArch(arch)
  const normalizedBundleType = normalizeBundleType(bundleType)

  if (!normalizedTarget || !normalizedArch || !normalizedBundleType) {
    return null
  }

  return (
    SUPPORTED_TARGETS.find(
      (candidate) =>
        candidate.target === normalizedTarget &&
        candidate.arch === normalizedArch &&
        candidate.bundleType === normalizedBundleType,
    ) ?? null
  )
}

function formatFromFileName(fileName: string): ReleaseAssetFormat {
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.sig')) {
    return 'sig'
  }
  if (lower.endsWith('.app.tar.gz')) {
    return 'app_tar_gz'
  }
  if (lower.endsWith('.dmg')) {
    return 'dmg'
  }
  if (lower.endsWith('.exe')) {
    return 'exe'
  }
  if (lower.endsWith('.msi')) {
    return 'msi'
  }
  if (lower.endsWith('.appimage')) {
    return 'appimage'
  }
  if (lower.endsWith('.deb')) {
    return 'deb'
  }
  if (lower.endsWith('.rpm')) {
    return 'rpm'
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return 'tar_gz'
  }
  if (lower.endsWith('.zip')) {
    return 'zip'
  }

  return 'other'
}

function osFromTokens(fileName: string): ReleaseAssetOs {
  const matches = (Object.keys(PLATFORM_TOKENS) as Array<keyof typeof PLATFORM_TOKENS>).filter((platform) =>
    hasAnyToken(fileName, PLATFORM_TOKENS[platform]),
  )

  if (matches.length === 1) {
    return matches[0]
  }

  return 'unknown'
}

function osFromFormat(format: ReleaseAssetFormat, fileName: string): ReleaseAssetOs {
  switch (format) {
    case 'app_tar_gz':
    case 'dmg':
      return 'macos'
    case 'exe':
    case 'msi':
      return 'windows'
    case 'appimage':
    case 'deb':
    case 'rpm':
      return 'linux'
    default:
      return osFromTokens(fileName)
  }
}

function archFromFormatAndTokens(
  format: ReleaseAssetFormat,
  fileName: string,
  os: ReleaseAssetOs,
): ReleaseAssetArch {
  if (hasAnyToken(fileName, RELEASE_ARCH_TOKENS.universal)) {
    return 'universal'
  }
  if (hasAnyToken(fileName, RELEASE_ARCH_TOKENS.arm64)) {
    return 'arm64'
  }
  if (hasAnyToken(fileName, RELEASE_ARCH_TOKENS.x64)) {
    return 'x64'
  }
  if (format === 'app_tar_gz' && os === 'macos') {
    return 'universal'
  }

  return 'unknown'
}

function kindFromFormat(format: ReleaseAssetFormat, fileName: string): ReleaseAssetKind {
  if (format === 'sig') {
    return 'signature'
  }
  if (isSourceOnlyAsset(fileName)) {
    return 'source'
  }
  if (format === 'app_tar_gz') {
    return 'updater_bundle'
  }
  if (format === 'dmg' || format === 'exe' || format === 'msi' || format === 'appimage' || format === 'deb' || format === 'rpm') {
    return 'installer'
  }

  return 'archive'
}

export function classifyReleaseAsset(
  asset: GitHubReleaseAsset,
  releaseVersion?: string | null,
): ClassifiedReleaseAsset {
  const canonicalName = canonicalizeReleaseAssetName(asset.name)
  const normalizedCanonicalName = canonicalName.toLowerCase()
  const format = formatFromFileName(canonicalName)
  const kind = kindFromFormat(format, canonicalName)
  const os = kind === 'signature' ? 'unknown' : osFromFormat(format, normalizedCanonicalName)
  const arch = kind === 'signature' ? 'unknown' : archFromFormatAndTokens(format, normalizedCanonicalName, os)
  const version = normalizeVersion(canonicalName)

  return {
    asset,
    canonicalName: normalizedCanonicalName,
    os,
    arch,
    kind,
    format,
    version,
    versionState: !version ? 'absent' : !releaseVersion || version === releaseVersion ? 'match' : 'mismatch',
    signatureTargetName:
      format === 'sig' ? canonicalizeReleaseAssetName(canonicalName.slice(0, -4)).toLowerCase() : undefined,
  }
}

export function buildReleaseAssetCatalog(
  release: Pick<GitHubRelease, 'assets' | 'tag_name' | 'name'>,
): ReleaseAssetCatalog {
  const releaseVersion = normalizeVersion(release.tag_name) ?? normalizeVersion(release.name)
  const assets = release.assets.map((asset) => classifyReleaseAsset(asset, releaseVersion))
  const signatureAssetsByTargetName = assets.reduce<Map<string, GitHubReleaseAsset[]>>((accumulator, asset) => {
    if (!asset.signatureTargetName) {
      return accumulator
    }

    const existing = accumulator.get(asset.signatureTargetName) ?? []
    existing.push(asset.asset)
    accumulator.set(asset.signatureTargetName, existing)
    return accumulator
  }, new Map())

  return {
    releaseVersion,
    assets,
    signatureAssetsByTargetName,
  }
}

function targetArch(target: SupportedTarget): ReleaseAssetArch {
  return target.arch === 'aarch64' ? 'arm64' : 'x64'
}

function archCompatibilityScore(assetArch: ReleaseAssetArch, target: SupportedTarget) {
  const wantedArch = targetArch(target)

  if (assetArch === wantedArch) {
    return 3
  }
  if (assetArch === 'universal' && target.target === 'macos') {
    return 2
  }
  if (assetArch === 'unknown') {
    return 1
  }

  return -1
}

function isInstallableAsset(asset: ClassifiedReleaseAsset) {
  return asset.kind === 'updater_bundle' || asset.kind === 'installer'
}

function findMatchingSignature(
  catalog: ReleaseAssetCatalog,
  asset: ClassifiedReleaseAsset,
) {
  const matches = catalog.signatureAssetsByTargetName.get(asset.canonicalName) ?? []
  if (matches.length === 0) {
    return null
  }

  const exactSignatureName = expectedSignatureName(asset).toLowerCase()
  return [...matches].sort((left, right) => {
    const leftExact = left.name.toLowerCase() === exactSignatureName ? 1 : 0
    const rightExact = right.name.toLowerCase() === exactSignatureName ? 1 : 0
    if (leftExact !== rightExact) {
      return rightExact - leftExact
    }

    const leftCanonical = canonicalizeReleaseAssetName(left.name).length
    const rightCanonical = canonicalizeReleaseAssetName(right.name).length
    if (leftCanonical !== rightCanonical) {
      return leftCanonical - rightCanonical
    }

    return left.name.localeCompare(right.name)
  })[0]
}

function expectedSignatureName(asset: ClassifiedReleaseAsset | GitHubReleaseAsset) {
  return `${'asset' in asset ? asset.asset.name : asset.name}.sig`
}

function hasCanonicalizedName(asset: ClassifiedReleaseAsset) {
  return asset.canonicalName === asset.asset.name.toLowerCase()
}

function serializeAssetForLog(catalog: ReleaseAssetCatalog, asset: ClassifiedReleaseAsset) {
  return {
    name: asset.asset.name,
    canonicalName: asset.canonicalName,
    os: asset.os,
    arch: asset.arch,
    kind: asset.kind,
    format: asset.format,
    version: asset.version,
    versionState: asset.versionState,
    hasSignature: isInstallableAsset(asset) ? Boolean(findMatchingSignature(catalog, asset)) : undefined,
    expectedSignature: isInstallableAsset(asset) ? expectedSignatureName(asset) : undefined,
  }
}

function logTargetAssetPool(
  stage: string,
  catalog: ReleaseAssetCatalog,
  target: SupportedTarget,
  assets: ClassifiedReleaseAsset[],
) {
  console.info(`[update-api] ${stage}`, {
    target: target.key,
    targetLabel: target.label,
    bundleType: target.bundleType,
    assets: assets.map((asset) => serializeAssetForLog(catalog, asset)),
  })
}

function manualFormatPriority(target: SupportedTarget): ReleaseAssetFormat[] {
  if (target.target === 'macos') {
    return ['dmg']
  }

  if (target.target === 'windows') {
    return ['exe', 'msi']
  }

  if (target.bundleType === 'deb') {
    return ['deb', 'appimage']
  }

  if (target.bundleType === 'appimage') {
    return ['appimage', 'deb']
  }

  if (target.bundleType === 'rpm') {
    return ['appimage', 'deb', 'rpm']
  }

  return ['appimage', 'deb']
}

function compatibleTargetAssets(catalog: ReleaseAssetCatalog, target: SupportedTarget) {
  return catalog.assets.filter(
    (asset) =>
      isInstallableAsset(asset) &&
      asset.os === target.target,
  )
}

function versionPriorityScore(asset: ClassifiedReleaseAsset) {
  if (asset.versionState === 'match') {
    return 2
  }
  if (asset.versionState === 'absent') {
    return 1
  }
  return 0
}

function updateCandidateScore(asset: ClassifiedReleaseAsset, target: SupportedTarget) {
  return (
    archCompatibilityScore(asset.arch, target) * 100 +
    versionPriorityScore(asset) * 10 +
    (hasCanonicalizedName(asset) ? 1 : 0)
  )
}

function manualCandidateScore(
  asset: ClassifiedReleaseAsset,
  target: SupportedTarget,
  formatPriority: ReleaseAssetFormat[],
) {
  return (
    (formatPriority.length - formatPriority.indexOf(asset.format)) * 100 +
    archCompatibilityScore(asset.arch, target) * 10 +
    versionPriorityScore(asset) +
    (hasCanonicalizedName(asset) ? 1 : 0)
  )
}

function buildUpdateSelectionReason(target: SupportedTarget, asset: ClassifiedReleaseAsset) {
  const archNote =
    asset.arch === 'unknown'
      ? 'generic arch'
      : asset.arch === 'universal'
        ? 'universal'
        : asset.arch

  const versionNote =
    asset.versionState === 'mismatch' ? '; filename version differs from release tag' : ''

  return `selected signed ${FORMAT_LABELS[asset.format]} for ${target.label} (${archNote}${versionNote})`
}

function buildManualFallbackReason(target: SupportedTarget, asset: ClassifiedReleaseAsset) {
  const archNote =
    asset.arch === 'unknown'
      ? 'generic arch'
      : asset.arch === 'universal'
        ? 'universal'
        : asset.arch

  const versionNote =
    asset.versionState === 'mismatch' ? '; filename version differs from release tag' : ''

  return `manual fallback via ${FORMAT_LABELS[asset.format]} for ${target.label} (${archNote}${versionNote})`
}

function buildMissingSelectionMessage(
  catalog: ReleaseAssetCatalog,
  target: SupportedTarget,
): string {
  const installableAssets = catalog.assets.filter(isInstallableAsset)
  const matchingOsAssets = compatibleTargetAssets(catalog, target)
  const updateRule = UPDATE_SELECTION_RULES[target.bundleType]
  const matchingFormatAssets = matchingOsAssets.filter((asset) => asset.format === updateRule.format)
  const matchingFormatWrongArch = matchingFormatAssets.filter((asset) => archCompatibilityScore(asset.arch, target) < 0)
  const matchingFormatCompatibleArch = matchingFormatAssets.filter((asset) => archCompatibilityScore(asset.arch, target) >= 0)
  const manualCandidate = resolveManualFallbackForTarget(catalog, target)

  if (installableAssets.length === 0) {
    return `The latest GitHub release only includes source or non-installable assets for ${target.label}.`
  }

  if (matchingOsAssets.length === 0) {
    return `No compatible asset for ${target.label} was found in the latest GitHub release.`
  }

  if (matchingFormatAssets.length === 0) {
    if (manualCandidate) {
      return `Only manual installer assets exist for ${target.label}.`
    }

    const wrongArchOsAssets = matchingOsAssets.filter((asset) => archCompatibilityScore(asset.arch, target) < 0)
    if (wrongArchOsAssets.length > 0) {
      return `Compatible ${target.target} assets were found, but only for the wrong architecture.`
    }
    return `No compatible in-app update asset was found for ${target.label}.`
  }

  if (matchingFormatCompatibleArch.length === 0 && matchingFormatWrongArch.length > 0) {
    return `Compatible ${target.target} updater assets were found, but only for the wrong architecture.`
  }

  const missingSignatureCandidates = matchingFormatCompatibleArch
    .filter((asset) => !findMatchingSignature(catalog, asset))
    .sort(
      (left, right) =>
        updateCandidateScore(right, target) - updateCandidateScore(left, target) ||
        left.asset.name.localeCompare(right.asset.name),
    )

  if (missingSignatureCandidates.length > 0) {
    const candidate = missingSignatureCandidates[0]
    const signatureName = expectedSignatureName(candidate)
    const ambiguityNote =
      missingSignatureCandidates.length > 1 ? ' Multiple compatible candidates were found in the release.' : ''

    if (manualCandidate) {
      return `Matched ${FORMAT_LABELS[candidate.format]} ${candidate.asset.name} for ${target.label}, but expected signature ${signatureName} was not found. A manual installer is available instead.${ambiguityNote}`
    }
    return `Matched ${FORMAT_LABELS[candidate.format]} ${candidate.asset.name} for ${target.label}, but expected signature ${signatureName} was not found.${ambiguityNote}`
  }

  if (manualCandidate) {
    return `Only manual installer assets exist for ${target.label}.`
  }

  return `No compatible asset for ${target.label} was found in the latest GitHub release.`
}

export function resolveSelectionForTarget(
  catalog: ReleaseAssetCatalog,
  target: SupportedTarget,
): SelectionResult {
  const installableAssets = catalog.assets.filter(isInstallableAsset)
  const updateRule = UPDATE_SELECTION_RULES[target.bundleType]
  const matchingOsAssets = compatibleTargetAssets(catalog, target)
  const matchingFormatAssets = matchingOsAssets.filter((asset) => asset.format === updateRule.format)
  logTargetAssetPool('update assets matched for target', catalog, target, matchingFormatAssets)

  const candidates = matchingFormatAssets
    .filter((asset) => asset.format === updateRule.format)
    .map((asset) => {
      const signatureAsset = findMatchingSignature(catalog, asset)
      if (!signatureAsset) {
        console.info('[update-api] asset rejected', {
          target: target.key,
          asset: asset.asset.name,
          expectedSignature: expectedSignatureName(asset),
          reason: 'missing updater signature',
        })
        return null
      }

      const archScore = archCompatibilityScore(asset.arch, target)
      if (archScore < 0) {
        console.info('[update-api] asset rejected', {
          target: target.key,
          asset: asset.asset.name,
          reason: `wrong architecture for ${target.label}`,
        })
        return null
      }

      return {
        asset: asset.asset,
        signatureAsset,
        score: updateCandidateScore(asset, target),
        reason: buildUpdateSelectionReason(target, asset),
      }
    })
    .filter((entry): entry is SelectedAssetCandidate => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.asset.name.localeCompare(right.asset.name))

  if (installableAssets.length === 0) {
    return {
      kind: catalog.assets.some((asset) => asset.kind === 'source') ? 'source-only' : 'missing',
      message: buildMissingSelectionMessage(catalog, target),
    }
  }

  if (candidates.length === 0) {
    return {
      kind: 'missing',
      message: buildMissingSelectionMessage(catalog, target),
    }
  }

  const topCandidates = candidates.filter((candidate) => candidate.score === candidates[0].score)
  if (topCandidates.length > 1) {
    console.warn('[update-api] ambiguous update candidates', {
      target: target.key,
      candidates: topCandidates.map((candidate) => ({
        asset: candidate.asset.name,
        signature: candidate.signatureAsset.name,
        score: candidate.score,
        reason: candidate.reason,
      })),
    })
    return {
      kind: 'ambiguous',
      message: `Multiple compatible ${updateRule.label}s were found for ${target.label}: ${topCandidates
        .map((candidate) => candidate.asset.name)
        .join(', ')}.`,
    }
  }

  console.info('[update-api] asset selected', {
    target: target.key,
    asset: candidates[0].asset.name,
    signature: candidates[0].signatureAsset.name,
    reason: candidates[0].reason,
  })

  return {
    kind: 'selected',
    candidate: candidates[0],
  }
}

export function resolveManualFallbackForTarget(
  catalog: ReleaseAssetCatalog,
  target: SupportedTarget,
): ManualFallbackCandidate | null {
  const formatPriority = manualFormatPriority(target)
  const matchingOsAssets = compatibleTargetAssets(catalog, target)
  const matchingInstallers = matchingOsAssets
    .filter((asset) => asset.kind === 'installer')
    .filter((asset) => formatPriority.includes(asset.format))
  logTargetAssetPool('manual fallback assets matched for target', catalog, target, matchingInstallers)

  const candidates = matchingInstallers
    .map((asset) => {
      const archScore = archCompatibilityScore(asset.arch, target)
      if (archScore < 0) {
        console.info('[update-api] manual fallback rejected', {
          target: target.key,
          asset: asset.asset.name,
          reason: `wrong architecture for ${target.label}`,
        })
        return null
      }

      return {
        asset: asset.asset,
        score: manualCandidateScore(asset, target, formatPriority),
        reason: buildManualFallbackReason(target, asset),
      }
    })
    .filter((entry): entry is ManualFallbackCandidate => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.asset.name.localeCompare(right.asset.name))

  if (candidates.length === 0) {
    return null
  }

  const topCandidates = candidates.filter((candidate) => candidate.score === candidates[0].score)
  if (topCandidates.length > 1) {
    console.warn('[update-api] multiple manual fallback candidates', {
      target: target.key,
      candidates: topCandidates.map((candidate) => ({
        asset: candidate.asset.name,
        score: candidate.score,
        reason: candidate.reason,
      })),
    })
  }

  console.info('[update-api] manual fallback selected', {
    target: target.key,
    asset: candidates[0].asset.name,
    reason: candidates[0].reason,
  })

  return candidates[0]
}

async function fetchSignature(asset: GitHubReleaseAsset) {
  const token = getOptionalEnv('GITHUB_TOKEN')

  const response = await fetch(asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'User-Agent': 'obs-plugin-installer-update-server',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Could not fetch updater signature ${asset.name} (${response.status}): ${text || response.statusText}`,
    )
  }

  return response.text()
}

function buildDownloadUrl(
  baseUrl: string,
  target: SupportedTarget,
  version: string,
  channel: string,
  options?: { assetName?: string },
) {
  const url = new URL(
    `/api/download/${target.target}/${target.arch}/${target.bundleType}/${encodeURIComponent(version)}`,
    `${baseUrl}/`,
  )
  url.searchParams.set('channel', channel)
  if (options?.assetName) {
    url.searchParams.set('assetName', options.assetName)
  }
  return url.toString()
}

function compareVersions(left: string, right: string) {
  const leftVersion = normalizeVersion(left)
  const rightVersion = normalizeVersion(right)

  if (!leftVersion || !rightVersion) {
    return 0
  }

  return compare(leftVersion, rightVersion)
}

export function sendJson(response: VercelResponse, statusCode: number, payload: unknown) {
  response.setHeader('Cache-Control', CACHE_CONTROL)
  response.status(statusCode).json(payload)
}

export function sendError(response: VercelResponse, statusCode: number, message: string) {
  response.setHeader('Cache-Control', 'no-store')
  response.status(statusCode).json({ message })
}

export async function resolveUpdateCatalog(
  options: ResolveCatalogOptions,
): Promise<UpdateMetadataPayload> {
  const baseUrl = inferBaseUrl(options.request)
  const channel = resolveChannel(options.channel)
  const requestedVersion = options.releaseVersion?.trim()
  const release = await fetchLatestRelease(channel, requestedVersion)
  const latestVersion = normalizeVersion(release.tag_name) ?? normalizeVersion(release.name) ?? '0.0.0'
  const minimumSupportedVersion = resolveMinimumSupportedVersion(release)
  const releaseNotes = stripReleaseFrontmatter(release.body ?? '')

  console.info('[update-api] assets found', {
    count: release.assets.length,
    tag: release.tag_name,
    assets: release.assets.map((asset) => asset.name),
  })

  const catalog = buildReleaseAssetCatalog(release)
  console.info('[update-api] asset catalog classified', {
    tag: release.tag_name,
    releaseVersion: catalog.releaseVersion,
    assets: catalog.assets.map((asset) => serializeAssetForLog(catalog, asset)),
  })

  const selectionResults = new Map(
    SUPPORTED_TARGETS.map((target) => [target.key, resolveSelectionForTarget(catalog, target)] as const),
  )

  const signatureCache = new Map<string, Promise<string>>()
  const platformEntries = await Promise.all(
    SUPPORTED_TARGETS.map(async (target) => {
      const selection = selectionResults.get(target.key)
      if (!selection || selection.kind !== 'selected' || !selection.candidate) {
        return null
      }

      const signatureKey = selection.candidate.signatureAsset.url
      const signaturePromise =
        signatureCache.get(signatureKey) ?? fetchSignature(selection.candidate.signatureAsset)
      signatureCache.set(signatureKey, signaturePromise)

      const signature = (await signaturePromise).trim()

      return [
        target.key,
        {
          target: target.target,
          arch: target.arch,
          bundleType: target.bundleType,
          url: buildDownloadUrl(baseUrl, target, latestVersion, channel),
          signature,
          fileName: selection.candidate.asset.name,
          size: selection.candidate.asset.size,
          reason: selection.candidate.reason,
        },
      ] as const
    }),
  )

  const platforms = platformEntries.reduce<Record<string, PlatformManifestEntry>>((accumulator, entry) => {
    if (!entry) {
      return accumulator
    }

    accumulator[entry[0]] = entry[1]
    return accumulator
  }, {})

  const payload: UpdateMetadataPayload = {
    latestVersion,
    minimumSupportedVersion,
    releaseNotes,
    publishedAt: release.published_at ?? null,
    releaseTag: release.tag_name,
    releaseUrl: release.html_url,
    channel,
    platforms,
  }

  if (options.currentVersion && options.target && options.arch && options.bundleType) {
    const currentVersion = normalizeVersion(options.currentVersion) ?? options.currentVersion
    const selectedTarget = resolveSupportedTarget(options.target, options.arch, options.bundleType)
    const selectedKey = selectedTarget?.key ?? `${options.target}-${options.arch}-${options.bundleType}`
    const selectedPlatform = selectedTarget ? platforms[selectedKey] : undefined
    const manualFallback = selectedTarget ? resolveManualFallbackForTarget(catalog, selectedTarget) : null
    payload.currentVersion = currentVersion
    payload.selectedPlatform = selectedKey

    if (manualFallback && selectedTarget) {
      payload.manualFallbackName = manualFallback.asset.name
      payload.manualFallbackReason = manualFallback.reason
      payload.manualFallbackUrl = buildDownloadUrl(baseUrl, selectedTarget, latestVersion, channel, {
        assetName: manualFallback.asset.name,
      })
      payload.manualFallbackSize = manualFallback.asset.size
    }

    if (compareVersions(currentVersion, latestVersion) >= 0) {
      payload.status = 'no-update'
      payload.message = 'You are already on the latest version.'
      return payload
    }

    if (!selectedPlatform) {
      const selection = selectedTarget ? selectionResults.get(selectedTarget.key) : undefined
      const fallbackStatus: UpdateStatus =
        selection?.kind === 'source-only'
          ? 'source-only'
          : selection?.kind === 'ambiguous'
            ? 'ambiguous'
            : 'no-installable-asset'
      payload.status = fallbackStatus
      payload.message =
        selection?.message ??
        `No ${options.target} ${options.arch} installable asset was found in the latest GitHub release.`
      console.warn('[update-api] no platform selected for request', {
        release: release.tag_name,
        selectedKey,
        fallbackStatus,
        selection,
      })
      return payload
    }

    payload.selectedAssetName = selectedPlatform.fileName
    payload.selectedAssetReason = selectedPlatform.reason
    payload.selectedAssetUrl = selectedPlatform.url
    payload.selectedAssetSize = selectedPlatform.size
    payload.status = lt(currentVersion, minimumSupportedVersion)
      ? 'update-required'
      : 'update-available'
    payload.message =
      payload.status === 'update-required'
        ? 'Update required before you can keep using this build.'
        : 'A newer build is available.'
  }

  return payload
}

export function parseSelectionFromRequest(request: VercelRequest) {
  return {
    currentVersion: readQueryValue(request.query.currentVersion),
    target: readQueryValue(request.query.target),
    arch: readQueryValue(request.query.arch),
    bundleType: readQueryValue(request.query.bundleType),
    channel: readQueryValue(request.query.channel),
    releaseVersion: readQueryValue(request.query.version),
  }
}
