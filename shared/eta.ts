/**
 * Time left for a queue job, from two measured sources: how long the same step took on the
 * last videos (median), and how fast this run is moving (elapsed / progress). The further
 * the run, the more its own pace counts. No source yet: null, never a made-up number.
 */
export function jobEta(
  progress: number | null,
  elapsedSec: number,
  typicalSec: number | undefined
): number | null {
  const p = Math.max(0, Math.min(1, progress ?? 0))
  // Below 5% the pace is mostly startup time (loading models, bundling).
  if (p < 0.05) return typicalSec && typicalSec > elapsedSec ? typicalSec - elapsedSec : null
  const ownPace = (elapsedSec * (1 - p)) / p
  const usual = typicalSec ? typicalSec * (1 - p) : ownPace
  return p * ownPace + (1 - p) * usual
}

export function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** "45 s", "4 min 05 s", "1 h 12 min". */
export function formatDuration(sec: number): string {
  const t = Math.max(0, Math.round(sec))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m) return `${m} min ${String(s).padStart(2, '0')} s`
  return `${s} s`
}
