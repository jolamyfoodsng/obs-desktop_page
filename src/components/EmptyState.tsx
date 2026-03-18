import type { ReactNode } from 'react'

import { Button } from './ui/Button'
import { cn } from '../lib/utils'

interface EmptyStateAction {
  label: string
  icon?: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'action'
  disabled?: boolean
}

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: ReactNode
  className?: string
  suggestions?: string[]
  primaryAction?: EmptyStateAction
  secondaryAction?: EmptyStateAction
}

function EmptyStateActionButton({ action }: { action: EmptyStateAction }) {
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

export function EmptyState({
  icon,
  title,
  description,
  className,
  suggestions,
  primaryAction,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-white/[0.03] px-6 py-8 text-center',
        className,
      )}
    >
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-400">
        {icon}
      </div>
      <h2 className="mt-4 text-[18px] font-semibold text-white">{title}</h2>
      <div className="mx-auto mt-2 max-w-xl text-[14px] leading-6 text-slate-400">
        {description}
      </div>

      {suggestions?.length ? (
        <div className="mx-auto mt-5 max-w-lg rounded-lg border border-white/10 bg-white/[0.03] p-4 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Suggested actions
          </p>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {suggestions.map((suggestion) => (
              <li className="flex items-start gap-2" key={suggestion}>
                <span className="mt-2 size-1.5 rounded-full bg-primary" />
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {primaryAction || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {primaryAction ? <EmptyStateActionButton action={primaryAction} /> : null}
          {secondaryAction ? <EmptyStateActionButton action={secondaryAction} /> : null}
        </div>
      ) : null}
    </div>
  )
}
