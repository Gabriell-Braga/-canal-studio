import type React from 'react'
import type { ThumbnailProps, VideoProps } from '../../shared/render'
import { Thumbnail as BusinessThumbnail } from '../Thumbnail'
import { BusinessOverlays } from './business-history'

/** What a format draws itself: its signature overlays and its thumbnail layouts. */
export interface FormatComponents {
  Overlays: React.FC<{ video: VideoProps; accent: string }>
  Thumbnail: React.FC<ThumbnailProps>
}

const MODULES: Record<string, FormatComponents> = {
  'business-history': { Overlays: BusinessOverlays, Thumbnail: BusinessThumbnail }
}

export function formatComponents(id?: string): FormatComponents {
  return MODULES[id ?? ''] ?? MODULES['business-history']
}

/** Thumbnail composition: the channel format's own layouts. */
export const FormatThumbnail: React.FC<ThumbnailProps> = (props) => {
  const { Thumbnail } = formatComponents(props.format)
  return <Thumbnail {...props} />
}
