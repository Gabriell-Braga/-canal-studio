import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  channelDaily,
  growthCurve,
  lastDay,
  recentGain,
  viewsAtAge,
  weekOverWeek
} from '../shared/performance'

describe('performance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const a: [string, number][] = [
    ['2026-09-28', 10],
    ['2026-09-30', 5],
    ['2026-10-05', 20]
  ]
  const b: [string, number][] = [['2026-09-30', 1]]

  it('sums the channel per day and fills gaps', () => {
    expect(lastDay([a, b])).toBe('2026-10-05')
    const daily = channelDaily([a, b], '2026-10-05', 8)
    expect(daily[0]).toEqual(['2026-09-28', 10])
    expect(daily[1]).toEqual(['2026-09-29', 0])
    expect(daily[2]).toEqual(['2026-09-30', 6])
    expect(daily.at(-1)).toEqual(['2026-10-05', 20])
  })

  it('compares the last 7 days with the 7 before', () => {
    expect(weekOverWeek(a, '2026-10-05')).toEqual({ current: 25, previous: 10, change: 1.5 })
    expect(weekOverWeek(b, '2026-10-20').change).toBeNull()
  })

  const snaps = [
    { at: '2026-10-08T15:30:00Z', views: 0 },
    { at: '2026-10-08T20:00:00Z', views: 100 },
    { at: '2026-10-09T10:00:00Z', views: 300 }
  ]

  it('reads views at an age from snapshots, interpolating between them', () => {
    // 24h after 2026-10-08T00:00 sits between the 2nd and 3rd snapshot: 100 + 200 * 4/14.
    expect(viewsAtAge(snaps, [], '2026-10-08T00:00:00Z', 24, null)).toBe(157)
    // Not reached yet.
    expect(viewsAtAge(snaps, [], '2026-10-08T15:00:00Z', 48, null)).toBeNull()
  })

  it('falls back to whole Analytics days without snapshots', () => {
    expect(viewsAtAge([], a, '2026-09-28T15:00:00Z', 72, '2026-10-05')).toBe(15)
    expect(viewsAtAge([], a, '2026-10-04T15:00:00Z', 72, '2026-10-05')).toBeNull()
  })

  it('measures recent gains and growth curves', () => {
    expect(recentGain(snaps, 14)).toBe(200)
    expect(recentGain(snaps, 48)).toBeNull()
    const curve = growthCurve(snaps, [['2026-10-08', 50]], '2026-10-08T15:00:00Z', 168)
    expect(curve[0]).toEqual([0, 0])
    expect(curve.at(-1)).toEqual([19, 300])
  })
})
