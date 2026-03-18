import packageJson from '../../package.json'

import { getOrCreateInstallId } from './installId'
import { desktopApi } from './tauri'

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
    fallbackEmail?: string | null
    fallbackMailto?: string | null
  }
}

export class SupportSubmissionError extends Error {
  field?: string | null
  fallbackEmail?: string | null
  fallbackMailto?: string | null

  constructor(
    message: string,
    field?: string | null,
    fallbackEmail?: string | null,
    fallbackMailto?: string | null,
  ) {
    super(message)
    this.name = 'SupportSubmissionError'
    this.field = field ?? null
    this.fallbackEmail = fallbackEmail ?? null
    this.fallbackMailto = fallbackMailto ?? null
  }
}

const SUPPORT_API_BASE_URL = import.meta.env.VITE_SUPPORT_API_BASE_URL?.trim() ?? ''
const DEFAULT_SUPPORT_API_BASE_URL = 'https://obs-desktop-page.vercel.app'

function normalizeSupportApiBaseUrl(value: string) {
  return value.trim().replace(/\/$/, '')
}

function resolveSupportApiUrl() {
  const configuredBaseUrl = normalizeSupportApiBaseUrl(SUPPORT_API_BASE_URL)

  if (configuredBaseUrl) {
    return `${configuredBaseUrl}/api/support`
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.origin}/api/support`
  }

  return `${DEFAULT_SUPPORT_API_BASE_URL}/api/support`
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
    return { field: null, message: null, fallbackEmail: null, fallbackMailto: null }
  }

  if (typeof payload === 'string') {
    return { field: null, message: payload, fallbackEmail: null, fallbackMailto: null }
  }

  return {
    field: payload.error?.field ?? null,
    message: payload.error?.message ?? payload.message ?? null,
    fallbackEmail: payload.error?.fallbackEmail ?? null,
    fallbackMailto: payload.error?.fallbackMailto ?? null,
  }
}

function supportRequestPayload(input: SupportSubmissionInput) {
  return {
    kind: input.kind,
    email: input.email.trim(),
    subject: input.subject?.trim() || null,
    message: input.message.trim(),
    pluginUrl: input.pluginUrl?.trim() || null,
    obsVersion: input.obsVersion?.trim() || null,
    appVersion: packageJson.version,
    installId: getOrCreateInstallId(),
    platform: input.platform ?? (typeof navigator !== 'undefined' ? navigator.platform : 'unknown'),
  }
}

function parseDesktopSubmissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? 'Could not submit your request.')
  const trimmedMessage = message.trim()

  if (trimmedMessage.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmedMessage) as SupportSubmissionResponse['error'] & { message?: string } | null

      if (parsed?.message) {
        return new SupportSubmissionError(
          parsed.message,
          parsed.field,
          parsed.fallbackEmail,
          parsed.fallbackMailto,
        )
      }
    } catch {
      // Ignore malformed JSON and fall back to plain-text parsing.
    }
  }

  const fieldMatch = /^FIELD:([^:]+):(.*)$/s.exec(message)

  if (fieldMatch) {
    return new SupportSubmissionError(fieldMatch[2].trim() || 'Could not submit your request.', fieldMatch[1].trim())
  }

  return new Error(message)
}

async function submitWithDesktopBridge(input: SupportSubmissionInput) {
  try {
    return await desktopApi.submitSupportRequest(supportRequestPayload(input))
  } catch (error) {
    throw parseDesktopSubmissionError(error)
  }
}

async function submitWithFetch(input: SupportSubmissionInput) {
  const supportApiUrl = resolveSupportApiUrl()

  let response: Response

  try {
    response = await fetch(supportApiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(supportRequestPayload(input)),
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
      payloadDetails.fallbackEmail,
      payloadDetails.fallbackMailto,
    )
  }

  if (typeof payload !== 'object' || payload === null || payload.ok !== true) {
    throw new SupportSubmissionError(
      payloadDetails.message ?? 'Support request did not return a valid success response.',
      payloadDetails.field,
      payloadDetails.fallbackEmail,
      payloadDetails.fallbackMailto,
    )
  }

  return payload
}

function isDesktopRuntime() {
  if (typeof window === 'undefined') {
    return false
  }

  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

export async function submitSupportRequest(input: SupportSubmissionInput) {
  if (isDesktopRuntime()) {
    return submitWithDesktopBridge(input)
  }

  return submitWithFetch(input)
}
