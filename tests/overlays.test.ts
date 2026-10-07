import { describe, expect, it } from 'vitest'
import { formatUsd, valueAt, yearChanges } from '../shared/render'
import { unspokenYears } from '../electron/steps/script'

describe('year cards', () => {
  it('marks only scenes that change the year', () => {
    const changes = yearChanges([null, 1976, 1976, null, 1984, 1984, 1997, null])
    expect([...changes.entries()]).toEqual([
      [1, { year: 1976, from: null }],
      [4, { year: 1984, from: 1976 }],
      [6, { year: 1997, from: 1984 }]
    ])
  })

  it('flags a new year the narrator does not say', () => {
    const scene = (
      narration: string,
      year: number | null
    ): {
      narration: string
      visual_keywords: string
      image_prompt: string
      year: number | null
    } => ({ narration, visual_keywords: '', image_prompt: '', year })
    const silent = unspokenYears({
      title_options: ['t'],
      hook: 'h',
      outro: 'o',
      scenes: [
        scene('In 1976, two friends...', 1976),
        scene('Later that year.', 1976),
        scene('Then everything changed.', 1984)
      ]
    })
    expect(silent).toEqual([{ scene: 3, year: 1984 }])
  })
})

describe('company values', () => {
  const values = [
    { year: 1976, usd: 0 },
    { year: 1980, usd: 1.8e9 },
    { year: 2000, usd: 18e9 }
  ]

  it('holds, interpolates and stays empty before the first point', () => {
    expect(valueAt(values, 1970)).toBeNull()
    expect(valueAt(values, 1980)).toBe(1.8e9)
    expect(valueAt(values, 2020)).toBe(18e9)
    const mid = valueAt(values, 1990) as number
    expect(mid).toBeGreaterThan(1.8e9)
    expect(mid).toBeLessThan(18e9)
  })

  it('formats like a ticker', () => {
    expect(formatUsd(1.8e9)).toBe('1.8B')
    expect(formatUsd(3.4e12)).toBe('3.4T')
    expect(formatUsd(350e6)).toBe('350M')
    expect(formatUsd(2e9)).toBe('2B')
    expect(formatUsd(0)).toBe('0')
  })
})

describe('channel intro schedule', async () => {
  const { scheduleLabel } = await import('../electron/steps/overlays')
  const at = (days: number[], time = '14:00'): { weekday: number; time: string }[] =>
    days.map((weekday) => ({ weekday, time }))

  it('says how often videos come out', () => {
    expect(scheduleLabel(at([0, 1, 2, 3, 4, 5, 6]), 'America/New_York')).toBe(
      'New video every day · 2 PM ET'
    )
    expect(scheduleLabel(at([1, 3, 5], '09:30'), 'America/New_York')).toBe(
      'New videos Mon · Wed · Fri · 9:30 AM ET'
    )
    expect(scheduleLabel(at([1, 2, 3, 4, 5]), 'America/New_York')).toBe(
      'New videos every weekday · 2 PM ET'
    )
    expect(scheduleLabel([], 'America/New_York')).toBe('')
  })
})
