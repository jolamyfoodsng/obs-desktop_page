import type { VercelRequest, VercelResponse } from '@vercel/node'

import {
  parseSelectionFromRequest,
  resolveUpdateCatalog,
  sendError,
  sendJson,
} from './_lib/update-server.js'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return sendError(response, 405, 'Method not allowed.')
  }

  try {
    const payload = await resolveUpdateCatalog({
      request,
      ...parseSelectionFromRequest(request),
    })

    return sendJson(response, 200, payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not resolve update metadata.'
    console.error('[update-api] metadata route failed', message)
    return sendError(response, 500, message)
  }
}
