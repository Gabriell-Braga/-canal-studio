import type { PublishSlot } from '../../shared/types'

/** Offset (ms) of `timeZone` from UTC at a given instant. */
function tzOffset(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(instant)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  )
  return asUtc - instant.getTime()
}

/** Wall-clock time in a time zone → UTC instant. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = guess - tzOffset(new Date(guess), timeZone)
  // Second pass fixes the guess when it lands on the other side of a DST change.
  return new Date(guess - tzOffset(new Date(first), timeZone))
}

/** Calendar date (y, m, d, weekday) of an instant in a time zone. */
function zonedDate(
  instant: Date,
  timeZone: string
): { y: number; m: number; d: number; wd: number } {
  const local = new Date(instant.getTime() + tzOffset(instant, timeZone))
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    wd: local.getUTCDay()
  }
}

/**
 * First slot after `from` (plus a 1 h margin so the upload has time) that no other video uses.
 * Returns an ISO string in UTC.
 */
export function nextFreeSlot(
  slots: PublishSlot[],
  timeZone: string,
  taken: string[],
  from: Date = new Date()
): string {
  if (!slots.length) throw new Error('Nenhum horário de publicação configurado')
  const minTime = from.getTime() + 60 * 60_000
  const takenSet = new Set(taken.map((t) => new Date(t).getTime()))
  const start = zonedDate(from, timeZone)
  for (let dayOffset = 0; dayOffset < 400; dayOffset++) {
    const base = new Date(Date.UTC(start.y, start.m - 1, start.d + dayOffset))
    const y = base.getUTCFullYear()
    const m = base.getUTCMonth() + 1
    const d = base.getUTCDate()
    const wd = base.getUTCDay()
    const candidates = slots
      .filter((s) => s.weekday === wd)
      .map((s) => {
        const [hh, mm] = s.time.split(':').map(Number)
        return zonedToUtc(y, m, d, hh, mm || 0, timeZone)
      })
      .sort((a, b) => a.getTime() - b.getTime())
    for (const c of candidates) {
      if (c.getTime() >= minTime && !takenSet.has(c.getTime())) return c.toISOString()
    }
  }
  throw new Error('Nenhum horário livre encontrado')
}
