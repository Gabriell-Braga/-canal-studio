/** Props passed from the render step to the Remotion compositions. URLs point at render.ts's file server. */

export type TemplateId = 'documentary' | 'bold' | 'minimal'

/** The channel's own colors and font; overrides the template's text styling. */
export interface Brand {
  primary: string
  secondary: string
  font: string
  /** Black outline around the text (default on) */
  outline?: boolean
}

export interface RenderScene {
  src: string
  type: 'video' | 'image'
  start: number
  end: number
  /** 0–3: Ken Burns direction for images */
  motion: number
  /** Length of a video clip in seconds; shorter clips loop */
  clipDuration?: number
}

export interface RenderWord {
  word: string
  start: number
  end: number
}

export interface VideoProps {
  fps: number
  durationSec: number
  narration: string
  scenes: RenderScene[]
  words: RenderWord[]
  captions: boolean
  music: string | null
  musicVolume: number
  template: TemplateId
  [key: string]: unknown
}

/** Vertical 9:16 cut of a finished video, ending with a card that points to the full video. */
export interface ShortProps {
  fps: number
  /** Where the cut starts in the original narration, seconds */
  segmentStart: number
  segmentDuration: number
  narration: string
  /** Scenes with times relative to the start of the cut */
  scenes: RenderScene[]
  /** Words with times relative to the start of the cut */
  words: RenderWord[]
  captions: boolean
  music: string | null
  musicVolume: number
  template: TemplateId
  brand?: Brand
  /** Hook text shown at the top for the whole short */
  headline: string
  cta: {
    audio: string
    duration: number
    text: string
    thumbnail: string | null
    parentTitle: string
  }
  [key: string]: unknown
}

export interface ThumbnailProps {
  background: string
  /** Second image for the split-screen layout (variant 4), shown on the left */
  background2?: string | null
  text: string
  template: TemplateId
  brand?: Brand
  /** Subject cut out of the background (RGBA PNG): renders the no-text highlight style */
  cutout?: string | null
  /** 0 text left, 1 text right, 2 text top, 3 text in a color block, 4 split screen */
  variant: number
  [key: string]: unknown
}

/** Where a thumbnail option came from; the step writes it at the end of the file name. */
export type ThumbKind = 'ai' | 'stock' | 'scene' | 'split' | 'highlight'

export const THUMB_KIND_LABELS: Record<ThumbKind, string> = {
  ai: 'Conceito IA',
  stock: 'Banco de imagens',
  scene: 'Cena do vídeo',
  split: 'Comparação',
  highlight: 'Destaque sem texto'
}

/** "thumb_3_stock.png" → "stock"; null for files from before the kinds existed. */
export function thumbKindOf(path: string): ThumbKind | null {
  const kind = /_([a-z]+)\.png$/i.exec(path)?.[1]
  return kind && kind in THUMB_KIND_LABELS ? (kind as ThumbKind) : null
}

export interface RenderJob {
  mode: 'video' | 'short' | 'stills'
  /** Root folder the file server exposes; props reference files as {{root}}/relative/path */
  root: string
  entry: string
  out: string
  video?: VideoProps
  short?: ShortProps
  stills?: { props: ThumbnailProps; out: string }[]
  concurrency?: number
}
