import { Download, ExternalLink, LoaderCircle, ShieldAlert } from 'lucide-react'

import { Button } from './ui/Button'
import type {
  AppUpdateProgressEvent,
  AppUpdateSnapshot,
  AppUpdateStatus,
} from '../types/desktop'

interface RequiredUpdateScreenProps {
  snapshot: AppUpdateSnapshot
  status: AppUpdateStatus
  progress: AppUpdateProgressEvent | null
  isApplying: boolean
  canBypass: boolean
  onBypass: () => void
  onDownload: () => void
  onInstall: () => void
  onRetry: () => void
  onOpenManualFallback?: () => void
}

function progressWidth(progress: AppUpdateProgressEvent | null, status: AppUpdateStatus) {
  if (status === 'ready-to-restart') {
    return 100
  }

  if (typeof progress?.progressPercent === 'number') {
    return Math.max(progress.progressPercent, 8)
  }

  return status === 'downloading' ? 24 : 12
}

export function RequiredUpdateScreen({
  snapshot,
  status,
  progress,
  isApplying,
  canBypass,
  onBypass,
  onDownload,
  onInstall,
  onRetry,
  onOpenManualFallback,
}: RequiredUpdateScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-dark px-4 py-8">
      <div className="w-full max-w-3xl rounded-[32px] border border-amber-400/20 bg-white/[0.03] p-7 shadow-panel">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-amber-500/12 p-3 text-amber-300">
            {status === 'downloading' ? (
              <LoaderCircle className="size-7 animate-spin" />
            ) : (
              <ShieldAlert className="size-7" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/80">
              Update required
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              {status === 'ready-to-restart' ? 'Restart to finish updating' : 'This app build needs an update'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">{snapshot.message}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">Required version</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                  v{snapshot.currentVersion}
                  {snapshot.latestVersion ? ` → v${snapshot.latestVersion}` : ''}
                </p>
              </div>
              {snapshot.selectedAssetName ? (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  {snapshot.selectedAssetName}
                </span>
              ) : null}
            </div>

            {snapshot.selectedAssetReason ? (
              <p className="mt-4 text-sm leading-6 text-slate-400">{snapshot.selectedAssetReason}</p>
            ) : null}

            {status === 'downloading' || status === 'ready-to-restart' ? (
              <div className="mt-5">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <span>{status === 'ready-to-restart' ? 'Update ready' : 'Downloading update'}</span>
                  <span>
                    {status === 'ready-to-restart'
                      ? '100%'
                      : progress?.progressPercent
                        ? `${Math.round(progress.progressPercent)}%`
                        : 'Working...'}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${progressWidth(progress, status)}%` }}
                  />
                </div>
              </div>
            ) : null}

            {snapshot.releaseNotes ? (
              <pre className="mt-5 max-h-56 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-[#0e1016] px-4 py-4 text-sm leading-6 text-slate-300">
                {snapshot.releaseNotes}
              </pre>
            ) : null}
          </section>

          <aside className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-sm font-semibold text-white">Next step</p>
            <p className="mt-2 text-sm leading-7 text-slate-400">
              {status === 'ready-to-restart'
                ? 'The update package is ready. Restart the app to finish the installation.'
                : status === 'downloading'
                  ? 'Downloading the latest version. Please wait...'
                  : 'Get the latest features and security updates for OBS Plugin Installer.'}
            </p>

            <div className="mt-6 space-y-2">
              {status === 'update-available' || status === 'update-required' || status === 'failed' ? (
                <Button className="w-full justify-center gap-2" size="lg" onClick={onDownload}>
                  <Download className="size-4" />
                  Update now
                </Button>
              ) : null}

              {status === 'downloading' ? (
                <Button className="w-full justify-center gap-2" disabled size="lg">
                  <LoaderCircle className="size-4 animate-spin" />
                  Downloading...
                </Button>
              ) : null}

              {status === 'ready-to-restart' ? (
                <Button
                  className="w-full justify-center gap-2"
                  disabled={isApplying}
                  size="lg"
                  variant="primary"
                  onClick={onInstall}
                >
                  <Download className="size-4" />
                  {isApplying ? 'Installing...' : 'Restart and install'}
                </Button>
              ) : null}

              {status === 'failed' && onOpenManualFallback && snapshot.selectedAssetUrl ? (
                <Button className="w-full justify-center gap-2" variant="secondary" onClick={onOpenManualFallback}>
                  <ExternalLink className="size-4" />
                  Manual download
                </Button>
              ) : null}

              {canBypass ? (
                <Button className="w-full justify-center" variant="ghost" onClick={onBypass}>
                  Continue anyway (dev only)
                </Button>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
