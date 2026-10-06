/** Night window helpers. Times are local "HH:MM"; a window may cross midnight (22:00–06:00). */

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h % 24) * 60 + (m || 0)
}

export function inWindow(date: Date, start: string, end: string): boolean {
  const t = date.getHours() * 60 + date.getMinutes()
  const s = minutes(start)
  const e = minutes(end)
  if (s === e) return false
  return s < e ? t >= s && t < e : t >= s || t < e
}

/**
 * Identifies one night: the local date on which the current (or last) window started.
 * Used to count how many videos began production "tonight".
 */
export function windowKey(date: Date, start: string, end: string): string {
  const s = minutes(start)
  const e = minutes(end)
  const t = date.getHours() * 60 + date.getMinutes()
  const d = new Date(date)
  // Crossing midnight and we are in the after-midnight part: the window began yesterday.
  if (s > e && t < e) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Retry back-off after attempt 1, 2, 3…: 1, 5, 15 minutes. */
export function backoffMs(attempt: number): number {
  const steps = [1, 5, 15]
  return steps[Math.min(attempt, steps.length) - 1] * 60_000
}
