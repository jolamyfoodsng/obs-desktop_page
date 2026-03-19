import type { VercelRequest, VercelResponse } from '@vercel/node'

import { getPostHogClient, safeCapture, safeShutdown } from '../../../../_lib/posthog.js'
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
  const currentVersion = readPathParam(request.query.currentVersion)
  const channel = readPathParam(request.query.channel)

  if (!target || !arch || !bundleType || !currentVersion) {
    return sendError(response, 400, 'Missing updater route parameters.')
  }

  const posthog = getPostHogClient()

  try {
    const payload = await resolveUpdateCatalog({
      request,
      target,
      arch,
      bundleType,
      currentVersion,
      channel,
    })

    safeCapture(posthog, {
      distinctId: `${target}-${arch}`,
      event: 'update check',
      properties: {
        target,
        arch,
        bundleType,
        currentVersion,
        channel: payload.channel,
        status: payload.status ?? 'update-available',
        latestVersion: payload.latestVersion,
      },
    })
    await safeShutdown(posthog)

    if (payload.status === 'no-update') {
      response.setHeader('Cache-Control', 'no-store')
      response.status(204).end()
      return
    }

    if (!payload.selectedAssetUrl || !payload.selectedAssetName) {
      return sendError(
        response,
        409,
        payload.message ?? 'No installable asset could be resolved for this platform.',
      )
    }

    const platformKey = payload.selectedPlatform ?? `${target}-${arch}-${bundleType}`
    const platform = payload.platforms[platformKey]

    if (!platform) {
      return sendError(response, 409, 'Resolved update manifest is missing the platform payload.')
    }

    response.setHeader('Cache-Control', 'no-store')
    response.status(200).json({
      version: payload.latestVersion,
      notes: payload.releaseNotes,
      pub_date: payload.publishedAt,
      url: platform.url,
      signature: platform.signature,
      minimumSupportedVersion: payload.minimumSupportedVersion,
      selectedAssetName: platform.fileName,
      selectedAssetReason: platform.reason,
      fileName: platform.fileName,
      size: platform.size,
      releaseTag: payload.releaseTag,
      channel: payload.channel,
    })
  } catch (error) {
    await safeShutdown(posthog)
    const message = error instanceof Error ? error.message : 'Could not resolve the updater manifest.'
    console.error('[update-api] dynamic updater route failed', message)
    return sendError(response, 500, message)
  }
}
