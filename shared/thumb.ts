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
}

export interface ThumbBriefReport {
  conflict: string
  question: string
  thumbs: ThumbConceptReport[]
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

/** One element as the Remotion layout draws it: a bank picture, or a drawn brand part. */
export interface ConceptPiece {
  kind: ElementKind
  /** Picture of a media element ({{root}} URL); null = drawn from `words` */
  src: string | null
  words: string
  /** width / height of the picture */
  aspect?: number
}

/** `concept` prop of a concept thumbnail (layout "concept"). */
export interface ConceptDraw {
  background: 'dark' | 'paper'
  subject: ConceptPiece
  support: ConceptPiece | null
  /** Red rubber stamp over the seam ('' = none) */
  stamp: string
  /** Word of the text painted red ('' = none) */
  accentWord: string
}

/** Aspect a drawn part gets in the subject box. */
export function pieceAspect(p: ConceptPiece): number {
  return p.src ? (p.aspect ?? 0.8) : p.kind === 'stamp' ? 1.6 : 0.8
}

/** Shortest picture a thumbnail may use, px: anything smaller turns to mush when enlarged. */
export const MIN_THUMB_MEDIA_PX = 600

export interface ConceptLayout {
  /** Dominant subject, left: 40–60% of the frame */
  subject: PxBox
  /** Conflict element, bottom right */
  support: PxBox
  /** The text, top right, one or two lines */
  texts: PlacedText[]
  /** Optional accent stamp, over the seam between subject and support */
  stamp?: PlacedText
  problems: string[]
}

/** Bold condensed caps (Oswald 700, 1 px tracking): conservative average glyph width, em. */
const BOLD_RATIO = 0.56

/** Text in one or two lines, whichever reads bigger, left-aligned in the zone. */
export function fitLines(text: string, zone: PxBox, maxSize: number): PlacedText[] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  const outline = 8
  const options: string[][] = [[words.join(' ')]]
  for (let k = 1; k < words.length; k++)
    options.push([words.slice(0, k).join(' '), words.slice(k).join(' ')])
  let best: PlacedText[] = []
  let bestSize = 0
  for (const lines of options) {
    const longest = Math.max(...lines.map((l) => l.length), 1)
    const size = Math.min(
      maxSize,
      (zone.h - outline * lines.length) / (lines.length * 1.05),
      (zone.w - outline) / (longest * BOLD_RATIO)
    )
    if (size <= bestSize) continue
    bestSize = size
    best = lines.map((line, i) => {
      const w = line.length * BOLD_RATIO * size + outline
      const box = { x: zone.x, y: zone.y + i * size * 1.05, w, h: size + outline }
      return {
        kind: 'title' as const,
        text: line,
        size,
        box,
        rotate: 0,
        center: { x: box.x + w / 2, y: box.y + box.h / 2 }
      }
    })
  }
  return best
}

/**
 * Boxes of a concept thumbnail (Z reading): the dominant subject on the left, the text top
 * right, the conflict element bottom right, an optional red stamp over the seam. The subject
 * never covers less than 40% of the frame: a tall picture is cropped from the top to reach it.
 */
export function conceptLayout(text: string, subjectAspect: number, stampText = ''): ConceptLayout {
  const S = safeArea()
  const right = S.x + S.w
  const frame = V.width * V.height
  const h = V.height - 2 * 36
  const w = Math.min(760, Math.max((0.4 * frame) / h, h * subjectAspect))
  const subject = { x: 36, y: 36, w, h }
  const sx = subject.x + subject.w + 28
  const support = { x: sx, y: 250, w: V.width - 36 - sx, h: V.height - V.strip - 250 }
  const tx = Math.max(sx, S.x)
  const texts = fitLines(text, { x: tx, y: S.y, w: right - tx, h: 200 }, 130)
  const out: ConceptLayout = { subject, support, texts, problems: [] }
  if (stampText)
    out.stamp = fitStamp(
      stampText.toUpperCase(),
      { x: sx - 300, y: 450, w: 560, h: S.y + S.h - 450 },
      110,
      -10
    )
  const share = (subject.w * subject.h) / frame
  if (share < 0.4 || share > 0.6)
    out.problems.push(`Sujeito ocupa ${Math.round(share * 100)}% do quadro (40–60%)`)
  for (const t of [...texts, ...(out.stamp ? [out.stamp] : [])]) {
    if (!inside(t.box, S)) out.problems.push(`Texto "${t.text}" sai da área segura`)
    if (t.size < MIN_TEXT_SIZE)
      out.problems.push(
        `Texto "${t.text}" ilegível na prévia (${Math.round((t.size * THUMB.preview.height) / V.height)} px; mínimo ${V.minPreviewPx})`
      )
  }
  return out
}
