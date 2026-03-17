import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { cn } from '../lib/utils'
import { Button } from './ui/Button'

interface ErrorStateAction {
  label: string
  icon?: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'action'
  disabled?: boolean
}

interface ErrorStateProps {
  title: string
  description: ReactNode
  className?: string
  tone?: 'danger' | 'warning'
  details?: string | null
  primaryAction?: ErrorStateAction
  secondaryAction?: ErrorStateAction
  children?: ReactNode
}

function ErrorActionButton({ action }: { action: ErrorStateAction }) {
  return (
    <Button
      disabled={action.disabled}
      variant={action.variant ?? 'secondary'}
      onClick={action.onClick}
    >
      {action.icon}
      {action.label}
    </Button>
  )
}

export function ErrorState({
  title,
  description,
  className,
  tone = 'danger',
  details,
  primaryAction,
  secondaryAction,
  children,
}: ErrorStateProps) {
  const toneClasses =
    tone === 'danger'
      ? 'border-red-500/20 bg-red-500/8 text-red-200'
      : 'border-amber-400/20 bg-amber-500/10 text-amber-200'

  return (
    <div className={cn('rounded-xl border border-white/10 bg-white/[0.03] p-5', className)}>
      <div className="flex items-start gap-4">
        <div className={cn('rounded-lg p-3', toneClasses)}>
          <AlertTriangle className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-semibold text-white">{title}</h2>
          <div className="mt-2 text-[14px] leading-6 text-slate-300">{description}</div>
        </div>
      </div>

      {details ? (
        <pre className="ui-code-block mt-4 overflow-x-auto rounded-lg px-4 py-3 text-[12px] leading-6">
          {details}
        </pre>
      ) : null}

      {children}

      {primaryAction || secondaryAction ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {primaryAction ? <ErrorActionButton action={primaryAction} /> : null}
          {secondaryAction ? <ErrorActionButton action={secondaryAction} /> : null}
        </div>
      ) : null}
    </div>
  )
}
