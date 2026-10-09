/** Views per day, [YYYY-MM-DD, views], as the Analytics API returns them. */
export type Daily = [string, number][]

const DAY = 86_400_000

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

/**
 * Views in a video's first 7 days, the fair way to compare videos released at different times.
 * `complete` is false while the video is younger than 7 days of data.
 */
export function firstWeek(
  series: Daily,
  release: string,
  end: string
): { views: number; complete: boolean } {
  const start = release.slice(0, 10)
  const stop = addDays(start, 6)
  const views = series.reduce((t, [d, v]) => (d >= start && d <= stop ? t + v : t), 0)
  return { views, complete: stop <= end }
}
