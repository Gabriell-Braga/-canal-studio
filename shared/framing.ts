import type { Focus } from './render'

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
