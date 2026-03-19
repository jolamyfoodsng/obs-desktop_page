import type { InstallProgressEvent, InstallResponse } from '../types/desktop'

export type InstallModalState =
  | 'preparing'
  | 'downloading'
  | 'extracting'
  | 'installing'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'review'
  | 'manual'

export type InstallProgressTone = 'active' | 'success' | 'warning' | 'danger'

export function resolveInstallModalState(
  progress: InstallProgressEvent,
  lastResponse: InstallResponse | null,
): InstallModalState {
  if (progress.stage === 'canceled' || lastResponse?.code === 'CANCELED') {
    return 'cancelled'
  }

  if (progress.stage === 'error') {
    return 'failed'
  }

  if (progress.stage === 'review' || Boolean(lastResponse?.reviewPlan)) {
    return 'review'
  }

  if (progress.stage === 'manual') {
    return 'manual'
  }

  if (progress.stage === 'completed' && lastResponse?.success) {
    return 'success'
  }

  if (progress.stage === 'preparing') {
    return 'preparing'
  }

  if (progress.stage === 'downloading' || progress.stage === 'verifying') {
    return 'downloading'
  }

  if (progress.stage === 'extracting' || progress.stage === 'inspecting') {
    return 'extracting'
  }

  return 'installing'
}

export function summarizeInstallProgress(
  pluginName: string | null | undefined,
  progress: InstallProgressEvent,
  lastResponse: InstallResponse | null,
): {
  label: string
  status: string
  detail: string | null
  percentLabel: string
  tone: InstallProgressTone
} {
  const state = resolveInstallModalState(progress, lastResponse)
  const label = pluginName?.trim() || 'Plugin installation'

  switch (state) {
    case 'success':
      return {
        label,
        status: 'Installed successfully',
        detail: progress.detail ?? lastResponse?.message ?? null,
        percentLabel: 'Done',
        tone: 'success',
      }
    case 'failed':
      return {
        label,
        status: 'Installation failed',
        detail: progress.detail ?? progress.message ?? lastResponse?.message ?? null,
        percentLabel: 'Failed',
        tone: 'danger',
      }
    case 'cancelled':
      return {
        label,
        status: 'Installation canceled',
        detail: progress.detail ?? lastResponse?.message ?? null,
        percentLabel: 'Canceled',
        tone: 'warning',
      }
    case 'review':
      return {
        label,
        status: 'Review required',
        detail: lastResponse?.reviewPlan?.summary ?? progress.detail ?? progress.message ?? null,
        percentLabel: 'Review',
        tone: 'warning',
      }
    case 'manual':
      return {
        label,
        status: lastResponse?.installerStarted
          ? 'Waiting for installer to complete'
          : 'Installer ready to open',
        detail:
          progress.detail ??
          (lastResponse?.installerStarted
            ? 'Complete the installer in the external window to continue.'
            : 'Open the downloaded installer to continue.'),
        percentLabel: lastResponse?.installerStarted ? 'Waiting' : 'Ready',
        tone: 'warning',
      }
    default:
      return {
        label,
        status: progress.message,
        detail: progress.detail ?? null,
        percentLabel: `${progress.progress}%`,
        tone: 'active',
      }
  }
}
