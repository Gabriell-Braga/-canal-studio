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
  /** Black cards with the new year; empty for videos without years */
  yearCards?: YearCard[]
  /** Companies shown in the corner badges and the opening logo card (max 2) */
  companies?: RenderCompany[]
  /** Seconds the opening logo card stays up over the first scene; 0 = none */
  introSec?: number
  /** The hook's punch line, big on screen until the hook ends (seconds) */
  teaser?: { text: string; end: number }
  /** The channel's own intro, between the hook and the story */
  channelIntro?: ChannelIntroProps & { start: number; duration: number }
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
  /** Logos shown big at the start and small next to the headline */
  companies?: RenderCompany[]
  yearCards?: YearCard[]
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
  /** Subject cut out of the background (RGBA PNG): renders the highlight style, with no text when text is empty */
  cutout?: string | null
  /** Highlight style: side of the frame the text goes on, away from the subject */
  textSide?: 'left' | 'right'
  /** 0 text left, 1 text right, 2 text top, 3 text in a color block, 4 split screen */
  variant: number
  [key: string]: unknown
}

/** Where a thumbnail option came from; the step writes it at the end of the file name. */
export type ThumbKind = 'ai' | 'stock' | 'scene' | 'split' | 'highlight' | 'glow'

export const THUMB_KIND_LABELS: Record<ThumbKind, string> = {
  ai: 'Conceito IA',
  stock: 'Banco de imagens',
  scene: 'Cena do vídeo',
  split: 'Comparação',
  highlight: 'Destaque sem texto',
  glow: 'Destaque com texto'
}

/** "thumb_3_stock.png" → "stock"; null for files from before the kinds existed. */
export function thumbKindOf(path: string): ThumbKind | null {
  const kind = /_([a-z]+)\.png$/i.exec(path)?.[1]
  return kind && kind in THUMB_KIND_LABELS ? (kind as ThumbKind) : null
}

/** Shortest channel intro; a narrated tagline can make it longer. */
export const CHANNEL_INTRO_SEC = 4

/** The channel's intro card: its picture, name and tagline in its own colors. */
export interface ChannelIntroProps {
  name: string
  avatar: string | null
  tagline: string
  primary: string
  secondary: string
  font: string
  /** Background color of the channel picture; the card is filled with it */
  background?: string | null
  /** Small line with the upload frequency, e.g. "New video every day · 2 PM ET" */
  schedule?: string
  /** Preview length when rendered alone, seconds */
  duration?: number
  [key: string]: unknown
}

export interface RenderJob {
  mode: 'video' | 'short' | 'stills' | 'intro'
  /** Root folder the file server exposes; props reference files as {{root}}/relative/path */
  root: string
  entry: string
  out: string
  video?: VideoProps
  short?: ShortProps
  stills?: { props: ThumbnailProps; out: string }[]
  intro?: ChannelIntroProps
  concurrency?: number
}

/** Seconds of silence (and black year card) before a scene that jumps to a new year. */
export const YEAR_CARD_SEC = 2.2

/** A black card with the new year, shown in the silence before the scene. */
export interface YearCard {
  /** Scene start, seconds: the card ends here */
  at: number
  year: number
  /** Year shown before, if any; the card counts from it */
  from: number | null
  duration: number
}

export interface RenderCompany {
  name: string
  logo: string | null
  values: { year: number; usd: number }[]
}

/**
 * Index of every scene that starts a new year (and gets a year card), with the year it
 * leaves. Scenes without a year keep the last one.
 */
export function yearChanges(
  years: (number | null)[]
): Map<number, { year: number; from: number | null }> {
  const out = new Map<number, { year: number; from: number | null }>()
  let last: number | null = null
  years.forEach((y, i) => {
    if (!y || y === last) return
    out.set(i, { year: y, from: last })
    last = y
  })
  return out
}

/** "$2.5B", "$340M", "$1.2T", "$80K". */
export function formatUsd(usd: number): string {
  const abs = Math.abs(usd)
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K']
  ]
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const n = usd / size
      return `${n >= 100 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '')}${suffix}`
    }
  }
  return String(Math.round(usd))
}

/**
 * Company value in a given year: interpolated between the known points (on a log scale, so
 * growth looks steady), held after the last one. Null before the first point.
 */
export function valueAt(values: { year: number; usd: number }[], year: number): number | null {
  const pts = [...values].sort((a, b) => a.year - b.year)
  if (!pts.length || year < pts[0].year) return null
  for (let i = pts.length - 1; i >= 0; i--) {
    const a = pts[i]
    if (year < a.year) continue
    const b = pts[i + 1]
    if (!b || year === a.year) return a.usd
    const t = (year - a.year) / (b.year - a.year)
    if (a.usd > 0 && b.usd > 0)
      return Math.exp(Math.log(a.usd) + t * (Math.log(b.usd) - Math.log(a.usd)))
    return a.usd + t * (b.usd - a.usd)
  }
  return null
}
