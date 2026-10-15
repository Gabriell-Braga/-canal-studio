/** Seconds of the opening where images change fastest. */
export const FIRST_MINUTE_SEC = 60

/** Longest an image may stay on screen: 5 s in the first minute, 7 s after. */
export function maxStillSec(at: number): number {
  return at < FIRST_MINUTE_SEC ? 5 : 7
}

/**
 * How long each image of a scene stays up, in order. `hold` keeps the first image longer
 * (the scan while the period announcer reads it); the rest is split into equal parts no
 * longer than the cadence allows at that point of the video.
 */
export function shotDurations(start: number, end: number, hold = 0): number[] {
  const out: number[] = []
  let t = start
  if (hold > 0) {
    const h = Math.min(hold, end - start)
    out.push(h)
    t += h
  }
  while (end - t > 0.05) {
    const left = end - t
    const d = left / Math.ceil(left / maxStillSec(t) - 1e-9)
    out.push(d)
    t += d
  }
  return out.length ? out : [Math.max(0, end - start)]
}
