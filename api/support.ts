import type { VercelRequest, VercelResponse } from '@vercel/node'

import {
  deliverSupportSubmission,
  enforceSupportRateLimit,
  sendSupportError,
  sendSupportSuccess,
  validateSupportSubmission,
} from './_lib/support.js'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Max-Age', '86400')

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
    return sendSupportError(response, 500, 'We could not submit your request right now. Please try again later.')
  }
}
