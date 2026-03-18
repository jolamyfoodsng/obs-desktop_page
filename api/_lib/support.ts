import type { VercelRequest, VercelResponse } from '@vercel/node'

const DEFAULT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 5
const MEMORY_RATE_LIMIT = new Map<string, { count: number; resetAt: number }>()

export type SupportSubmissionKind = 'problem-report' | 'general-feedback' | 'plugin-request'

export interface SupportSubmissionPayload {
  kind: SupportSubmissionKind
  email?: string | null
  subject?: string | null
  message: string
  pluginUrl?: string | null
  obsVersion?: string | null
  appVersion?: string | null
  platform?: string | null
  installId?: string | null
}

export interface NormalizedSupportSubmission {
  kind: SupportSubmissionKind
  email: string | null
  subject: string | null
  message: string
  pluginUrl: string | null
  obsVersion: string | null
  appVersion: string | null
  platform: string | null
  installId: string | null
}

function json(response: VercelResponse, status: number, payload: Record<string, unknown>) {
  response.status(status).json(payload)
}

export function sendSupportError(response: VercelResponse, status: number, message: string, field?: string) {
  return json(response, status, {
    ok: false,
    error: {
      message,
      field: field ?? null,
    },
  })
}

export function sendSupportSuccess(response: VercelResponse) {
  return json(response, 200, {
    ok: true,
    message: 'Submission received.',
  })
}

function trimToNull(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isValidEmail(value: string | null) {
  if (!value) {
    return true
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isValidHttpUrl(value: string | null) {
  if (!value) {
    return true
  }

  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function getRateLimitKey(request: VercelRequest) {
  const forwardedFor = request.headers['x-forwarded-for']
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]
  const remoteAddress = request.socket.remoteAddress
  return (firstForwarded ?? remoteAddress ?? 'unknown').trim()
}

export function enforceSupportRateLimit(request: VercelRequest, response: VercelResponse) {
  const key = getRateLimitKey(request)
  const now = Date.now()
  const existing = MEMORY_RATE_LIMIT.get(key)

  if (!existing || existing.resetAt <= now) {
    MEMORY_RATE_LIMIT.set(key, {
      count: 1,
      resetAt: now + DEFAULT_RATE_LIMIT_WINDOW_MS,
    })
    response.setHeader('X-RateLimit-Limit', String(DEFAULT_RATE_LIMIT_MAX_REQUESTS))
    response.setHeader('X-RateLimit-Remaining', String(DEFAULT_RATE_LIMIT_MAX_REQUESTS - 1))
    return null
  }

  if (existing.count >= DEFAULT_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    response.setHeader('Retry-After', String(retryAfterSeconds))
    response.setHeader('X-RateLimit-Limit', String(DEFAULT_RATE_LIMIT_MAX_REQUESTS))
    response.setHeader('X-RateLimit-Remaining', '0')
    return sendSupportError(response, 429, 'Too many submissions right now. Please try again in a few minutes.')
  }

  existing.count += 1
  MEMORY_RATE_LIMIT.set(key, existing)
  response.setHeader('X-RateLimit-Limit', String(DEFAULT_RATE_LIMIT_MAX_REQUESTS))
  response.setHeader('X-RateLimit-Remaining', String(Math.max(0, DEFAULT_RATE_LIMIT_MAX_REQUESTS - existing.count)))
  return null
}

export function validateSupportSubmission(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: { message: 'Request body must be a JSON object.' } }
  }

  const candidate = payload as Record<string, unknown>
  const kind = trimToNull(candidate.kind)
  const email = trimToNull(candidate.email)
  const subject = trimToNull(candidate.subject)
  const message = trimToNull(candidate.message)
  const pluginUrl = trimToNull(candidate.pluginUrl)
  const obsVersion = trimToNull(candidate.obsVersion)
  const appVersion = trimToNull(candidate.appVersion)
  const platform = trimToNull(candidate.platform)
  const installId = trimToNull(candidate.installId)
  const honeypot = trimToNull(candidate.company)

  if (honeypot) {
    return { error: { message: 'Spam check failed.' } }
  }

  if (kind !== 'problem-report' && kind !== 'general-feedback' && kind !== 'plugin-request') {
    return { error: { field: 'kind', message: 'Submission kind is invalid.' } }
  }

  if (!message) {
    return { error: { field: 'message', message: 'Please enter a message.' } }
  }

  if (message.length < 10) {
    return { error: { field: 'message', message: 'Please add a bit more detail before submitting.' } }
  }

  if (message.length > 4000) {
    return { error: { field: 'message', message: 'Message is too long.' } }
  }

  if (subject && subject.length > 160) {
    return { error: { field: 'subject', message: 'Subject is too long.' } }
  }

  if (!isValidEmail(email)) {
    return { error: { field: 'email', message: 'Email address looks invalid.' } }
  }

  if (kind === 'plugin-request') {
    if (!pluginUrl) {
      return { error: { field: 'pluginUrl', message: 'Please include the plugin link you want reviewed.' } }
    }

    if (!isValidHttpUrl(pluginUrl)) {
      return { error: { field: 'pluginUrl', message: 'Plugin link must be a valid http or https URL.' } }
    }
  } else if (pluginUrl && !isValidHttpUrl(pluginUrl)) {
    return { error: { field: 'pluginUrl', message: 'Plugin link must be a valid http or https URL.' } }
  }

  return {
    value: {
      kind,
      email,
      subject,
      message,
      pluginUrl,
      obsVersion,
      appVersion,
      platform,
      installId,
    } satisfies NormalizedSupportSubmission,
  }
}

function labelForKind(kind: SupportSubmissionKind) {
  switch (kind) {
    case 'problem-report':
      return 'Problem report'
    case 'plugin-request':
      return 'Plugin request'
    default:
      return 'General feedback'
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function detailRow(label: string, value: string | null) {
  return `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;">${value ? escapeHtml(value) : '—'}</td></tr>`
}

export async function deliverSupportSubmission(submission: NormalizedSupportSubmission) {
  const resendApiKey = process.env.RESEND_API_KEY?.trim()
  const supportInbox = process.env.SUPPORT_INBOX_EMAIL?.trim()
  const fromEmail = process.env.SUPPORT_FROM_EMAIL?.trim()

  if (!resendApiKey || !supportInbox || !fromEmail) {
    throw new Error('Support email relay is not configured. Set RESEND_API_KEY, SUPPORT_INBOX_EMAIL, and SUPPORT_FROM_EMAIL.')
  }

  const subjectPrefix = `[OBS Plugin Installer] ${labelForKind(submission.kind)}`
  const emailSubject = submission.subject ? `${subjectPrefix}: ${submission.subject}` : subjectPrefix
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f172a;line-height:1.6;">
      <h2 style="margin-bottom:12px;">${escapeHtml(labelForKind(submission.kind))}</h2>
      <table style="border-collapse:collapse;margin-bottom:20px;">
        ${detailRow('Reply email', submission.email)}
        ${detailRow('Plugin URL', submission.pluginUrl)}
        ${detailRow('OBS version', submission.obsVersion)}
        ${detailRow('App version', submission.appVersion)}
        ${detailRow('Platform', submission.platform)}
        ${detailRow('Install ID', submission.installId)}
      </table>
      <p style="font-weight:600;margin-bottom:8px;">Message</p>
      <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">${escapeHtml(submission.message)}</pre>
    </div>
  `

  const text = [
    labelForKind(submission.kind),
    '',
    `Reply email: ${submission.email ?? '—'}`,
    `Plugin URL: ${submission.pluginUrl ?? '—'}`,
    `OBS version: ${submission.obsVersion ?? '—'}`,
    `App version: ${submission.appVersion ?? '—'}`,
    `Platform: ${submission.platform ?? '—'}`,
    `Install ID: ${submission.installId ?? '—'}`,
    '',
    'Message:',
    submission.message,
  ].join('\n')

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [supportInbox],
      reply_to: submission.email ?? undefined,
      subject: emailSubject,
      html,
      text,
    }),
  })

  if (!resendResponse.ok) {
    const body = await resendResponse.text()
    throw new Error(`Resend request failed with status ${resendResponse.status}. ${body}`)
  }
}
