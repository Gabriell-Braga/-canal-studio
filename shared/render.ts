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
  /** Black end screen after the narration: starts at this second and runs to the end */
  endScreenAt?: number
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

/** Black screen with only the music after the narration, for YouTube's end screen (5–20 s). */
export const END_SCREEN_SEC = 20

/** Longer silence before the outro and a slower voice, so the ending does not feel rushed. */
export const OUTRO_PAUSE_SEC = 1.6
export const OUTRO_SPEED = 0.92

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
  // 0 or less means "not valued yet": never shown, never interpolated from.
  const pts = values.filter((v) => v.usd > 0).sort((a, b) => a.year - b.year)
  const exact = pts.find((p) => p.year === year)
  if (exact) return exact.usd
  const b = pts.findIndex((p) => p.year > year)
  // Before the first known value or after the last one: unknown, not held.
  if (b <= 0) return null
  const a = pts[b - 1]
  const t = (year - a.year) / (pts[b].year - a.year)
  return Math.exp(Math.log(a.usd) + t * (Math.log(pts[b].usd) - Math.log(a.usd)))
}

/**
 * Generous ceiling for any company's value in a year (about twice the largest company then),
 * so a made-up figure like Intel at $220B in 1985 never reaches the screen.
 */
// ponytail: coarse era table, replace with real market-cap data if a source gets wired in.
export function plausibleValue(year: number, usd: number): boolean {
  const caps: [number, number][] = [
    [1920, 3e9],
    [1950, 1e10],
    [1970, 6e10],
    [1987, 1.2e11],
    [1995, 3e11],
    [2010, 7e11],
    [2018, 1.1e12],
    [2020, 1.6e12],
    [2023, 3.2e12],
    [Infinity, 8e12]
  ]
  const cap = caps.find(([until]) => year < until)?.[1] ?? Infinity
  return usd > 0 && usd <= cap
}
