import { describe, expect, it } from 'vitest'
import { channelDaily, firstWeek, lastDay, weekOverWeek } from '../shared/performance'

describe('performance', () => {
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

  it('counts only the first 7 days after release', () => {
    expect(firstWeek(a, '2026-09-28T15:00:00Z', '2026-10-05')).toEqual({
      views: 15,
      complete: true
    })
    expect(firstWeek(a, '2026-10-01T15:00:00Z', '2026-10-05').complete).toBe(false)
  })
})
