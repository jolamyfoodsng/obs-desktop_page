import type { ReactNode } from 'react'
import { AlertTriangle, CircleAlert, CircleCheckBig } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export type IntegrityCheckStatus = 'passed' | 'warning' | 'failed' | 'actionable'

interface IntegrityCheckRowProps {
  title: string
  summary: ReactNode
  status: IntegrityCheckStatus
  actionLabel?: string
  onAction?: () => void
}

const iconMap: Record<
  IntegrityCheckStatus,
  { icon: typeof CircleCheckBig; wrapperClassName: string; tone: 'success' | 'warning' | 'danger' }
> = {
  passed: {
    icon: CircleCheckBig,
    wrapperClassName: 'bg-primary/10 text-primary',
    tone: 'success',
  },
  warning: {
    icon: AlertTriangle,
    wrapperClassName: 'bg-amber-500/10 text-amber-300',
    tone: 'warning',
  },
  failed: {
    icon: CircleAlert,
    wrapperClassName: 'bg-red-500/10 text-red-300',
    tone: 'danger',
  },
  actionable: {
    icon: AlertTriangle,
    wrapperClassName: 'bg-amber-500/10 text-amber-300',
    tone: 'warning',
  },
}

const badgeLabelMap: Record<Exclude<IntegrityCheckStatus, 'actionable'>, string> = {
  passed: 'Passed',
  warning: 'Warning',
  failed: 'Failed',
}

export function IntegrityCheckRow({
  title,
  summary,
  status,
  actionLabel,
  onAction,
}: IntegrityCheckRowProps) {
  const { icon: StatusIcon, wrapperClassName, tone } = iconMap[status]

  return (
    <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:gap-5">
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          wrapperClassName,
        )}
      >
        <StatusIcon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <div className="mt-1 text-sm leading-6 text-slate-400">{summary}</div>
      </div>
      <div className="shrink-0">
        {status === 'actionable' ? (
          <Button size="sm" variant="primary" onClick={onAction}>
            {actionLabel ?? 'Fix Issue'}
          </Button>
        ) : (
          <Badge tone={tone}>{badgeLabelMap[status]}</Badge>
        )}
      </div>
    </div>
  )
}
