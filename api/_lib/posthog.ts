import { PostHog } from 'posthog-node'

type AnalyticsClient = Pick<PostHog, 'capture' | 'shutdown'>

const noopClient: AnalyticsClient = {
  capture() {},
  async shutdown() {},
}

let _client: AnalyticsClient | null = null

export function getPostHogClient(): AnalyticsClient {
  const key = process.env.POSTHOG_KEY?.trim()
  if (!key) {
    return noopClient
  }

  if (!_client) {
    _client = new PostHog(key, {
      host: process.env.POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    })
  }

  return _client
}

export function safeCapture(client: AnalyticsClient, ...args: Parameters<AnalyticsClient['capture']>) {
  try {
    client.capture(...args)
  } catch (error) {
    console.warn('[analytics-api] capture failed', error)
  }
}

export async function safeShutdown(client: AnalyticsClient) {
  try {
    await client.shutdown()
  } catch (error) {
    console.warn('[analytics-api] shutdown failed', error)
  }
}
