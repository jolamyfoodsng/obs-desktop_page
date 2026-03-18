const STORAGE_KEY = 'app_install_id'

let fallbackInstallId: string | null = null

function generateInstallId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function getOrCreateInstallId() {
  if (typeof window === 'undefined') {
    if (!fallbackInstallId) {
      fallbackInstallId = generateInstallId()
    }

    return fallbackInstallId
  }

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing) {
      return existing
    }

    const created = generateInstallId()
    window.localStorage.setItem(STORAGE_KEY, created)
    return created
  } catch {
    if (!fallbackInstallId) {
      fallbackInstallId = generateInstallId()
    }

    return fallbackInstallId
  }
}

