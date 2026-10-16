/** Thumbnail drawing rules shared by every format. */
export const THUMB = {
  /** Headline font: condensed, so 2–4 words fit very big */
  font: 'Impact, "Arial Black", sans-serif',
  /** Font size of a one-line headline, share of the 720 px height (~35%) */
  oneLineSize: 0.35,
  /** Font size per line when the headline wraps to two lines */
  twoLineSize: 0.24,
  maxWords: 4,
  colors: {
    accent: '#FFD400',
    text: '#FFFFFF',
    alert: '#FF2B2B',
    stroke: '#000000'
  },
  /** Black outline width around the headline, px */
  stroke: 12,
  /** Company logo on its white plate, px (720 px tall frame) */
  logo: { height: 140, maxWidth: 440 },
  /** Brighter, more saturated background: dark thumbnails disappear in the mobile feed */
  photoFilter: 'brightness(1.12) saturate(1.45) contrast(1.12)',
  /** Mobile feed size used by the readability preview */
  preview: { width: 246, height: 138 },
  /** Added to every AI image prompt */
  imageStyle:
    'bright vivid saturated colors, well lit, high contrast, sharp focus, clean simple background, photorealistic, no text, no letters, no logos'
}

/** Readability checks on the 246×138 preview; a thumbnail that fails is made again. */
export const THUMB_CHECK = {
  /** The main subject fills at least this share of the frame */
  minCoverage: 0.3,
  /** RMS contrast of the luminance (0–1): grey, flat thumbnails vanish in the feed */
  minContrast: 0.16,
  /** Text on the thumbnail: 0 to 3 words */
  maxWords: 3
}

export interface ThumbReading {
  coverage: number
  contrast: number
  subject_contrast: number
}

/**
 * Why the preview does not read on a phone (pt-BR); empty when it passes. Real newspaper
 * scans skip coverage: saliency finds only part of a paper ad on paper, and their layouts
 * already fix the ad's size.
 */
export function thumbProblems(r: ThumbReading, checkCoverage = true): string[] {
  const out: string[] = []
  if (checkCoverage && r.coverage < THUMB_CHECK.minCoverage)
    out.push(`Sujeito pequeno (${Math.round(r.coverage * 100)}% do quadro; mínimo 30%)`)
  if (r.contrast < THUMB_CHECK.minContrast)
    out.push(`Contraste baixo (${r.contrast.toFixed(2)}; mínimo ${THUMB_CHECK.minContrast})`)
  return out
}

const TEXT_FILLER = new Set('the a an of to in on at and or for is was it its this that'.split(' '))

/**
 * Thumbnail text: at most 3 words and never the title's words (the two must add up, not
 * repeat). Words the title already says are dropped; what is left may be nothing.
 */
/** The title's meaningful words, lowercase: thumbnail text must not repeat them. */
export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9$%]+/)
      .filter((w) => w.length > 2 && !TEXT_FILLER.has(w))
  )
}

export function thumbText(text: string, title: string): string {
  const said = titleWords(title)
  const words = text
    .replace(/["“”]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !said.has(w.toLowerCase().replace(/[^a-z0-9$%]/g, '')))
  while (words.length && TEXT_FILLER.has(words[words.length - 1].toLowerCase())) words.pop()
  while (words.length && TEXT_FILLER.has(words[0].toLowerCase())) words.shift()
  return words.slice(0, THUMB_CHECK.maxWords).join(' ')
}

// ---------------------------------------------------------------- Ads on Trial layouts

/** A box in thumbnail pixels (1280×720). */
export interface PxBox {
  x: number
  y: number
  w: number
  h: number
}

export const VINTAGE_THUMB = {
  width: 1280,
  height: 720,
  /** Margin kept free of text and stamps on every side, share of the frame */
  safe: 0.06,
  /** Torn newspaper strip along the bottom, px */
  strip: 46,
  /** Smallest text height that still reads on the 246×138 preview, px */
  minPreviewPx: 11,
  /** Conservative average glyph width, em: Abril Fatface caps, Oswald bold caps + tracking */
  ratio: { title: 0.72, stamp: 0.66 },
  /** Real ad of model A: share of the frame it covers */
  adShare: [0.55, 0.65] as const,
  /** Face of model B: share of the frame height */
  faceShare: 0.48
}

const V = VINTAGE_THUMB

/** Where text and stamps may go: 6% in from every edge, above the torn strip. */
export function safeArea(): PxBox {
  const x = V.width * V.safe
  const y = V.height * V.safe
  return { x, y, w: V.width - 2 * x, h: Math.min(V.height - y, V.height - V.strip) - y }
}

/** Font size below which a thumbnail text no longer reads on the mobile preview. */
export const MIN_TEXT_SIZE = (V.minPreviewPx * V.height) / THUMB.preview.height

export function inside(b: PxBox, area: PxBox): boolean {
  const e = 0.5
  return (
    b.x >= area.x - e &&
    b.y >= area.y - e &&
    b.x + b.w <= area.x + area.w + e &&
    b.y + b.h <= area.y + area.h + e
  )
}

export interface PlacedText {
  kind: 'title' | 'stamp'
  text: string
  size: number
  /** Bounding box on the frame (rotated stamps: the box around the rotated stamp) */
  box: PxBox
  rotate: number
  /** Stamps are drawn centered on this point */
  center: { x: number; y: number }
  /** Model C: which side of the split it belongs to */
  role?: 'then' | 'now'
}

/** BigWord: one line, 6 px hard shadow; `align` places it inside the zone. */
export function fitTitle(
  text: string,
  zone: PxBox,
  maxSize: number,
  align: 'left' | 'right' | 'center' = 'left'
): PlacedText {
  const shadow = 6
  const len = Math.max(1, text.length)
  const size = Math.min(maxSize, zone.h - shadow, (zone.w - shadow) / (len * V.ratio.title))
  const w = len * V.ratio.title * size + shadow
  const h = size + shadow
  const x =
    align === 'left' ? zone.x : align === 'right' ? zone.x + zone.w - w : zone.x + (zone.w - w) / 2
  const box = { x, y: zone.y, w, h }
  return { kind: 'title', text, size, box, rotate: 0, center: { x: x + w / 2, y: zone.y + h / 2 } }
}

/** Unrotated stamp size at font size 1: text, padding (0.22 / 0.05 em) and border (0.07 em). */
function stampUnit(text: string): { w: number; h: number } {
  return { w: Math.max(1, text.length) * V.ratio.stamp + 0.44 + 0.14, h: 1.05 + 0.1 + 0.14 }
}

/** RubberStamp centered in the zone, as big as fits once rotated. */
export function fitStamp(text: string, zone: PxBox, maxSize: number, rotate: number): PlacedText {
  const u = stampUnit(text)
  const r = (Math.abs(rotate) * Math.PI) / 180
  const bw = u.w * Math.cos(r) + u.h * Math.sin(r)
  const bh = u.w * Math.sin(r) + u.h * Math.cos(r)
  const size = Math.min(maxSize, zone.w / bw, zone.h / bh)
  const center = { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 }
  const box = {
    x: center.x - (bw * size) / 2,
    y: center.y - (bh * size) / 2,
    w: bw * size,
    h: bh * size
  }
  return { kind: 'stamp', text, size, box, rotate, center }
}

export interface VintageLayout {
  texts: PlacedText[]
  /** Model A: where the real ad sits (unrotated) */
  ad?: PxBox
  /** Real product or ad shown beside the face (B) or on the "then" side (C) */
  product?: PxBox
  /** Model C: true when the right side shows the corrected price, false = verdict stamp */
  price?: boolean
  /** Why the thumbnail is reproved (pt-BR); empty = it can be used */
  problems: string[]
}

/**
 * Text, stamp and image boxes of an Ads on Trial thumbnail, shared by the Remotion layout
 * (which draws exactly these) and the step (which drops a thumbnail whose text cannot fit
 * the safe area at a size the mobile preview can read).
 */
export function vintageLayout(layout: string, text: string): VintageLayout {
  const S = safeArea()
  const right = S.x + S.w
  const bottom = S.y + S.h
  const texts: PlacedText[] = []
  const out: VintageLayout = { texts, problems: [] }
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (layout === 'then-now') {
    const [then = '', now = ''] = text.split('→').map((t) => t.trim())
    const mid = V.width / 2
    if (then)
      texts.push({
        ...fitTitle(then, { x: S.x, y: S.y, w: mid - 20 - S.x, h: 150 }, 130),
        role: 'then'
      })
    out.product = { x: S.x, y: 210, w: mid - 30 - S.x, h: bottom - 210 }
    out.price = /^\$|\d/.test(now)
    if (now && out.price)
      texts.push({
        ...fitTitle(now, { x: mid + 20, y: 220, w: right - mid - 20, h: 240 }, 240, 'center'),
        role: 'now'
      })
    else if (now)
      texts.push({
        ...fitStamp(now, { x: mid + 20, y: 180, w: right - mid - 20, h: 320 }, 170, -10),
        role: 'now'
      })
  } else if (layout === 'era-face') {
    const two = words.slice(0, 2).join(' ').toUpperCase()
    if (two) texts.push(fitTitle(two, { x: 666, y: S.y, w: right - 666, h: 150 }, 120, 'right'))
    out.product = { x: 790, y: 220, w: right - 790, h: bottom - 230 }
  } else {
    // ad-stamp: the real ad covers ~60% of the frame, the stamp half over it.
    out.ad = { x: 48, y: 14, w: 800, h: 692 }
    const [stamp, ...rest] = words
    if (stamp)
      texts.push(
        fitStamp(stamp.toUpperCase(), { x: 640, y: 158, w: right - 640, h: 288 }, 190, -14)
      )
    if (rest.length)
      texts.push(
        fitTitle(
          rest.join(' ').toUpperCase(),
          { x: 700, y: 518, w: right - 700, h: bottom - 518 },
          90,
          'right'
        )
      )
  }
  for (const t of texts) {
    if (!inside(t.box, S)) out.problems.push(`Texto "${t.text}" sai da área segura`)
    if (t.size < MIN_TEXT_SIZE)
      out.problems.push(
        `Texto "${t.text}" ilegível na prévia (${Math.round((t.size * THUMB.preview.height) / V.height)} px; mínimo ${V.minPreviewPx})`
      )
  }
  return out
}

/** Model B: portrait height and top so the face is ~48% of the frame, near the top. */
export function portraitPlacement(face: { y: number; h: number } | null): {
  height: number
  top: number
} {
  if (!face || face.h <= 0) return { height: V.height * 0.95, top: V.height * 0.05 }
  const height = Math.min(V.height * 2.2, (V.height * V.faceShare) / face.h)
  return { height, top: V.height * 0.12 - face.y * height }
}

/**
 * A person whose name the ad prints but the story never says is someone from a testimonial
 * ("Mrs. Haule, of Edgerton"), not the protagonist: never the face of model B.
 */
export function testimonialOnly(person: string, adText: string, story: string): boolean {
  const last =
    person
      .trim()
      .split(/\s+/)
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? ''
  if (last.length < 3) return false
  const has = (t: string): boolean => new RegExp(`\\b${last}`, 'i').test(t)
  return has(adText) && !has(story)
}

// ---------------------------------------------------------------- Ads on Trial concepts

/**
 * Ads on Trial thumbnails start from an idea, not from the materials: the video's conflict,
 * the question the thumbnail plants, and three different concepts that show it.
 */
export const CONCEPT_TYPES = ['contradiction', 'secret', 'mystery'] as const
export type ConceptType = (typeof CONCEPT_TYPES)[number]

export const CONCEPT_LABELS: Record<ConceptType, string> = {
  contradiction: 'Contradição',
  secret: 'Segredo',
  mystery: 'Mistério'
}

/** Photos come from the video's media bank; the rest are drawn with the brand's parts. */
export const MEDIA_ELEMENTS = ['portrait', 'product', 'ad', 'place'] as const
export const DRAWN_ELEMENTS = ['letter', 'stamp', 'label', 'tombstone', 'document'] as const
export type ElementKind = (typeof MEDIA_ELEMENTS)[number] | (typeof DRAWN_ELEMENTS)[number]

export interface ConceptElement {
  kind: ElementKind
  /** What it is, concretely ("Lydia Pinkham's real portrait", "a letter dated 1903") */
  what: string
  /** Portraits: the full name of the person shown */
  person: string
  /** Words drawn on it: letter line, stamp word, label name, tombstone inscription */
  words: string
  /** Wikimedia Commons search for the real picture (photo elements; '' for drawn parts) */
  search: string
}

export interface ThumbConcept {
  type: ConceptType
  idea: string
  /** Dominant subject first, then the conflict element, then an optional accent */
  elements: ConceptElement[]
  text: string
  /** One word of `text` painted red (the conflict point); '' when a stamp carries it */
  accent_word: string
  background: 'dark' | 'paper'
  why_click: string
}

export interface ThumbBriefing {
  conflict: string
  question: string
  concepts: ThumbConcept[]
}

/** Feed-size scores (1–10) from the vision model; every one must reach THUMB_MIN_SCORE. */
export interface ThumbScores {
  understand: number
  click: number
  readable: number
  stands_out: number
  note: string
}

export const THUMB_MIN_SCORE = 7

/** What the review shows for each thumbnail: its concept, the blind test and its scores. */
export interface ThumbConceptReport {
  file: string
  concept: ThumbConcept
  /** What a viewer who saw only the concept thought the video was about */
  blind: { about: string; question: string; ok: boolean } | null
  scores: ThumbScores | null
  attempts: number
  /** Measured checks (template thumbnails) */
  metrics?: ThumbMetrics
  /** Credits the pictures' licenses ask for */
  credits?: string[]
}

export interface ThumbBriefReport {
  conflict: string
  question: string
  thumbs: ThumbConceptReport[]
  /** Credits of every picture the thumbnails use, for the description */
  credits?: string[]
}

const PRICE_ONLY = /^[\s$€£¢\d.,→%x×-]+$/i

/** Why a concept cannot be used (pt-BR); empty when it can. */
export function conceptProblems(c: ThumbConcept, title: string): string[] {
  const out: string[] = []
  const words = c.text.replace(/["“”]/g, '').split(/\s+/).filter(Boolean)
  if (!words.length) out.push('sem texto')
  if (words.length > 4) out.push(`texto com ${words.length} palavras (máximo 4)`)
  const said = titleWords(title)
  const repeated = words.filter((w) => said.has(w.toLowerCase().replace(/[^a-z0-9$%]/g, '')))
  if (repeated.length) out.push(`texto repete o título (${repeated.join(', ')})`)
  if (words.length && PRICE_ONLY.test(c.text)) out.push('texto é só um preço, sem contexto')
  if (!c.elements.length) out.push('sem elementos visuais')
  if (c.elements.length > 3) out.push(`${c.elements.length} elementos (máximo 3)`)
  if (c.elements.some((e) => e.kind === 'portrait' && !e.person.trim()))
    out.push('retrato sem o nome da pessoa')
  if (c.accent_word && !words.some((w) => w.toLowerCase().includes(c.accent_word.toLowerCase())))
    out.push('palavra de destaque fora do texto')
  return out
}

/** Problems of a whole briefing: three concepts, one of each type, each usable. */
export function briefingProblems(b: ThumbBriefing, title: string): string[] {
  const out: string[] = []
  if (!b.conflict.trim()) out.push('sem conflito')
  if (!b.question.trim()) out.push('sem pergunta')
  const types = b.concepts.map((c) => c.type)
  if (b.concepts.length !== 3 || new Set(types).size !== 3)
    out.push(
      `conceitos precisam ser um de cada tipo (${CONCEPT_TYPES.join(', ')}); veio ${types.join(', ')}`
    )
  for (const c of b.concepts) for (const p of conceptProblems(c, title)) out.push(`${c.type}: ${p}`)
  return out
}

/** Scores below the minimum, as a pt-BR list; empty = the thumbnail passes. */
export function scoreProblems(s: ThumbScores): string[] {
  const names: [keyof ThumbScores, string][] = [
    ['understand', 'entendo o assunto em 2 s'],
    ['click', 'dá vontade de clicar'],
    ['readable', 'dá para ler o texto'],
    ['stands_out', 'o sujeito se destaca']
  ]
  return names
    .filter(([k]) => (s[k] as number) < THUMB_MIN_SCORE)
    .map(([k, label]) => `${label}: ${s[k]}`)
}

/** Shortest picture a thumbnail may use, px: anything smaller turns to mush when enlarged. */
export const MIN_THUMB_MEDIA_PX = 600

// ---------------------------------------------------------------- Ads on Trial templates

/**
 * Concept thumbnails use three fixed templates: the LLM picks what goes in each zone, the
 * zones themselves never move. Zones are in thumbnail pixels (1280×720).
 */
export const TEMPLATE_OF: Record<ConceptType, 'T1' | 'T2' | 'T3'> = {
  contradiction: 'T1',
  secret: 'T2',
  mystery: 'T3'
}
export type TemplateId = (typeof TEMPLATE_OF)[ConceptType]

const TW = 1280
const TH = 720

export const TPL = {
  width: TW,
  height: TH,
  /** Nothing cut or placed closer to the edge than this share of the frame */
  safe: 0.05,
  /** YouTube's duration badge, bottom right: no text behind it */
  clock: { x: TW * 0.82, y: TH * 0.86, w: TW * 0.18, h: TH * 0.14 },
  /** Minimum cap height per text role, px */
  minCap: { title: 110, stamp: 80, other: 48, letter: 56 },
  /** Largest cap height a title grows to */
  maxCap: 180,
  lineHeight: 0.9,
  red: '#C2211C',
  titleStroke: 12,
  accentStroke: 6,
  /** White outline around cutouts, px */
  outline: 8,
  maxTitleWords: 4
}

export interface StampZone {
  cx: number
  cy: number
  /** Stamp width range, px */
  minW: number
  maxW: number
  rotate: number
}

export interface TemplateZones {
  /** T1 subject / T2 object / T3 left element: the main element */
  main: PxBox
  /** T3: the element on the right, tilted */
  side?: PxBox & { rotate: number }
  title: PxBox & {
    maxLines: number
    /** Lines allowed when maxLines cannot reach the minimum cap height */
    fallbackLines?: number
    column?: boolean
    align: 'left' | 'center'
  }
  /** T3: dark band behind the title */
  band?: PxBox
  stamp?: StampZone
}

export function templateZones(t: TemplateId): TemplateZones {
  if (t === 'T1')
    return {
      // Bust cut out, 115% of the frame tall (bleeds at the bottom), head top at ~6%.
      main: { x: 0, y: TH * 0.06, w: TW * 0.52, h: TH * 1.15 },
      title: {
        x: TW * 0.5,
        y: TH * 0.08,
        w: TW * 0.45,
        h: TH * 0.54,
        maxLines: 2,
        // 110 px caps leave ~8 Oswald capitals per line in 45% of the width.
        fallbackLines: 3,
        align: 'left'
      },
      // As far right and as wide as allowed: the bottom right is otherwise empty.
      stamp: { cx: TW * 0.58, cy: TH * 0.74, minW: TW * 0.4, maxW: TW * 0.4, rotate: -8 }
    }
  if (t === 'T2')
    return {
      // The title column is 37% wide (a 6-letter word at 110 px caps needs 36%), the
      // object starts where it ends.
      main: { x: TW * 0.36, y: TH * 0.01, w: TW * 0.4, h: TH * 0.98 },
      title: {
        x: TW * 0.05,
        y: TH * 0.1,
        w: TW * 0.37,
        h: TH * 0.6,
        maxLines: 2,
        column: true,
        align: 'left'
      },
      // Across the object, toward the right (never over the title column).
      stamp: { cx: TW * 0.62, cy: TH * 0.6, minW: TW * 0.4, maxW: TW * 0.48, rotate: -16 }
    }
  return {
    main: { x: 0, y: 0, w: TW * 0.5, h: TH },
    // Over the divider by 6% of the frame, tilted 6°: its text stays inside the 5% margin.
    side: { x: TW * 0.44, y: TH * 0.14, w: TW * 0.5, h: TH * 0.84, rotate: 6 },
    band: { x: 0, y: TH * 0.04, w: TW, h: TH * 0.26 },
    title: { x: TW * 0.05, y: TH * 0.05, w: TW * 0.9, h: TH * 0.24, maxLines: 1, align: 'center' }
  }
}

/** Every way to put `words` in at most `maxLines` lines (up to 3), in reading order. */
export function lineSplits(words: string[], maxLines: number): string[][] {
  if (!words.length) return []
  const out: string[][] = [[words.join(' ')]]
  if (maxLines >= 2)
    for (let k = 1; k < words.length; k++)
      out.push([words.slice(0, k).join(' '), words.slice(k).join(' ')])
  if (maxLines >= 3)
    for (let a = 1; a < words.length - 1; a++)
      for (let b = a + 1; b < words.length; b++)
        out.push([
          words.slice(0, a).join(' '),
          words.slice(a, b).join(' '),
          words.slice(b).join(' ')
        ])
  return out
}

export interface FitResult {
  lines: string[]
  /** Font size, px */
  size: number
  /** Cap height at that size, px */
  cap: number
}

export interface FitOptions {
  maxLines: number
  maxCap: number
  /** The font's cap height / font size */
  capRatio: number
  /** Width of a line at a font size: canvas in the browser, an estimate in tests */
  width: (line: string, size: number) => number
  /** One word per line */
  column?: boolean
}

/**
 * Biggest text that fits `zone`: tries every line split, sizes the font so the widest line
 * fills the width and the lines fit the height (line height 0.9), never past `maxCap`.
 */
export function fitText(
  text: string,
  zone: { w: number; h: number },
  opts: FitOptions
): FitResult | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const splits = opts.column ? [words] : lineSplits(words, opts.maxLines)
  let best: FitResult | null = null
  for (const lines of splits) {
    if (!opts.column && lines.length > opts.maxLines) continue
    const at100 = Math.max(...lines.map((l) => opts.width(l, 100)))
    const byWidth = (zone.w / Math.max(at100, 1)) * 100
    const byHeight = zone.h / (lines.length * TPL.lineHeight)
    const size = Math.min(byWidth, byHeight, opts.maxCap / opts.capRatio)
    if (!best || size > best.size) best = { lines, size, cap: size * opts.capRatio }
  }
  return best
}

/**
 * Small text (letter, tombstone): the biggest fit at least `minCap` tall; words drop from the
 * end until it fits. Never shrinks below the minimum: null when not even one word fits.
 */
export function fitAtLeast(
  text: string,
  zone: { w: number; h: number },
  minCap: number,
  opts: Omit<FitOptions, 'column'>
): FitResult | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  for (let n = words.length; n > 0; n--) {
    const fit = fitText(words.slice(0, n).join(' '), zone, opts)
    if (fit && fit.cap >= minCap - 0.5) return fit
  }
  return null
}

/** One text as the browser drew it: cap height and box, both in thumbnail px. */
export interface MeasuredText {
  role: 'title' | 'stamp' | 'other' | 'letter'
  text: string
  cap: number
  rect: PxBox
}

const overlaps = (a: PxBox, b: PxBox): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Size, safe-margin and duration-badge rules on the measured texts (pt-BR). */
export function textProblems(texts: MeasuredText[]): string[] {
  const out: string[] = []
  const m = TPL.safe
  const safe = { x: TW * m, y: TH * m, w: TW * (1 - 2 * m), h: TH * (1 - 2 * m) }
  if (!texts.some((t) => t.role === 'title')) out.push('sem título medido')
  for (const t of texts) {
    const min = TPL.minCap[t.role]
    if (t.cap < min - 0.5)
      out.push(`"${t.text}" com ${Math.round(t.cap)} px de altura de maiúscula (mínimo ${min})`)
    if (!inside(t.rect, safe)) out.push(`"${t.text}" fora da margem de 5%`)
    if (overlaps(t.rect, TPL.clock)) out.push(`"${t.text}" atrás do relógio de duração`)
  }
  return out
}

// ---------------------------------------------------------------- automatic checks

export const THUMB_RULES = {
  grid: { cols: 16, rows: 9 },
  /** A cell is empty when its luminance variance is below this (0–255 scale)… */
  emptyVariance: 6,
  /** …and under this share of its pixels are Sobel edges */
  emptyEdges: 0.02,
  /** Sobel magnitude (0–255 luminance) that counts as an edge */
  edgeMagnitude: 48,
  /** Image size the grid is measured on: averages out paper grain, keeps real structure */
  measure: { width: 320, height: 180 },
  maxEmptyShare: 0.18,
  /** No empty block bigger than 3×3 cells */
  maxEmptyBlock: 3,
  minOccupancy: 0.75,
  minSubject: 0.35,
  minOcr: 80,
  minContrast: 4.5,
  minScore: 7
}

export interface EmptyGrid {
  /** Row-major, true = empty */
  empty: boolean[]
  share: number
  /** Largest all-empty rectangle, in cells */
  block: { w: number; h: number }
}

/** Empty cells of an RGB image (rgb24, row-major) on the 16×9 grid. */
export function emptyGrid(rgb: Uint8Array, width: number, height: number): EmptyGrid {
  const R = THUMB_RULES
  const lum = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++)
    lum[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]
  const at = (x: number, y: number): number =>
    lum[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]
  const { cols, rows } = R.grid
  const empty: boolean[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * width) / cols)
      const x1 = Math.floor(((c + 1) * width) / cols)
      const y0 = Math.floor((r * height) / rows)
      const y1 = Math.floor(((r + 1) * height) / rows)
      let sum = 0
      let sq = 0
      let edges = 0
      const n = (x1 - x0) * (y1 - y0)
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const v = at(x, y)
          sum += v
          sq += v * v
          const gx =
            at(x + 1, y - 1) +
            2 * at(x + 1, y) +
            at(x + 1, y + 1) -
            (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
          const gy =
            at(x - 1, y + 1) +
            2 * at(x, y + 1) +
            at(x + 1, y + 1) -
            (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
          if (Math.hypot(gx, gy) > R.edgeMagnitude) edges++
        }
      const mean = sum / n
      empty.push(sq / n - mean * mean < R.emptyVariance && edges / n < R.emptyEdges)
    }
  let block = { w: 0, h: 0 }
  for (let r0 = 0; r0 < rows; r0++)
    for (let c0 = 0; c0 < cols; c0++)
      for (let r1 = r0; r1 < rows; r1++)
        for (let c1 = c0; c1 < cols; c1++) {
          let all = true
          for (let r = r0; r <= r1 && all; r++)
            for (let c = c0; c <= c1 && all; c++) all = empty[r * cols + c]
          if (!all) break
          const w = c1 - c0 + 1
          const h = r1 - r0 + 1
          if (w * h > block.w * block.h) block = { w, h }
        }
  return { empty, share: empty.filter(Boolean).length / empty.length, block }
}

export function emptyProblems(g: EmptyGrid): string[] {
  const out: string[] = []
  const R = THUMB_RULES
  if (g.share > R.maxEmptyShare)
    out.push(`${Math.round(g.share * 100)}% do quadro vazio (máximo ${R.maxEmptyShare * 100}%)`)
  const m = R.maxEmptyBlock
  if (g.block.w * g.block.h > m * m && Math.min(g.block.w, g.block.h) >= m)
    out.push(`bloco vazio de ${g.block.w}×${g.block.h} células (máximo ${m}×${m})`)
  return out
}

/**
 * Share of the frame the elements cover: pixels where the image differs from its bare
 * background, plus the boxes of its texts (the gaps between letters belong to the text).
 */
export function coveredShare(
  a: Uint8Array,
  b: Uint8Array,
  boxes: PxBox[] = [],
  width = TW,
  threshold = 16
): number {
  let n = 0
  const px = Math.min(a.length, b.length) / 3
  const inBox = (x: number, y: number): boolean =>
    boxes.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  for (let i = 0; i < px; i++)
    if (
      Math.abs(a[i * 3] - b[i * 3]) > threshold ||
      Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) > threshold ||
      Math.abs(a[i * 3 + 2] - b[i * 3 + 2]) > threshold ||
      inBox(i % width, Math.floor(i / width))
    )
      n++
  return n / Math.max(1, px)
}

const linear = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of an sRGB color. */
export function relLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/** Mean relative luminance of the pixels of `box` in an RGB image. */
export function meanLuminance(rgb: Uint8Array, width: number, height: number, box: PxBox): number {
  const x0 = Math.max(0, Math.floor(box.x))
  const y0 = Math.max(0, Math.floor(box.y))
  const x1 = Math.min(width, Math.ceil(box.x + box.w))
  const y1 = Math.min(height, Math.ceil(box.y + box.h))
  let sum = 0
  let n = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 3
      sum += relLuminance(rgb[i], rgb[i + 1], rgb[i + 2])
      n++
    }
  return n ? sum / n : 0
}

const norm = (w: string): string => w.toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Lowest OCR confidence among the words that must read on the phone (0 = one was not
 * found). OCR may glue words together, so a word counts when a read token contains it.
 */
export function ocrConfidence(
  required: string[],
  read: { text: string; conf: number }[]
): { min: number; missing: string[] } {
  const tokens = read.map((r) => ({ t: norm(r.text), conf: r.conf }))
  let min = 100
  const missing: string[] = []
  for (const w of required.map(norm).filter(Boolean)) {
    const hit = tokens.filter((t) => t.t.includes(w)).sort((a, b) => b.conf - a.conf)[0]
    if (!hit) {
      missing.push(w)
      min = 0
    } else min = Math.min(min, hit.conf)
  }
  return { min, missing }
}

/** Measured numbers of one thumbnail, shown in the final review. */
export interface ThumbMetrics {
  emptyPct: number
  occupancyPct: number
  subjectPct: number
  /** Lowest OCR confidence of the title and stamp words at 246×138 (0–100) */
  ocr: number
  ocrMissing: string[]
  /** Title against what is right behind it, :1 */
  contrast: number
  caps: { title: number; stamp: number | null; other: number | null }
  /** Vision scores at 246×138 (1–10) */
  understand: number | null
  click: number | null
  notEmpty: number | null
  problems: string[]
}

/** Occupancy, OCR, contrast and score rules (pt-BR); empty = they pass. */
export function metricProblems(m: Omit<ThumbMetrics, 'problems'>): string[] {
  const R = THUMB_RULES
  const out: string[] = []
  if (m.occupancyPct < R.minOccupancy * 100)
    out.push(`elementos cobrem ${Math.round(m.occupancyPct)}% (mínimo ${R.minOccupancy * 100}%)`)
  if (m.subjectPct < R.minSubject * 100)
    out.push(`sujeito cobre ${Math.round(m.subjectPct)}% (mínimo ${R.minSubject * 100}%)`)
  if (m.ocr < R.minOcr)
    out.push(
      m.ocrMissing.length
        ? `OCR em 246×138 não leu: ${m.ocrMissing.join(', ')}`
        : `OCR em 246×138 com confiança ${Math.round(m.ocr)} (mínimo ${R.minOcr})`
    )
  if (m.contrast < R.minContrast)
    out.push(`contraste do título ${m.contrast.toFixed(1)}:1 (mínimo ${R.minContrast}:1)`)
  const scores: [number | null, string][] = [
    [m.understand, 'entendo o assunto em 2 s'],
    [m.click, 'dá vontade de clicar'],
    [m.notEmpty, 'nada parece vazio ou pequeno']
  ]
  for (const [v, label] of scores) if (v !== null && v < R.minScore) out.push(`${label}: nota ${v}`)
  return out
}

/** Drawn parts with enough detail to stand alone; anything else needs a real picture. */
export const DETAILED_DRAWN = ['letter', 'tombstone'] as const

/**
 * Why a concept cannot be drawn in its template without a placeholder (pt-BR): T1 needs a
 * real portrait and a stamp, T2 a real object and a stamp, T3 two elements, each a real
 * picture or a detailed drawn part (letter, tombstone). `hasMedia(i)`: element i has a picture.
 */
export function placeholderProblems(c: ThumbConcept, hasMedia: (i: number) => boolean): string[] {
  const t = TEMPLATE_OF[c.type]
  const out: string[] = []
  const visual = c.elements.map((e, i) => ({ e, i })).filter(({ e }) => e.kind !== 'stamp')
  if (t === 'T1') {
    const p = visual.find(({ e }) => e.kind === 'portrait')
    if (!p || !hasMedia(p.i)) out.push('T1 sem retrato real da pessoa')
  } else if (t === 'T2') {
    const o = visual.find(({ e }) => e.kind === 'product' || e.kind === 'ad')
    if (!o || !hasMedia(o.i)) out.push('T2 sem objeto real (frasco, rótulo, anúncio)')
  } else {
    if (visual.length < 2) out.push('T3 precisa de dois elementos')
    for (const { e, i } of visual.slice(0, 2))
      if (!hasMedia(i) && !(DETAILED_DRAWN as readonly string[]).includes(e.kind))
        out.push(`T3: "${e.what}" sem mídia real nem desenho detalhado`)
  }
  if (t !== 'T3' && !c.elements.some((e) => e.kind === 'stamp' && e.words.trim()))
    out.push(`${t} sem carimbo`)
  return out
}

/** One element of a template thumbnail: a prepared picture, or a detailed drawn part. */
export interface TemplatePiece {
  kind: ElementKind
  /** {{root}} URL of the picture (cut out without background when `cutout`); null = drawn */
  src: string | null
  /** width / height of the picture */
  aspect: number
  cutout: boolean
  /** Words drawn on it: letter lines, tombstone inscription (" / " breaks lines) */
  words: string
}

/** `template` prop of an Ads on Trial template thumbnail (layout "template"). */
export interface TemplateDraw {
  template: TemplateId
  title: string
  /** Word of the title painted red ('' = none) */
  accentWord: string
  stamp: string
  main: TemplatePiece
  /** T3 only: the right element */
  side: TemplatePiece | null
  /** T2: solid background that contrasts with the object */
  background: 'dark' | 'light'
  /** Check renders: only the background, background + main element, everything but the title */
  layers?: 'all' | 'bare' | 'subject' | 'notitle'
}
