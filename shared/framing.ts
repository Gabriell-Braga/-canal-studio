import type { Box, Focus } from './render'

/** Where in the frame the focus point lands: centered across, a little above the middle. */
const TARGET = { x: 0.5, y: 0.4 }

/**
 * CSS object-position (percent) that crops an image with object-fit: cover so its focus point
 * lands near TARGET, without ever showing an edge. Centered without a focus.
 */
export function objectPosition(focus: Focus | undefined, width: number, height: number): string {
  if (!focus) return '50% 50%'
  // Size of the image once it covers the frame.
  const scale = Math.max(width / focus.aspect, height)
  const w = focus.aspect * scale
  const h = scale
  // object-position p puts the image's left edge at (frame - image) * p.
  const axis = (f: number, img: number, frame: number, target: number): number =>
    img - frame < 1
      ? 50
      : Math.min(100, Math.max(0, ((f * img - target * frame) / (img - frame)) * 100))
  return `${axis(focus.x, w, width, TARGET.x).toFixed(1)}% ${axis(focus.y, h, height, TARGET.y).toFixed(1)}%`
}

/**
 * Parts of an ad scan (0–1 boxes) for the camera to close in on, one per shot of the same
 * scan: the illustration above the text, then the OCR text split into bands of lines.
 * Without OCR words: the top, middle and bottom of the scan.
 */
export function scanRegions(words: Box[]): Box[] {
  if (words.length < 6) return [0, 0.3, 0.6].map((y) => ({ x: 0, y, w: 1, h: 0.4 }))
  const sorted = [...words].sort((a, b) => a.y - b.y)
  // A short block of text in 3 bands would give near-identical close-ups: 2 then.
  const tall = Math.max(...sorted.map((b) => b.y + b.h)) - sorted[0].y > 0.45
  const bands = Math.min(tall ? 3 : 2, Math.floor(sorted.length / 4))
  const out: Box[] = []
  const top = sorted[0].y
  if (top > 0.25) out.push({ x: 0, y: 0, w: 1, h: top })
  for (let k = 0; k < bands; k++) {
    const part = sorted.slice(
      Math.floor((k * sorted.length) / bands),
      Math.floor(((k + 1) * sorted.length) / bands)
    )
    const x = Math.min(...part.map((b) => b.x))
    const y = Math.min(...part.map((b) => b.y))
    const r = Math.max(...part.map((b) => b.x + b.w))
    const bt = Math.max(...part.map((b) => b.y + b.h))
    out.push({ x, y, w: r - x, h: bt - y })
  }
  return out
}
