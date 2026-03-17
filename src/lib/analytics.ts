import posthog from 'posthog-js'
import packageJson from '../../package.json'
import { getOrCreateInstallId } from './installId'
import { desktopApi } from './tauri'

import type { BootstrapPayload, InstalledPluginRecord } from '../types/desktop'
import type { PluginCatalogEntry } from '../types/plugin'

const POSTHOG_PROJECT_KEY =
  import.meta.env.VITE_POSTHOG_PROJECT_KEY ?? 'POSTHOG_PROJECT_KEY'

const POSTHOG_API_HOST =
  import.meta.env.VITE_POSTHOG_API_HOST ?? 'https://us.i.posthog.com'

const APP_VERSION = packageJson.version
const ANALYTICS_ENVIRONMENT = 'desktop'
const PERSON_PROFILE_MODE = 'always' as const

type TrackableEventName =
  | 'app_open'
  | 'plugin_search'
  | 'plugin_view'
  | 'plugin_install_start'
  | 'plugin_install_success'
  | 'plugin_install_fail'
  | 'update_check'
  | 'update_success'

let analyticsInitPromise: Promise<void> | null = null
let activeDistinctId: string | null = null
let startupEventTracked = false
let bridgedIdentityDistinctId: string | null = null
let posthogJsReady = false
let posthogJsInitAttempted = false

function isAnalyticsConfigured() {
  return (
    typeof window !== 'undefined' &&
    POSTHOG_PROJECT_KEY.trim().length > 0 &&
    POSTHOG_PROJECT_KEY !== 'POSTHOG_PROJECT_KEY'
  )
}

if (typeof window !== 'undefined' && !isAnalyticsConfigured()) {
  console.warn(
    '[analytics] PostHog is disabled. Set VITE_POSTHOG_PROJECT_KEY in .env.local and restart the app.',
  )
}

function inferRuntimePlatform() {
  if (typeof window === 'undefined') {
    return 'unknown'
  }

  const navigatorWithUserAgentData = window.navigator as Navigator & {
    userAgentData?: {
      platform?: string
    }
  }

  return (
    navigatorWithUserAgentData.userAgentData?.platform ??
    window.navigator.platform ??
    'unknown'
  )
}

function resolveAnalyticsDistinctId(userAccountId?: string | null) {
  const normalizedAccountId = userAccountId?.trim()
  if (normalizedAccountId) {
    return normalizedAccountId
  }

  return getOrCreateInstallId()
}

function scheduleAnalyticsTask(task: () => void | Promise<void>) {
  if (typeof window === 'undefined') {
    return
  }

  window.setTimeout(() => {
    void Promise.resolve(task()).catch(() => {
      // Analytics must never interrupt desktop workflows.
    })
  }, 0)
}

function buildEventPayload(
  eventName: TrackableEventName,
  properties: Record<string, unknown>,
) {
  const distinctId = activeDistinctId ?? resolveAnalyticsDistinctId()

  return {
    api_key: POSTHOG_PROJECT_KEY,
    event: eventName,
    distinct_id: distinctId,
    person_profiles: PERSON_PROFILE_MODE,
    properties: {
      ...properties,
      distinct_id: distinctId,
      app_version: APP_VERSION,
      platform: inferRuntimePlatform(),
      environment: ANALYTICS_ENVIRONMENT,
      install_id: getOrCreateInstallId(),
    },
    timestamp: new Date().toISOString(),
  }
}

async function captureWithFetch(
  eventName: TrackableEventName,
  properties: Record<string, unknown>,
) {
  if (typeof window === 'undefined') {
    return
  }

  const payload = buildEventPayload(eventName, properties)
  await desktopApi.captureAnalyticsEvent({
    apiKey: payload.api_key,
    apiHost: POSTHOG_API_HOST,
    eventName: eventName,
    distinctId: payload.distinct_id,
    timestamp: payload.timestamp,
    personProfiles: payload.person_profiles,
    properties: payload.properties,
  })
}

function captureWithJs(
  eventName: TrackableEventName,
  properties: Record<string, unknown>,
) {
  if (!posthogJsReady) {
    return
  }

  try {
    posthog.capture(eventName, {
      ...properties,
      app_version: APP_VERSION,
      platform: inferRuntimePlatform(),
      environment: ANALYTICS_ENVIRONMENT,
      install_id: getOrCreateInstallId(),
    })
  } catch (error) {
    console.warn('[analytics] posthog-js capture failed', error)
  }
}

async function identifyWithDesktopBridge(userAccountId?: string | null) {
  const distinctId = resolveAnalyticsDistinctId(userAccountId)
  const identityType = userAccountId?.trim() ? 'account' : 'install'

  if (bridgedIdentityDistinctId === distinctId) {
    return
  }

  await desktopApi.captureAnalyticsEvent({
    apiKey: POSTHOG_PROJECT_KEY,
    apiHost: POSTHOG_API_HOST,
    eventName: '$identify',
    distinctId,
    timestamp: new Date().toISOString(),
    personProfiles: PERSON_PROFILE_MODE,
    properties: {
      distinct_id: distinctId,
      $anon_distinct_id: distinctId,
      $set: {
        app_version: APP_VERSION,
        platform: inferRuntimePlatform(),
        environment: ANALYTICS_ENVIRONMENT,
        install_id: getOrCreateInstallId(),
        analytics_identity_type: identityType,
      },
    },
  })

  bridgedIdentityDistinctId = distinctId
}

function applyAnalyticsIdentity(userAccountId?: string | null) {
  const distinctId = resolveAnalyticsDistinctId(userAccountId)
  const identityType = userAccountId?.trim() ? 'account' : 'install'

  activeDistinctId = distinctId

  if (!posthogJsReady) {
    return
  }

  try {
    posthog.identify(distinctId)
    posthog.register({
      app_version: APP_VERSION,
      platform: inferRuntimePlatform(),
      environment: ANALYTICS_ENVIRONMENT,
      analytics_identity_type: identityType,
      install_id: getOrCreateInstallId(),
    })
  } catch (error) {
    posthogJsReady = false
    console.warn('[analytics] posthog-js identity update failed', error)
  }
}

function initializePosthogJs() {
  if (posthogJsReady || posthogJsInitAttempted) {
    return
  }

  posthogJsInitAttempted = true

  try {
    posthog.init(POSTHOG_PROJECT_KEY, {
      api_host: POSTHOG_API_HOST,
      capture_pageview: true,
      autocapture: true,
      persistence: 'localStorage',
      request_batching: false,
      api_transport: 'fetch',
      person_profiles: PERSON_PROFILE_MODE,
    })
    posthogJsReady = true
  } catch (error) {
    posthogJsReady = false
    console.warn('[analytics] posthog-js init failed; desktop bridge will continue', error)
  }
}

async function initializeAnalytics(userAccountId?: string | null) {
  if (!isAnalyticsConfigured()) {
    return
  }

  if (!analyticsInitPromise) {
    analyticsInitPromise = Promise.resolve().then(() => {
      initializePosthogJs()
    })
  }

  await analyticsInitPromise

  applyAnalyticsIdentity(userAccountId)
  await identifyWithDesktopBridge(userAccountId)
}

scheduleAnalyticsTask(() => initializeAnalytics())

function inferObsVersion(bootstrap?: BootstrapPayload | null) {
  if (bootstrap?.obsDetection.obsVersion) {
    return bootstrap.obsDetection.obsVersion
  }

  const message = bootstrap?.obsDetection.message ?? ''
  const matchedVersion = message.match(/(?:OBS(?: Studio)?\s*v?)(\d+(?:\.\d+){0,2})/i)?.[1]
  return matchedVersion ?? 'unknown'
}

export function getAnalyticsContext(bootstrap?: BootstrapPayload | null) {
  return {
    platform: bootstrap?.currentPlatform ?? 'unknown',
    obsVersion: inferObsVersion(bootstrap),
    appVersion: bootstrap?.currentVersion ?? 'unknown',
    obsConfigured: Boolean(bootstrap?.settings.obsPath),
  }
}

export function getPluginAnalyticsProperties(
  plugin: PluginCatalogEntry | undefined | null,
  bootstrap?: BootstrapPayload | null,
  installedPlugin?: InstalledPluginRecord | null,
  extraProperties?: Record<string, unknown>,
) {
  return {
    ...getAnalyticsContext(bootstrap),
    pluginId: plugin?.id ?? installedPlugin?.pluginId ?? 'unknown',
    pluginName: plugin?.name ?? 'unknown',
    pluginVersion: plugin?.version ?? installedPlugin?.installedVersion ?? 'unknown',
    pluginCategory: plugin?.category ?? 'unknown',
    pluginAuthor: plugin?.author ?? 'unknown',
    installState: installedPlugin
      ? installedPlugin.managed
        ? 'managed'
        : 'external'
      : 'not-installed',
    ...extraProperties,
  }
}

export function trackEvent(
  eventName: TrackableEventName,
  properties: Record<string, unknown> = {},
) {
  scheduleAnalyticsTask(async () => {
    await initializeAnalytics()
    captureWithJs(eventName, properties)

    try {
      await captureWithFetch(eventName, properties)
    } catch (error) {
      console.warn('[analytics] capture failed', error)
    }
  })
}

export function trackAppOpenOnce(properties: Record<string, unknown> = {}) {
  if (startupEventTracked) {
    return
  }

  startupEventTracked = true
  trackEvent('app_open', properties)
}

export function identifyAnalytics(userAccountId?: string | null) {
  scheduleAnalyticsTask(async () => {
    await initializeAnalytics(userAccountId)
  })
}
