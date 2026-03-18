import type { VercelRequest, VercelResponse } from '@vercel/node'

import {
  buildSupportFallbackMailto,
  deliverSupportSubmission,
  enforceSupportRateLimit,
  sendSupportError,
  sendSupportSuccess,
  validateSupportSubmission,
} from './_lib/support.js'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const requestOrigin = typeof request.headers.origin === 'string' ? request.headers.origin : null

  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Origin', requestOrigin ?? '*')
  response.setHeader('Access-Control-Max-Age', '86400')
  response.setHeader('Vary', 'Origin')

  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS')
    return sendSupportError(response, 405, 'Method not allowed.')
  }

  const rateLimitResponse = enforceSupportRateLimit(request, response)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const validated = validateSupportSubmission(request.body)
  if ('error' in validated && validated.error) {
    return sendSupportError(response, 400, validated.error.message, validated.error.field)
  }

  try {
    await deliverSupportSubmission(validated.value)
    return sendSupportSuccess(response)
  } catch (error) {
    console.error('[support-api] submission delivery failed', error)

    const detailedMessage = error instanceof Error ? error.message : null
    const supportInbox = process.env.SUPPORT_INBOX_EMAIL?.trim() || null
    const fallbackMailto = supportInbox ? buildSupportFallbackMailto(validated.value, supportInbox) : null
    const message = supportInbox
      ? `We could not submit your request right now. Please email ${supportInbox} directly instead.`
      : process.env.NODE_ENV === 'production' || !detailedMessage
        ? 'We could not submit your request right now. Please try again later.'
        : `Support delivery failed: ${detailedMessage}`

    return sendSupportError(response, supportInbox ? 503 : 500, message, undefined, {
      fallbackEmail: supportInbox,
      fallbackMailto,
    })
  }
}
