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
import { resolveInstallModalState } from '../lib/installProgress'
import {
  getInstalledThemeLayout,
  getPluginTypeLabel,
  isScriptPlugin,
  isThemeResource,
  resolveInstalledLocationEntries,
  resolvePrimaryEntryFiles,
} from '../lib/utils'
import { InstallLocationSection } from './InstallLocationSection'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { CopyPathField } from './ui/CopyPathField'
import { InstallErrorPanel } from './InstallErrorPanel'

interface InstallProgressModalProps {
  open: boolean
  plugin?: PluginCatalogEntry
  progress: InstallProgressEvent | null
  lastResponse: InstallResponse | null
  onHide: () => void
  onClear: () => void
  onCancelInstall?: () => void
  onOpenInstallLocation?: (path: string) => void
  onOpenInstallerManually?: () => void
  onOpenSource?: () => void
  onViewPlugin?: () => void
  onRetryInstall?: () => void
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

export function InstallProgressModal({
  open,
  lastResponse,
  onClear,
  onHide,
  onCancelInstall,
  onOpenInstallLocation,
  onOpenInstallerManually,
  onOpenSource,
  onViewPlugin,
  onRetryInstall,
  plugin,
  progress,
  isCanceling = false,
}: InstallProgressModalProps) {
  const [confirmingClose, setConfirmingClose] = useState(false)

  if (!progress || !open) {
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
  const isThemeInstall = isThemeResource(plugin)
  const pluginTypeLabel = getPluginTypeLabel(
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
  const resolvedEntryFiles = resolvePrimaryEntryFiles(plugin, lastResponse?.installedPlugin)
  const installLocationEntries = resolveInstalledLocationEntries(plugin, lastResponse?.installedPlugin)
  const primaryInstallLocation =
    installLocationEntries.find((entry) => entry.isPrimary) ?? installLocationEntries[0] ?? null
  const themeLayout = getInstalledThemeLayout(lastResponse?.installedPlugin)
  const needsFollowup =
    lastResponse?.installedPlugin?.status === 'manual-step' ||
    lastResponse?.installedPlugin?.verificationStatus === 'unverified' ||
    lastResponse?.installedPlugin?.verificationStatus === 'missing-files'
  const hasBundleFollowup =
    isSuccess &&
    !isScriptInstall &&
    Boolean(plugin?.obsFollowupSteps?.length || resolvedEntryFiles.length)
  const canOpenInstalledLocation =
    Boolean(onOpenInstallLocation) && Boolean(primaryInstallLocation)
  const handleDismiss = () => {
    if (isActiveInstall) {
      onHide()
      return
    }

    onClear()
  }

  const title = (() => {
    if (isError) {
      return 'Installation failed'
    }

    if (isCanceled) {
      return 'Installation canceled'
    }

    if (isReview) {
      return isThemeInstall ? 'Theme review required' : 'Review required'
    }

    if (isManual) {
      return installerStarted ? 'Waiting for installer to complete' : 'Installer downloaded'
    }

    if (isSuccess && isScriptInstall) {
      return 'OBS Script Installed'
    }

    if (isSuccess && needsFollowup) {
      return isThemeInstall ? 'Theme copied with follow-up required' : 'Install completed with follow-up required'
    }

    if (isSuccess) {
      return isThemeInstall ? 'Theme installed' : 'Installation completed'
    }

    return isThemeInstall ? 'Installing theme' : 'Installing plugin'
  })()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#06070b]/68 p-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleDismiss()
        }
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-background-dark p-5 shadow-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {plugin ? `${plugin.name} • ${pluginTypeLabel} • v${plugin.version}` : 'Preparing installation'}
            </p>
          </div>
          <button
            className="rounded-lg border border-white/10 p-2 text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-white"
            onClick={handleDismiss}
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
              {primaryInstallLocation ? (
                <Button
                  variant="secondary"
                  onClick={() => onOpenInstallLocation?.(primaryInstallLocation.path)}
                >
                  <FolderOpen className="size-4" />
                  {primaryInstallLocation.openLabel}
                </Button>
              ) : null}
              {onViewPlugin ? (
                <Button variant="outline" onClick={onViewPlugin}>
                  <ArrowRight className="size-4" />
                  View Plugin Details
                </Button>
              ) : null}
              <Button variant="ghost" onClick={onClear}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {isError ? (
              <InstallErrorPanel
                logs={progress.detail ?? progress.message}
                message={progress.message}
                onCopyLogs={
                  progress.detail || progress.message
                    ? () =>
                        void navigator.clipboard.writeText(
                          [progress.message, progress.detail].filter(Boolean).join('\n\n'),
                        )
                    : undefined
                }
                onReportIssue={onOpenSource}
                onRetry={onRetryInstall}
                pluginName={plugin?.name}
              />
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
                  <Button variant="ghost" onClick={onClear}>
                    Close
                  </Button>
                </div>
              </div>
            ) : isReview ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-4">
                  <p className="text-sm font-semibold text-white">
                    {isThemeInstall
                      ? 'This archive looks like an OBS theme package and needs review.'
                      : 'The package needs review.'}
                  </p>
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
                  <Button variant="ghost" onClick={onClear}>
                    Close
                  </Button>
                </div>
              </div>
            ) : isManual ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-4">
                  <p className="text-sm font-semibold text-white">
                    {installerStarted
                      ? 'The installer is running outside the app.'
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
                  <Button variant="ghost" onClick={onClear}>
                    Close
                  </Button>
                </div>
              </div>
            ) : isSuccess ? (
                <div className="space-y-4">
                <div
                  className={[
                    'flex items-start gap-3 rounded-lg border p-4',
                    needsFollowup
                      ? 'border-amber-400/20 bg-amber-500/10'
                      : 'border-emerald-400/20 bg-emerald-500/10',
                  ].join(' ')}
                >
                  {needsFollowup ? (
                    <AlertCircle className="mt-0.5 size-5 text-amber-300" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-5 text-emerald-300" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {lastResponse?.message ?? 'The install completed successfully.'}
                    </p>
                    <p className="mt-1 text-sm leading-7 text-slate-300">
                      {progress.detail ?? progress.message}
                    </p>
                  </div>
                </div>
                {installLocationEntries.length ? (
                  <InstallLocationSection
                    description={
                      isThemeInstall
                        ? themeLayout === 'legacy-qss'
                          ? 'Installed as an OBS theme package in your OBS themes folder. This package uses the legacy .qss theme format.'
                          : 'Installed as an OBS theme package in your OBS themes folder.'
                        : 'These are the tracked install locations for the completed install.'
                    }
                    locations={installLocationEntries}
                    title="Installed location"
                    onOpenLocation={
                      onOpenInstallLocation
                        ? (path) => onOpenInstallLocation(path)
                        : undefined
                    }
                  />
                ) : null}
                {hasBundleFollowup ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      OBS setup steps
                    </p>
                    <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-300">
                      {(plugin?.obsFollowupSteps ?? []).map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                    {resolvedEntryFiles.length ? (
                      <div className="mt-4 space-y-3">
                        {resolvedEntryFiles.map((entry) => (
                          <div key={entry.role} className="space-y-2">
                            <p className="text-sm text-slate-300">{entry.label}</p>
                            <CopyPathField value={entry.absolutePath} />
                            <CopyPathField value={entry.fileUrl} />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {canOpenInstalledLocation && primaryInstallLocation ? (
                    <Button
                      variant="secondary"
                      onClick={() => onOpenInstallLocation?.(primaryInstallLocation.path)}
                    >
                      <FolderOpen className="size-4" />
                      {primaryInstallLocation.openLabel}
                    </Button>
                  ) : null}
                  {onViewPlugin ? (
                    <Button variant="outline" onClick={onViewPlugin}>
                      <ArrowRight className="size-4" />
                      View Plugin Details
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={onClear}>
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
                        onClick={() => setConfirmingClose(true)}
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
