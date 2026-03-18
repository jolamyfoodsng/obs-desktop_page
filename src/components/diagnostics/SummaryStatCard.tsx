import type { ReactNode } from 'react'

import { cn } from '../../lib/utils'

type SummaryTone = 'neutral' | 'success' | 'warning' | 'danger'

const toneClasses: Record<SummaryTone, string> = {
  neutral: 'text-slate-300',
  success: 'text-emerald-300',
  warning: 'text-amber-200',
  danger: 'text-red-200',
}

interface SummaryStatCardProps {
  label: string
  value: string
  supportingText: string
  tone?: SummaryTone
  icon?: ReactNode
  className?: string
}

export function SummaryStatCard({
  label,
  value,
  supportingText,
  tone = 'neutral',
  icon,
  className,
}: SummaryStatCardProps) {
  return (
    <section
      className={cn(
        'rounded-[24px] border border-white/10 bg-white/[0.04] p-5',
        className,
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={cn('text-3xl font-semibold text-white', toneClasses[tone])}>{value}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{supportingText}</p>
        </div>
        {icon ? <div className="shrink-0 text-slate-500">{icon}</div> : null}
      </div>
    </section>
  )
}
