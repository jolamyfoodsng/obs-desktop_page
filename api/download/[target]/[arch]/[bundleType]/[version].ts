import { Readable } from 'node:stream'

import type { VercelRequest, VercelResponse } from '@vercel/node'

import { safeCapture, safeShutdown } from '../../../../_lib/posthog.js'
import { resolveUpdateCatalog, sendError } from '../../../../_lib/update-server.js'

function readPathParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return sendError(response, 405, 'Method not allowed.')
  }

  const target = readPathParam(request.query.target)
  const arch = readPathParam(request.query.arch)
  const bundleType = readPathParam(request.query.bundleType)
  const version = readPathParam(request.query.version)
  const channel = readPathParam(request.query.channel)

  if (!target || !arch || !bundleType || !version) {
    return sendError(response, 400, 'Missing download route parameters.')
  }

  const { getPostHogClient } = await import('../../../../_lib/posthog.js')
  const posthog = getPostHogClient()

  try {
    const payload = await resolveUpdateCatalog({
      request,
      target,
      arch,
      bundleType,
      currentVersion: version,
      channel,
      releaseVersion: version,
    })

    const platformKey = `${target}-${arch}-${bundleType}`
    const platform = payload.platforms[platformKey]
    if (!platform) {
      await safeShutdown(posthog)
      return sendError(
        response,
        404,
        payload.message ?? 'No installable asset was found for the requested platform.',
      )
    }

    const requestedVersion = version.startsWith('v') ? version.slice(1) : version
    if (requestedVersion !== payload.latestVersion) {
      await safeShutdown(posthog)
      return sendError(response, 404, 'Requested version does not match the selected release.')
    }

    const token = process.env.GITHUB_TOKEN?.trim() || null
    const owner = process.env.GITHUB_OWNER?.trim()
    const repo = process.env.GITHUB_REPO?.trim()

    if (!owner || !repo) {
      await safeShutdown(posthog)
      return sendError(response, 500, 'GitHub release proxy is not configured correctly.')
    }

    const githubReleaseResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(payload.releaseTag)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'User-Agent': 'obs-plugin-installer-update-server',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )

    if (!githubReleaseResponse.ok) {
      const text = await githubReleaseResponse.text()
      await safeShutdown(posthog)
      return sendError(
        response,
        502,
        `Could not fetch release assets from GitHub (${githubReleaseResponse.status}): ${text || githubReleaseResponse.statusText}`,
      )
    }

    const release = (await githubReleaseResponse.json()) as {
      assets: Array<{ name: string; url: string }>
    }
    const matchingAsset = release.assets.find((asset) => asset.name === platform.fileName)

    if (!matchingAsset) {
      await safeShutdown(posthog)
      return sendError(response, 404, 'Requested asset is no longer present in the GitHub release.')
    }

    const assetResponse = await fetch(matchingAsset.url, {
      headers: {
        Accept: 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'User-Agent': 'obs-plugin-installer-update-server',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'follow',
    })

    if (!assetResponse.ok || !assetResponse.body) {
      const text = await assetResponse.text()
      await safeShutdown(posthog)
      return sendError(
        response,
        502,
        `Could not download the GitHub release asset (${assetResponse.status}): ${text || assetResponse.statusText}`,
      )
    }

    safeCapture(posthog, {
      distinctId: `${target}-${arch}`,
      event: 'update downloaded',
      properties: {
        target,
        arch,
        bundleType,
        version: payload.latestVersion,
        channel: payload.channel,
        fileName: platform.fileName,
        fileSize: platform.size,
      },
    })
    await safeShutdown(posthog)

    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Content-Disposition', `attachment; filename="${platform.fileName}"`)
    response.setHeader(
      'Content-Type',
      assetResponse.headers.get('content-type') ?? 'application/octet-stream',
    )

    const contentLength = assetResponse.headers.get('content-length')
    if (contentLength) {
      response.setHeader('Content-Length', contentLength)
    }

    Readable.fromWeb(assetResponse.body as never).pipe(response)
  } catch (error) {
    await safeShutdown(posthog)
    const message = error instanceof Error ? error.message : 'Could not proxy the update asset.'
    console.error('[update-api] download proxy failed', message)
    return sendError(response, 500, message)
  }
}
