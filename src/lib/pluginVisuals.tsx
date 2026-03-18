import type { ComponentProps } from 'react'
import {
  AudioLines,
  Orbit,
  RadioTower,
  Sparkles,
  WandSparkles,
  Workflow,
} from 'lucide-react'

interface PluginGlyphProps extends ComponentProps<typeof Sparkles> {
  iconKey: string
}

export function PluginGlyph({ iconKey, ...props }: PluginGlyphProps) {
  switch (iconKey) {
    case 'motion':
      return <Orbit {...props} />
    case 'automation':
      return <Workflow {...props} />
    case 'broadcast':
      return <RadioTower {...props} />
    case 'music':
      return <AudioLines {...props} />
    case 'effects':
      return <WandSparkles {...props} />
    default:
      return <Sparkles {...props} />
  }
}
