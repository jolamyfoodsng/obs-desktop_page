import { AppWindowMac, CircleAlert, CircleCheck } from 'lucide-react'

import type { ObsDetectionState } from '../types/desktop'
import { Badge } from './ui/Badge'

interface ObsVersionBadgeProps {
  detection?: ObsDetectionState | null
}

function parseObsVersion(detection?: ObsDetectionState | null) {
  if (detection?.obsVersion) {
    return detection.obsVersion
  }

  const matched = detection?.message?.match(/(?:OBS(?: Studio)?\s*v?)(\d+(?:\.\d+){0,2})/i)?.[1]
  return matched ?? null
}

export function ObsVersionBadge({ detection }: ObsVersionBadgeProps) {
  const obsVersion = parseObsVersion(detection)

  if (!detection?.isValid) {
    return (
      <Badge tone="warning">
        <CircleAlert className="size-3.5" />
        OBS not detected
      </Badge>
    )
  }

  if (obsVersion) {
    return (
      <Badge tone="success">
        <CircleCheck className="size-3.5" />
        OBS {obsVersion}
      </Badge>
    )
  }

  return (
    <Badge tone="neutral">
      <AppWindowMac className="size-3.5" />
      OBS detected
    </Badge>
  )
}
