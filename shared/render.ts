/** Props passed from the render step to the Remotion compositions. URLs point at render.ts's file server. */

export type TemplateId = 'documentary' | 'bold' | 'minimal'

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

export interface ThumbnailProps {
  background: string
  text: string
  template: TemplateId
  variant: number
  [key: string]: unknown
}

export interface RenderJob {
  mode: 'video' | 'stills'
  /** Root folder the file server exposes; props reference files as {{root}}/relative/path */
  root: string
  entry: string
  out: string
  video?: VideoProps
  stills?: { props: ThumbnailProps; out: string }[]
  concurrency?: number
}
