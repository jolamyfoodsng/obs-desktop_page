import { Download, ExternalLink, RefreshCw, Sparkles } from 'lucide-react'

import { Button } from './ui/Button'
import type {
  AppUpdateProgressEvent,
  AppUpdateSnapshot,
  AppUpdateStatus,
} from '../types/desktop'

interface AppUpdateDialogProps {
  snapshot: AppUpdateSnapshot
  status: AppUpdateStatus
  progress: AppUpdateProgressEvent | null
  isApplying: boolean
  isRequired: boolean
  onDismiss: () => void
  onDownload: () => void
  onInstall: () => void
  onRetry: () => void
  onOpenManualFallback?: () => void
}

function renderProgressLabel(progress: AppUpdateProgressEvent | null) {
  if (!progress) {
    return 'Preparing update…'
  }

  if (typeof progress.progressPercent === 'number') {
    return `${Math.round(progress.progressPercent)}%`
  }

  if (progress.totalBytes) {
    const downloadedMb = (progress.downloadedBytes / (1024 * 1024)).toFixed(1)
    const totalMb = (progress.totalBytes / (1024 * 1024)).toFixed(1)
    return `${downloadedMb} MB / ${totalMb} MB`
  }

  return progress.message
}

export function AppUpdateDialog({
  snapshot,
  status,
  progress,
  isApplying,
  isRequired,
  onDismiss,
  onDownload,
  onInstall,
  onRetry,
  onOpenManualFallback,
}: AppUpdateDialogProps) {
  if (status === 'no-update' || status === 'disabled' || status === 'idle' || status === 'checking') {
    return null
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-end bg-[#06070b]/36 p-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-background-dark p-5 shadow-panel">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary/12 p-3 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
              {isRequired ? 'Update required' : 'Update available'}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
              {status === 'ready-to-restart'
                ? 'Restart to finish updating'
                : isRequired
                  ? 'This app build needs an update'
                  : 'A newer app build is ready'}
            </h2>
            <p className="mt-2 text-sm leading-7 text-slate-400">{snapshot.message}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-white">
                v{snapshot.currentVersion}
                {snapshot.latestVersion ? ` → v${snapshot.latestVersion}` : ''}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                Channel: {snapshot.updateChannel}
              </p>
            </div>
            {snapshot.selectedAssetName ? (
              <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {snapshot.selectedAssetName}
              </span>
            ) : null}
          </div>

          {snapshot.selectedAssetReason ? (
            <p className="mt-3 text-sm leading-6 text-slate-400">{snapshot.selectedAssetReason}</p>
          ) : null}

          {status === 'downloading' || status === 'ready-to-restart' ? (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span>Download</span>
                <span>{renderProgressLabel(progress)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(progress?.progressPercent ?? (status === 'ready-to-restart' ? 100 : 8), 8)}%` }}
                />
              </div>
            </div>
          ) : null}

          {snapshot.releaseNotes ? (
            <p className="mt-4 max-h-28 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-400">
              {snapshot.releaseNotes}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {status === 'update-available' || status === 'update-required' ? (
            <>
              {!isRequired ? (
                <Button variant="secondary" onClick={onDismiss}>
                  Remind me later
                </Button>
              ) : null}
              <Button onClick={onDownload}>
                <Download className="size-4" />
                Update
              </Button>
            </>
          ) : null}

          {status === 'downloading' ? (
            <Button disabled>
              <RefreshCw className="size-4 animate-spin" />
              Downloading update...
            </Button>
          ) : null}

          {status === 'ready-to-restart' ? (
            <Button disabled={isApplying} onClick={onInstall}>
              <RefreshCw className="size-4" />
              {isApplying ? 'Applying update...' : 'Restart to finish updating'}
            </Button>
          ) : null}

          {status === 'failed' ? (
            <>
              {onOpenManualFallback && snapshot.selectedAssetUrl ? (
                <Button variant="secondary" onClick={onOpenManualFallback}>
                  <ExternalLink className="size-4" />
                  Manual download
                </Button>
              ) : null}
              <Button onClick={onRetry}>
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
