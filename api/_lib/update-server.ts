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

const PLATFORM_CONFLICTS = {
  windows: ['linux', 'appimage', '.deb', '.rpm', 'macos', '.dmg', '.pkg', '.app.tar.gz'],
  linux: ['windows', 'win32', 'win64', '.exe', '.msi', 'nsis', 'macos', '.dmg', '.pkg'],
  macos: ['windows', 'win32', 'win64', '.exe', '.msi', 'nsis', 'linux', 'appimage', '.deb', '.rpm'],
} as const

const ARCH_TOKENS = {
  x86_64: ['x86_64', 'amd64', 'x64', '64bit'],
  aarch64: ['aarch64', 'arm64'],
} as const

const ARCH_CONFLICTS = {
  x86_64: ['arm64', 'aarch64'],
  aarch64: ['x86_64', 'amd64', 'x64', '64bit'],
} as const

const BUNDLE_RULES = {
  nsis: {
    extensions: ['.exe'],
    tokens: ['nsis', 'setup'],
    label: 'NSIS installer',
  },
  msi: {
    extensions: ['.msi'],
    tokens: ['msi'],
    label: 'MSI installer',
  },
  appimage: {
    extensions: ['.appimage'],
    tokens: ['appimage'],
    label: 'AppImage',
  },
  deb: {
    extensions: ['.deb'],
    tokens: ['deb'],
    label: 'DEB package',
  },
  rpm: {
    extensions: ['.rpm'],
    tokens: ['rpm'],
    label: 'RPM package',
  },
  app: {
    extensions: ['.app.tar.gz'],
    tokens: ['.app.tar.gz', 'app.tar.gz', 'universal'],
    label: 'macOS app bundle',
  },
} as const

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

interface SelectionResult {
  kind: 'selected' | 'missing' | 'source-only' | 'ambiguous'
  candidate?: SelectedAssetCandidate
  message?: string
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

function getEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
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
  const token = getEnv('GITHUB_TOKEN')
  const owner = getEnv('GITHUB_OWNER')
  const repo = getEnv('GITHUB_REPO')

  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
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

function assetHasExtension(fileName: string, extensions: readonly string[]) {
  const lower = fileName.toLowerCase()
  return extensions.some((extension) => lower.endsWith(extension))
}

function hasAnyToken(fileName: string, tokens: readonly string[]) {
  const lower = fileName.toLowerCase()
  return tokens.some((token) => lower.includes(token))
}

function scoreAssetCandidate(
  target: SupportedTarget,
  asset: GitHubReleaseAsset,
  signatureAsset: GitHubReleaseAsset | undefined,
) {
  const fileName = asset.name.toLowerCase()

  if (!signatureAsset) {
    return { reason: 'missing updater signature', score: -1 }
  }

  if (isSourceOnlyAsset(asset.name)) {
    return { reason: 'source archive or checksum asset', score: -1 }
  }

  const bundleRule = BUNDLE_RULES[target.bundleType]
  if (!assetHasExtension(fileName, bundleRule.extensions)) {
    return { reason: `not a ${bundleRule.label}`, score: -1 }
  }

  const conflictTokens = PLATFORM_CONFLICTS[target.target]
  if (hasAnyToken(fileName, conflictTokens)) {
    return { reason: `conflicts with ${target.target}`, score: -1 }
  }

  const conflictingArchTokens = ARCH_CONFLICTS[target.arch]
  if (hasAnyToken(fileName, conflictingArchTokens)) {
    return { reason: `conflicts with ${target.arch}`, score: -1 }
  }

  let score = 0
  const reasons: string[] = []

  score += 60
  reasons.push(bundleRule.label)

  if (hasAnyToken(fileName, PLATFORM_TOKENS[target.target])) {
    score += 28
    reasons.push(target.label)
  } else if (target.target === 'windows' || target.target === 'linux') {
    score += 12
  }

  if (hasAnyToken(fileName, ARCH_TOKENS[target.arch])) {
    score += 30
    reasons.push(target.arch === 'x86_64' ? 'x64' : 'ARM64')
  } else if (target.target === 'macos' && fileName.includes('universal')) {
    score += 22
    reasons.push('universal')
  } else {
    score += 6
  }

  if (hasAnyToken(fileName, bundleRule.tokens)) {
    score += 12
  }

  const version = normalizeVersion(asset.name)
  if (version) {
    score += 4
  }

  return {
    score,
    reason: `best match for ${reasons.join(' ')}`.replace(/\s+/g, ' ').trim(),
  }
}

function resolveSelectionForTarget(release: GitHubRelease, target: SupportedTarget): SelectionResult {
  const signatureAssets = new Map(
    release.assets
      .filter((asset) => asset.name.toLowerCase().endsWith('.sig'))
      .map((asset) => [asset.name.slice(0, -4).toLowerCase(), asset] as const),
  )

  const nonSignatureAssets = release.assets.filter((asset) => !asset.name.toLowerCase().endsWith('.sig'))
  const installableAssets = nonSignatureAssets.filter((asset) => !isSourceOnlyAsset(asset.name))
  const diagnostics = nonSignatureAssets.map((asset) => ({
    asset: asset.name,
    signature: Boolean(signatureAssets.get(asset.name.toLowerCase())),
    sourceOnly: isSourceOnlyAsset(asset.name),
  }))

  if (installableAssets.length === 0) {
    console.warn('[update-api] no installable assets for target', {
      target: target.key,
      diagnostics,
    })
    return {
      kind: nonSignatureAssets.length > 0 ? 'source-only' : 'missing',
      message: `The latest GitHub release only includes source or non-installable assets for ${target.label}.`,
    }
  }

  const scored = installableAssets
    .map((asset) => {
      const signatureAsset = signatureAssets.get(asset.name.toLowerCase())
      const result = scoreAssetCandidate(target, asset, signatureAsset)
      if (result.score < 0 || !signatureAsset) {
        console.info('[update-api] asset rejected', {
          target: target.key,
          asset: asset.name,
          reason: result.reason,
        })
        return null
      }

      return {
        asset,
        signatureAsset,
        score: result.score,
        reason: result.reason,
      }
    })
    .filter((entry): entry is SelectedAssetCandidate => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.asset.name.localeCompare(right.asset.name))

  if (scored.length === 0) {
    console.warn('[update-api] no scored assets for target', {
      target: target.key,
      diagnostics,
    })
    return {
      kind: 'missing',
      message: `No ${target.reasonLabel} installable asset was found in the latest GitHub release.`,
    }
  }

  if (scored.length > 1) {
    const [best, runnerUp] = scored
    if (best.score - runnerUp.score < 10) {
      console.warn('[update-api] asset selection ambiguous', {
        target: target.key,
        best: best.asset.name,
        runnerUp: runnerUp.asset.name,
      })
      return {
        kind: 'ambiguous',
        message: `Multiple ${target.reasonLabel} assets looked valid, so the server did not choose one automatically.`,
      }
    }
  }

  console.info('[update-api] asset selected', {
    target: target.key,
    asset: scored[0].asset.name,
    reason: scored[0].reason,
  })

  return {
    kind: 'selected',
    candidate: scored[0],
  }
}

async function fetchSignature(asset: GitHubReleaseAsset) {
  const token = getEnv('GITHUB_TOKEN')

  const response = await fetch(asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
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
) {
  const url = new URL(
    `/api/download/${target.target}/${target.arch}/${target.bundleType}/${encodeURIComponent(version)}`,
    `${baseUrl}/`,
  )
  url.searchParams.set('channel', channel)
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

  const selectionResults = new Map(
    SUPPORTED_TARGETS.map((target) => [target.key, resolveSelectionForTarget(release, target)] as const),
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
    const selectedKey = `${options.target}-${options.arch}-${options.bundleType}`
    const selectedPlatform = platforms[selectedKey]
    payload.currentVersion = currentVersion
    payload.selectedPlatform = selectedKey

    if (compareVersions(currentVersion, latestVersion) >= 0) {
      payload.status = 'no-update'
      payload.message = 'You are already on the latest version.'
      return payload
    }

    if (!selectedPlatform) {
      const selection = selectionResults.get(selectedKey as SupportedTarget['key'])
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
