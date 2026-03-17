import { Copy, Trash2 } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'

export interface DiagnosticLogEntry {
  id: string
  timestamp: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
}

interface DiagnosticLogPanelProps {
  logs: DiagnosticLogEntry[]
  onCopy: () => void
  onClear: () => void
}

const levelClasses: Record<DiagnosticLogEntry['level'], string> = {
  info: 'text-slate-300',
  success: 'text-primary',
  warning: 'text-amber-300',
  error: 'text-red-300',
}

export function DiagnosticLogPanel({
  logs,
  onCopy,
  onClear,
}: DiagnosticLogPanelProps) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.04]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Diagnostic Logs</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Recent scan output and integrity messages.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCopy}>
            <Copy className="size-4" />
            Copy logs
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            <Trash2 className="size-4" />
            Clear
          </Button>
        </div>
      </div>
      <div className="ui-code-block max-h-64 overflow-y-auto rounded-none rounded-b-[24px] px-5 py-4 text-[12px] leading-6">
        {logs.length === 0 ? (
          <p className="text-slate-500">No diagnostic output yet.</p>
        ) : (
          logs.map((entry) => (
            <p className={cn(levelClasses[entry.level])} key={entry.id}>
              [{entry.timestamp}] {entry.message}
            </p>
          ))
        )}
      </div>
    </section>
  )
}
