/** Props passed from the render step to the Remotion compositions. URLs point at render.ts's file server. */

export type TemplateId = 'documentary' | 'bold' | 'minimal'

/** The channel's own colors and font; overrides the template's text styling. */
export interface Brand {
  primary: string
  secondary: string
  font: string
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
  text: string
  template: TemplateId
  brand?: Brand
  variant: number
  [key: string]: unknown
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
