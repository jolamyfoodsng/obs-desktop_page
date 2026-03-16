import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useState } from 'react'

import type { InstallProgressEvent, InstallResponse } from '../types/desktop'
import type { PluginCatalogEntry } from '../types/plugin'
import { isScriptPlugin } from '../lib/utils'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { CopyPathField } from './ui/CopyPathField'

type InstallModalState =
  | 'preparing'
  | 'downloading'
  | 'extracting'
  | 'installing'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'review'
  | 'manual'

interface InstallProgressModalProps {
  plugin?: PluginCatalogEntry
  progress: InstallProgressEvent | null
  lastResponse: InstallResponse | null
  onClose: () => void
  onCancelInstall?: () => void
  onOpenInstallFolder?: () => void
  onOpenInstallerManually?: () => void
  onOpenSource?: () => void
  onViewPlugin?: () => void
  isCanceling?: boolean
}

function ProgressSteps({
  currentStage,
}: {
  currentStage: InstallProgressEvent['stage']
}) {
  const steps = [
    { key: 'preparing', label: 'Preparing' },
    { key: 'downloading', label: 'Downloading' },
    { key: 'verifying', label: 'Verifying' },
    { key: 'extracting', label: 'Extracting' },
    { key: 'inspecting', label: 'Inspecting package' },
    { key: 'installing', label: 'Installing' },
    { key: 'launching-installer', label: 'Launching installer' },
  ] as const

  const activeIndex = (() => {
    switch (currentStage) {
      case 'preparing':
        return 0
      case 'downloading':
        return 1
      case 'verifying':
        return 2
      case 'extracting':
        return 3
      case 'inspecting':
      case 'review':
        return 4
      case 'launching-installer':
        return 6
      default:
        return 5
    }
  })()

  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <div
          className={[
            'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
            index < activeIndex
              ? 'border-primary/20 bg-primary/10 text-white'
              : index === activeIndex
                ? 'border-white/10 bg-white/[0.05] text-white'
                : 'border-white/10 bg-white/[0.02] text-slate-500',
          ].join(' ')}
          key={step.key}
        >
          <span
            className={[
              'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
              index <= activeIndex ? 'bg-primary text-white' : 'bg-white/10 text-slate-500',
            ].join(' ')}
          >
            {index + 1}
          </span>
          <span>{step.label}</span>
        </div>
      ))}
    </div>
  )
}

function resolveInstallModalState(
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

export function InstallProgressModal({
  lastResponse,
  onClose,
  onCancelInstall,
  onOpenInstallFolder,
  onOpenInstallerManually,
  onOpenSource,
  onViewPlugin,
  plugin,
  progress,
  isCanceling = false,
}: InstallProgressModalProps) {
  const [confirmingClose, setConfirmingClose] = useState(false)

  if (!progress) {
    return null
  }

  const installState = resolveInstallModalState(progress, lastResponse)
  const isTerminal = progress.terminal ?? false
  const isError = installState === 'failed'
  const isCanceled = installState === 'cancelled'
  const isReview = installState === 'review'
  const isManual = installState === 'manual'
  const isSuccess = installState === 'success'
  const installerStarted = Boolean(lastResponse?.installerStarted)
  const isActiveInstall =
    !isTerminal &&
    installState !== 'success' &&
    installState !== 'failed' &&
    installState !== 'cancelled' &&
    installState !== 'review' &&
    installState !== 'manual'
  const canCancel = isActiveInstall && Boolean(onCancelInstall)
  const isDownloadPhase =
    installState === 'preparing' || installState === 'downloading'
  const cancelLabel = isDownloadPhase ? 'Cancel download' : 'Stop install safely'
  const isScriptInstall = isScriptPlugin(
    plugin,
    lastResponse?.installedPlugin,
    lastResponse?.selectedAssetName,
  )
  const scriptFilePath =
    lastResponse?.installedPlugin?.sourceType === 'script'
      ? (lastResponse.downloadPath ??
        lastResponse.installedPlugin.downloadPath ??
        null)
      : null

  const title = (() => {
    if (isError) {
      return 'Installation failed'
    }

    if (isCanceled) {
      return 'Installation canceled'
    }

    if (isReview) {
      return 'Review required'
    }

    if (isManual) {
      return installerStarted ? 'Installer started' : 'Installer downloaded'
    }

    if (isSuccess && isScriptInstall) {
      return 'OBS Script Installed'
    }

    if (isSuccess) {
      return 'Installation completed'
    }

    return 'Installing plugin'
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06070b]/68 p-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-background-dark p-5 shadow-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {plugin ? `${plugin.name} • v${plugin.version}` : 'Preparing installation'}
            </p>
          </div>
          <button
            className="rounded-lg border border-white/10 p-2 text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-white"
            onClick={() => {
              if (canCancel) {
                setConfirmingClose(true)
                return
              }

              onClose()
            }}
            type="button"
            disabled={isCanceling}
          >
            <X className="size-4" />
          </button>
        </div>

        {isSuccess && isScriptInstall ? (
          <div className="mt-5 space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-4">
              <CheckCircle2 className="mt-0.5 size-5 text-emerald-300" />
              <div>
                <p className="text-sm text-slate-200">
                  The script was copied to your OBS scripts directory.
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  In OBS: <strong>Tools → Scripts → + → select the file</strong>.
                </p>
              </div>
            </div>

            {scriptFilePath ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Installed file path
                </p>
                <CopyPathField className="mt-2" value={scriptFilePath} />
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {onOpenInstallFolder ? (
                <Button variant="secondary" onClick={onOpenInstallFolder}>
                  <FolderOpen className="size-4" />
                  Open Scripts Folder
                </Button>
              ) : null}
              {onViewPlugin ? (
                <Button variant="outline" onClick={onViewPlugin}>
                  <ArrowRight className="size-4" />
                  View Plugin Details
                </Button>
              ) : null}
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {isError ? (
              <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
                <AlertCircle className="mt-0.5 size-5 text-red-300" />
                <div>
                  <p className="text-sm font-semibold text-white">The install was stopped safely.</p>
                  <p className="mt-1 text-sm leading-7 text-slate-300">
                    {progress.detail ?? progress.message}
                  </p>
                </div>
              </div>
            ) : isCanceled ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-amber-400/20 bg-amber-500/10 p-4">
                  <AlertCircle className="mt-0.5 size-5 text-amber-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">Download canceled</p>
                    <p className="mt-1 text-sm leading-7 text-slate-300">
                      Download canceled. No files were installed.
                    </p>
                    {progress.detail && progress.detail !== 'Download canceled. No files were installed.' ? (
                      <p className="mt-2 text-sm leading-7 text-slate-400">
                        {progress.detail}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {onViewPlugin ? (
                    <Button variant="outline" onClick={onViewPlugin}>
                      <ArrowRight className="size-4" />
                      View Plugin Details
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            ) : isReview ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-4">
                  <p className="text-sm font-semibold text-white">The package needs review.</p>
                  <p className="mt-1 text-sm leading-7 text-slate-300">
                    {lastResponse?.reviewPlan?.summary ?? progress.detail ?? progress.message}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {onOpenSource ? (
                    <Button variant="secondary" onClick={onOpenSource}>
                      <ExternalLink className="size-4" />
                      Open Source Page
                    </Button>
                  ) : null}
                  {onViewPlugin ? (
                    <Button variant="outline" onClick={onViewPlugin}>
                      <ArrowRight className="size-4" />
                      View Plugin Details
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            ) : isManual ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-4">
                  <p className="text-sm font-semibold text-white">
                    {installerStarted
                      ? 'The installer started successfully.'
                      : 'The installer is ready to open manually.'}
                  </p>
                  <p className="mt-1 text-sm leading-7 text-slate-300">
                    {progress.detail ?? progress.message}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {onOpenInstallerManually ? (
                    <Button variant="secondary" onClick={onOpenInstallerManually}>
                      <FolderOpen className="size-4" />
                      Open installer manually
                    </Button>
                  ) : null}
                  {onOpenSource ? (
                    <Button variant="outline" onClick={onOpenSource}>
                      <ExternalLink className="size-4" />
                      View Source Page
                    </Button>
                  ) : null}
                  {onViewPlugin ? (
                    <Button variant="outline" onClick={onViewPlugin}>
                      <ArrowRight className="size-4" />
                      View Plugin Details
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            ) : isSuccess ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-4">
                  <CheckCircle2 className="mt-0.5 size-5 text-emerald-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {lastResponse?.message ?? 'The install completed successfully.'}
                    </p>
                    <p className="mt-1 text-sm leading-7 text-slate-300">
                      {progress.detail ?? progress.message}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {onViewPlugin ? (
                    <Button variant="outline" onClick={onViewPlugin}>
                      <ArrowRight className="size-4" />
                      View Plugin Details
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <Download className="mt-0.5 size-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-white">{progress.message}</p>
                    <p className="mt-1 text-sm text-slate-300">{progress.detail}</p>
                  </div>
                </div>

                <ProgressSteps currentStage={progress.stage} />

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                    <span>Progress</span>
                    <span>{progress.progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${progress.progress}%` }}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="flex items-center gap-2">
                    {canCancel ? (
                      <Button
                        disabled={isCanceling}
                        variant="outline"
                        onClick={() => void onCancelInstall?.()}
                      >
                        {isCanceling ? 'Canceling…' : cancelLabel}
                      </Button>
                    ) : null}
                    <Badge tone="neutral">
                    <ShieldCheck className="size-3.5" />
                    Safe install workflow
                    </Badge>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        cancelLabel="Keep installing"
        confirmLabel={cancelLabel}
        description={
          isDownloadPhase
            ? 'This will stop the current download, remove any partial file, and return the plugin to a retryable state.'
            : 'This will stop the install after the current step, clean temporary files where possible, and leave the plugin ready to retry.'
        }
        isBusy={isCanceling}
        onCancel={() => setConfirmingClose(false)}
        onConfirm={() => {
          setConfirmingClose(false)
          void onCancelInstall?.()
        }}
        open={confirmingClose}
        title={cancelLabel}
      />
    </div>
  )
}
