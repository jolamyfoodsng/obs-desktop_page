import { FolderOpen } from 'lucide-react'

import type { InstalledLocationEntry } from '../lib/utils'
import { compactPathForDisplay } from '../lib/utils'
import { Button } from './ui/Button'
import { CopyPathField } from './ui/CopyPathField'

interface InstallLocationSectionProps {
  description?: string | null
  locations: InstalledLocationEntry[]
  title?: string
  onOpenLocation?: (path: string) => void
}

export function InstallLocationSection({
  description,
  locations,
  onOpenLocation,
  title = 'Installed location',
}: InstallLocationSectionProps) {
  if (locations.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {title}
      </p>
      {description ? (
        <p className="mt-2 text-sm leading-7 text-slate-300">{description}</p>
      ) : null}
      <div className="mt-3 space-y-3">
        {locations.map((location) => (
          <div
            className="rounded-lg border border-white/8 bg-black/20 p-3"
            key={`${location.id}:${location.path}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{location.label}</p>
                {location.description ? (
                  <p className="mt-1 text-xs leading-6 text-slate-400">
                    {location.description}
                  </p>
                ) : null}
              </div>
              {onOpenLocation ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenLocation(location.path)}
                >
                  <FolderOpen className="size-4" />
                  {location.openLabel}
                </Button>
              ) : null}
            </div>
            <CopyPathField
              className="mt-3"
              displayValue={compactPathForDisplay(location.path)}
              value={location.path}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
