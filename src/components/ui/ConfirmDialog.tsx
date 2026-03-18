import { AlertTriangle, X } from 'lucide-react'

import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  isBusy?: boolean
  tone?: 'danger' | 'primary'
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  isBusy = false,
  tone = 'danger',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) {
    return null
  }

  const confirmVariant = tone === 'danger' ? 'primary' : 'outline'
  const confirmClassName =
    tone === 'danger'
      ? 'bg-rose-500 text-white hover:bg-rose-400 disabled:bg-rose-500/60'
      : undefined

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#06070b]/68 p-6 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-xl border border-white/10 bg-background-dark p-5 shadow-panel">
        <button
          className="absolute right-4 top-4 rounded-lg border border-white/10 p-2 text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-white"
          disabled={isBusy}
          onClick={onCancel}
          type="button"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-4">
          <div
            className={
              tone === 'danger'
                ? 'rounded-lg bg-rose-500/10 p-3 text-rose-300'
                : 'rounded-lg bg-primary/12 p-3 text-primary'
            }
          >
            <AlertTriangle className="size-5" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-slate-400">{description}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button disabled={isBusy} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            className={confirmClassName}
            disabled={isBusy}
            variant={confirmVariant}
            onClick={onConfirm}
          >
            {isBusy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
