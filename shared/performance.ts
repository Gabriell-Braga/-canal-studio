/** Views per day, [YYYY-MM-DD, views], as the Analytics API returns them. */
export type Daily = [string, number][]

/** Live counter read from the Data API at a point in time. */
export interface Snapshot {
  at: string
  views: number
}

const DAY = 86_400_000
const HOUR = 3_600_000

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
}

/** Latest day with data across all videos (Analytics lags 2–3 days behind today). */
export function lastDay(series: Daily[]): string | null {
  let max: string | null = null
  for (const s of series) for (const [d] of s) if (!max || d > max) max = d
  return max
}

/** Channel views per day for the `days` days ending on `end`, missing days as 0. */
export function channelDaily(series: Daily[], end: string, days: number): Daily {
  const byDay = new Map<string, number>()
  for (const s of series) for (const [d, v] of s) byDay.set(d, (byDay.get(d) ?? 0) + v)
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(end, i - days + 1)
    return [d, byDay.get(d) ?? 0]
  })
}

/** Days from `start` to `end`, both included. */
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1
}

/** Views in the 7 days ending on `end` and in the 7 days before; change is null without a base. */
export function weekOverWeek(
  series: Daily,
  end: string
): { current: number; previous: number; change: number | null } {
  const from = addDays(end, -6)
  const prevFrom = addDays(end, -13)
  let current = 0
  let previous = 0
  for (const [d, v] of series) {
    if (d >= from && d <= end) current += v
    else if (d >= prevFrom && d < from) previous += v
  }
  return { current, previous, change: previous ? (current - previous) / previous : null }
}

/** Live views at time `t` (ms), interpolated between the snapshots around it. */
function snapshotAt(snapshots: Snapshot[], t: number): number | null {
  const after = snapshots.findIndex((s) => Date.parse(s.at) >= t)
  if (after < 0) return null
  const b = snapshots[after]
  const tb = Date.parse(b.at)
  if (after === 0) return tb - t <= 2 * HOUR ? b.views : null
  const a = snapshots[after - 1]
  const ta = Date.parse(a.at)
  return a.views + ((b.views - a.views) * (t - ta)) / (tb - ta)
}

/**
 * Views a video had `hours` after release: from live snapshots when they cover that moment,
 * else from Analytics days (whole days only). Null when it is not known (yet).
 * This is how videos released at different times are compared on the same footing.
 */
export function viewsAtAge(
  snapshots: Snapshot[],
  daily: Daily,
  release: string,
  hours: number,
  end: string | null
): number | null {
  const t = Date.parse(release) + hours * HOUR
  if (t > Date.now()) return null
  const live = snapshotAt(snapshots, t)
  if (live !== null) return Math.round(live)
  if (hours % 24 || !end) return null
  const last = addDays(release.slice(0, 10), hours / 24 - 1)
  if (last > end) return null
  return daily.reduce((sum, [d, v]) => (d <= last ? sum + v : sum), 0)
}

/** Views gained in the last `hours`, from live snapshots; null without one that old. */
export function recentGain(snapshots: Snapshot[], hours: number): number | null {
  const latest = snapshots.at(-1)
  if (!latest) return null
  const before = snapshotAt(snapshots, Date.parse(latest.at) - hours * HOUR)
  return before === null ? null : Math.round(latest.views - before)
}

/**
 * Cumulative views by age in hours, [hours, views], up to `maxHours`: Analytics day ends
 * before the first snapshot, then every snapshot.
 */
export function growthCurve(
  snapshots: Snapshot[],
  daily: Daily,
  release: string,
  maxHours: number
): [number, number][] {
  const r = Date.parse(release)
  const age = (t: number): number => (t - r) / HOUR
  const firstLive = snapshots.length ? age(Date.parse(snapshots[0].at)) : Infinity
  const points: [number, number][] = [[0, 0]]
  let sum = 0
  const start = release.slice(0, 10)
  for (const [d, v] of daily) {
    if (d < start) continue
    sum += v
    const h = age(Date.parse(`${addDays(d, 1)}T00:00:00Z`))
    if (h < firstLive && h <= maxHours) points.push([h, sum])
  }
  for (const s of snapshots) {
    const h = age(Date.parse(s.at))
    if (h >= 0 && h <= maxHours) points.push([h, s.views])
  }
  return points
}
