import packageJson from '../../package.json'

import { getOrCreateInstallId } from './installId'

export type SupportRequestKind = 'problem-report' | 'general-feedback' | 'plugin-request'

export interface SupportSubmissionInput {
  kind: SupportRequestKind
  email?: string | null
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

const SUPPORT_API_BASE_URL = import.meta.env.VITE_SUPPORT_API_BASE_URL?.trim() ?? ''

function resolveSupportApiUrl() {
  const normalizedBaseUrl = SUPPORT_API_BASE_URL.replace(/\/$/, '')

  if (normalizedBaseUrl) {
    return `${normalizedBaseUrl}/api/support`
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.origin}/api/support`
  }

  throw new Error('Support API is not configured. Set VITE_SUPPORT_API_BASE_URL for desktop builds.')
}

export async function submitSupportRequest(input: SupportSubmissionInput) {
  const response = await fetch(resolveSupportApiUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...input,
      appVersion: packageJson.version,
      installId: getOrCreateInstallId(),
      platform: input.platform ?? (typeof navigator !== 'undefined' ? navigator.platform : 'unknown'),
    }),
  })

  const payload = (await response.json().catch(() => null)) as SupportSubmissionResponse | null

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message ?? payload?.message ?? 'Could not submit your request.')
  }

  return payload
}
