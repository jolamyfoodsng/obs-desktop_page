import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { cn } from '../../lib/utils'

interface CopyPathFieldProps {
  value: string
  displayValue?: string
  className?: string
  codeClassName?: string
  buttonClassName?: string
  copyLabel?: string
}

const COPIED_DURATION_MS = 1500

export function CopyPathField({
  value,
  displayValue,
  className,
  codeClassName,
  buttonClassName,
  copyLabel = 'path',
}: CopyPathFieldProps) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  async function handleCopy() {
    if (!value) {
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = window.setTimeout(() => {
        setCopied(false)
      }, COPIED_DURATION_MS)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <p
        className={cn(
          'ui-code-block min-w-0 flex-1 select-text break-all rounded-md px-3 py-2 text-xs',
          codeClassName,
        )}
      >
        {displayValue ?? value}
      </p>
      <button
        aria-label={copied ? `${copyLabel} copied` : `Copy ${copyLabel} to clipboard`}
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-2 focus:ring-primary/40',
          buttonClassName,
        )}
        onClick={() => void handleCopy()}
        title={copied ? 'Copied' : 'Copy path'}
        type="button"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  )
}
