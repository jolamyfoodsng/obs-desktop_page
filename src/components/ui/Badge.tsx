import type { ReactNode } from 'react'

import { cn } from '../../lib/utils'

interface BadgeProps {
  children: ReactNode
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'script' | 'verified'
  className?: string
}

const toneClasses = {
  neutral: 'badge-tone-neutral',
  primary: 'badge-tone-primary',
  success: 'badge-tone-success',
  script: 'badge-tone-script',
  verified: 'badge-tone-verified',
  warning: 'badge-tone-warning',
  danger: 'badge-tone-danger',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
