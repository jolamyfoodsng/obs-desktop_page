import packageJson from '../../package.json'

import { getOrCreateInstallId } from './installId'

export type SupportRequestKind = 'problem-report' | 'general-feedback' | 'plugin-request'

export interface SupportSubmissionInput {
  kind: SupportRequestKind
  email: string
  subject?: string | null
  message: string
  pluginUrl?: string | null
  obsVersion?: string | null
  platform?: string | null
}

interface SupportSubmissionResponse {
  ok: boolean
  message?: string
  error?: {
    message?: string
    field?: string | null
  }
}

export class SupportSubmissionError extends Error {
  field?: string | null

  constructor(message: string, field?: string | null) {
    super(message)
    this.name = 'SupportSubmissionError'
    this.field = field ?? null
  }
}

const SUPPORT_API_BASE_URL = import.meta.env.VITE_SUPPORT_API_BASE_URL?.trim() ?? ''

function resolveSupportApiUrl() {
  const normalizedBaseUrl = SUPPORT_API_BASE_URL.replace(/\/$/, '')

  if (normalizedBaseUrl) {
    return `${normalizedBaseUrl}/api/support`
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.origin}/api/support`
  }

  throw new Error(
    'Support submissions are not configured for this desktop build. Please contact support or reinstall the latest app update.',
  )
}

async function readSupportResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return (await response.json().catch(() => null)) as SupportSubmissionResponse | null
  }

  const text = await response.text().catch(() => '')
  return text.trim()
}

function errorDetailsFromPayload(payload: SupportSubmissionResponse | string | null) {
  if (!payload) {
    return { field: null, message: null }
  }

  if (typeof payload === 'string') {
    return { field: null, message: payload }
  }

  return {
    field: payload.error?.field ?? null,
    message: payload.error?.message ?? payload.message ?? null,
  }
}

export async function submitSupportRequest(input: SupportSubmissionInput) {
  const supportApiUrl = resolveSupportApiUrl()

  let response: Response

  try {
    response = await fetch(supportApiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...input,
        appVersion: packageJson.version,
        installId: getOrCreateInstallId(),
        platform: input.platform ?? (typeof navigator !== 'undefined' ? navigator.platform : 'unknown'),
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown network error'
    throw new Error(
      `Support submission could not reach ${supportApiUrl}. ${message}. This is usually a network, CORS, or support server configuration issue.`,
    )
  }

  const payload = await readSupportResponse(response)
  const payloadDetails = errorDetailsFromPayload(payload)

  if (!response.ok) {
    throw new SupportSubmissionError(
      payloadDetails.message ?? `Support request failed with status ${response.status}.`,
      payloadDetails.field,
    )
  }

  if (typeof payload !== 'object' || payload === null || payload.ok !== true) {
    throw new SupportSubmissionError(
      payloadDetails.message ?? 'Support request did not return a valid success response.',
      payloadDetails.field,
    )
  }

  return payload
}
