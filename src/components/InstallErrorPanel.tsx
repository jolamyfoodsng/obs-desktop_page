import { Bug, Copy, RefreshCw } from 'lucide-react'

import { ErrorState } from './ErrorState'

interface InstallErrorPanelProps {
  pluginName?: string | null
  message: string
  logs?: string | null
  onRetry?: (() => void) | null
  onCopyLogs?: (() => void) | null
  onReportIssue?: (() => void) | null
}

export function InstallErrorPanel({
  pluginName,
  message,
  logs,
  onRetry,
  onCopyLogs,
  onReportIssue,
}: InstallErrorPanelProps) {
  return (
    <ErrorState
      description={
        <>
          {pluginName ? (
            <span>
              An unexpected error occurred while installing <strong>{pluginName}</strong>.
            </span>
          ) : (
            <span>An unexpected error occurred while finishing the install workflow.</span>
          )}
          <span className="mt-1 block">{message}</span>
        </>
      }
      details={logs ?? null}
      primaryAction={
        onRetry
          ? {
              label: 'Try again',
              icon: <RefreshCw className="size-4" />,
              onClick: onRetry,
              variant: 'primary',
            }
          : undefined
      }
      secondaryAction={
        onCopyLogs
          ? {
              label: 'Copy logs',
              icon: <Copy className="size-4" />,
              onClick: onCopyLogs,
              variant: 'outline',
            }
          : undefined
      }
      title="Installation error"
    >
      {onReportIssue ? (
        <div className="mt-3">
          <button
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-white"
            onClick={onReportIssue}
            type="button"
          >
            <Bug className="size-4" />
            Report issue
          </button>
        </div>
      ) : null}
    </ErrorState>
  )
}
