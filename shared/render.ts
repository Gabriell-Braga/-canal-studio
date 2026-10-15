import { FORMATS } from './formats'

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
  /** Images: the point to keep in frame when cropping (top of the main subject) */
  focus?: Focus
  /** A newspaper ad scan: drawn on paper, with phrases highlighted at given seconds of the scene */
  scan?: { highlights: { at: number; boxes: Box[] }[] }
  /** More shots after the main one, sharing the scene's time equally (fast cuts) */
  shots?: Omit<RenderScene, 'start' | 'end' | 'shots'>[]
}

/** A point of an image (0–1 of its width and height) and the image's width / height. */
export interface Focus {
  x: number
  y: number
  aspect: number
}

export interface RenderWord {
  word: string
  start: number
  end: number
}

export type MusicMood = 'open' | 'drama' | 'final'

/** One background track, playing from `from` to `to` seconds; neighbors cross-fade. */
export interface MusicTrack {
  src: string
  from: number
  to: number
  /** Length of the file, seconds: it repeats to fill its part */
  duration: number
}

export interface VideoProps {
  fps: number
  durationSec: number
  narration: string
  scenes: RenderScene[]
  words: RenderWord[]
  captions: boolean
  /** Big burned-in captions until this second, even when captions are off */
  openingCaptionsSec?: number
  /** Up to three tracks in order: opening, dramatic, closing */
  music: MusicTrack[]
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
  /** Channel format: picks the overlay components */
  format?: string
  /** Data of the format's own overlays, by overlay id */
  overlays?: Record<string, unknown>
  /** Black end screen after the narration: starts at this second and runs to the end */
  endScreenAt?: number
  [key: string]: unknown
}

/** Vertical 9:16 cut of a finished video, ending with a card that points to the full video. */
export interface ShortProps {
  fps: number
  /** Where the cut starts in the original narration, seconds */
  segmentStart: number
  /** Length of the short before the end card, after the cuts */
  segmentDuration: number
  narration: string
  /**
   * Narration pieces to play, back to back: `from`–`to` in the cut (seconds), placed at `at`
   * in the short. Long pauses between lines fall out. Missing = the whole cut as is.
   */
  cuts?: { from: number; to: number; at: number }[]
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
  /** Narrated opening claim, played before the cut with the headline big on screen */
  hook?: { audio: string; duration: number; text: string } | null
  /** Narrated last line that flows back into the hook; replaces the end card so the short loops */
  loopEnd?: { audio: string; duration: number; text: string } | null
  /** Shorts with their own script: "loop" ends on the narration (it replays into line 1), "cliffhanger" ends on the card */
  ending?: 'loop' | 'cliffhanger'
  [key: string]: unknown
}

/** Seconds of a short: hook, the cut, then the loop line or the end card. */
export function shortDuration(
  p: Pick<ShortProps, 'segmentDuration' | 'cta' | 'hook' | 'loopEnd' | 'ending'>
): number {
  const tail = p.ending === 'loop' ? 0 : p.loopEnd ? p.loopEnd.duration : p.cta.duration + 0.4
  return (p.hook?.duration ?? 0) + p.segmentDuration + tail
}

export interface ThumbnailProps {
  /** Thumbnail model id of the channel's format (see FormatPack.thumbModels) */
  approach: string
  /** Layout the format's thumbnail component draws */
  layout?: string
  /** Format id: picks the thumbnail component */
  format?: string
  background: string
  /** "contrast": the ruin image, shown on the right */
  background2?: string | null
  /** 2–4 words, drawn very big */
  text: string
  /** Real face cut out of its photo (expression edited), for layouts that show one */
  face?: string | null
  /** Company logo, shown on a white plate in the top corner */
  logo?: string | null
  [key: string]: unknown
}

/** Where a thumbnail option came from (a format's model id, or an older kind). */
export type ThumbKind = string

/** Labels of every format's thumbnail models, plus the kinds older versions made. */
export const THUMB_KIND_LABELS: Record<string, string> = {
  ...Object.fromEntries(FORMATS.flatMap((f) => f.thumbModels.map((m) => [m.id, m.label]))),
  number: 'Número chocante',
  product: 'Produto em destaque',
  contrast: 'Antes × depois',
  ai: 'Conceito IA',
  stock: 'Banco de imagens',
  scene: 'Cena do vídeo',
  split: 'Comparação',
  highlight: 'Destaque sem texto',
  glow: 'Destaque com texto'
}

/** "thumb_3_stock.png" → "stock"; null for files from before the kinds existed. */
export function thumbKindOf(path: string): ThumbKind | null {
  const kind = /_([a-z0-9-]+)\.png$/i.exec(path)?.[1]
  return kind && kind in THUMB_KIND_LABELS ? kind : null
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
  /** Short jobs: image scenes carry their crop focus (older shorts render again to get it) */
  framed?: boolean
  /** Short jobs: cut with its pauses shrunk and scenes added back up to its old length */
  extended?: boolean
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

/** Big burned-in captions over the opening, where most viewers decide to stay. */
export const OPENING_CAPTIONS_SEC = 30

/** A box on an image, 0–1 of its width and height. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Data of the Ads on Trial overlays (VideoProps.overlays of the vintage-ads format). */
export interface AdOverlays {
  priceTags: {
    at: number
    until: number
    then: string
    today: string
    estimate: boolean
    year: number
  }[]
  claims: { at: number; verdict: string; quote: string; source: string }[]
  paperTrail: {
    at: number
    newspaper: string
    place: string
    date: string
    page: string
    /** Archive file page, for ads outside Chronicling America */
    link?: string
  } | null
  ingredients: { at: number; until: number; items: string[]; source: string } | null
  verdict: { at: number; law: string; text: string } | null
}
