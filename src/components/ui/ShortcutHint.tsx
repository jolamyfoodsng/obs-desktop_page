import { Fragment } from 'react'

import { cn } from '../../lib/utils'

interface ShortcutHintProps {
  keys: string[]
  className?: string
  keyClassName?: string
}

export function ShortcutHint({
  keys,
  className,
  keyClassName,
}: ShortcutHintProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium text-slate-500',
        className,
      )}
    >
      {keys.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          {index > 0 ? <span className="text-slate-600">+</span> : null}
          <kbd
            className={cn(
              'rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-300',
              keyClassName,
            )}
          >
            {key}
          </kbd>
        </Fragment>
      ))}
    </span>
  )
}
