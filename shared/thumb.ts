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

/** Why the preview does not read on a phone (pt-BR); empty when it passes. */
export function thumbProblems(r: ThumbReading): string[] {
  const out: string[] = []
  if (r.coverage < THUMB_CHECK.minCoverage)
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
export function thumbText(text: string, title: string): string {
  const said = new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9$%]+/)
      .filter((w) => w.length > 2 && !TEXT_FILLER.has(w))
  )
  const words = text
    .replace(/["“”]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !said.has(w.toLowerCase().replace(/[^a-z0-9$%]/g, '')))
  while (words.length && TEXT_FILLER.has(words[words.length - 1].toLowerCase())) words.pop()
  while (words.length && TEXT_FILLER.has(words[0].toLowerCase())) words.shift()
  return words.slice(0, THUMB_CHECK.maxWords).join(' ')
}
