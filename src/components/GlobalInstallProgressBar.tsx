import { CheckCircle2, LoaderCircle, TriangleAlert, X } from 'lucide-react'

import type { InstallProgressEvent, InstallResponse } from '../types/desktop'
import { summarizeInstallProgress } from '../lib/installProgress'

interface GlobalInstallProgressBarProps {
  pluginName?: string | null
  progress: InstallProgressEvent
  lastResponse: InstallResponse | null
  onOpenDetails: () => void
  onClear?: () => void
}

export function GlobalInstallProgressBar({
  pluginName,
  progress,
  lastResponse,
  onOpenDetails,
  onClear,
}: GlobalInstallProgressBarProps) {
  const summary = summarizeInstallProgress(pluginName, progress, lastResponse)
  const isTerminal = progress.terminal ?? false
  const wrapperClassName =
    summary.tone === 'success'
      ? 'border-emerald-400/25 bg-emerald-500/10'
      : summary.tone === 'danger'
        ? 'border-rose-400/25 bg-rose-500/10'
        : summary.tone === 'warning'
          ? 'border-amber-400/25 bg-amber-500/10'
          : 'border-primary/20 bg-primary/10'
  const progressBarClassName =
    summary.tone === 'success'
      ? 'bg-emerald-400'
      : summary.tone === 'danger'
        ? 'bg-rose-400'
        : summary.tone === 'warning'
          ? 'bg-amber-300'
          : 'bg-primary'
  const StatusIcon =
    summary.tone === 'success'
      ? CheckCircle2
      : summary.tone === 'danger' || summary.tone === 'warning'
        ? TriangleAlert
        : LoaderCircle

  return (
    <div className={`mx-4 mt-3 rounded-xl border md:mx-6 ${wrapperClassName}`}>
      <div className="flex items-start gap-3 p-3">
        <button
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={onOpenDetails}
          type="button"
        >
          <div className="mt-0.5 rounded-full bg-white/10 p-2 text-white">
            <StatusIcon className={`size-4 ${summary.tone === 'active' ? 'animate-spin' : ''}`} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{summary.label}</p>
                <p className="mt-0.5 text-xs text-slate-200">{summary.status}</p>
              </div>
              <div className="shrink-0 text-xs font-medium uppercase tracking-[0.18em] text-slate-200/90">
                {summary.percentLabel}
              </div>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/20">
              <div
                className={`h-full rounded-full transition-all ${progressBarClassName}`}
                style={{ width: `${Math.max(progress.progress, isTerminal ? 100 : 6)}%` }}
              />
            </div>

            {summary.detail ? (
              <p className="mt-2 text-xs leading-6 text-slate-300">{summary.detail}</p>
            ) : null}

            <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-slate-400">
              Click to {isTerminal ? 'review details' : 'reopen progress'}
            </p>
          </div>
        </button>

        {isTerminal && onClear ? (
          <button
            className="rounded-lg border border-white/10 p-2 text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-white"
            onClick={onClear}
            title="Dismiss install status"
            type="button"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
