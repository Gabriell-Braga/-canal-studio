import { describe, expect, it } from 'vitest'
import { MAX_SEGMENT, MIN_SEGMENT, evenSegments, normalizeSegments } from '../electron/steps/shorts'

// 30 scenes of 12 s each.
const scenes = Array.from({ length: 30 }, (_, i) => ({
  index: i,
  start_sec: i * 12,
  end_sec: (i + 1) * 12
}))
const pick = (
  first: number,
  last: number
): {
  first_scene: number
  last_scene: number
  headline: string
  title: string
  description: string
} => ({
  first_scene: first,
  last_scene: last,
  headline: 'H',
  title: 'T',
  description: ''
})

describe('short segments', () => {
  it('trims long picks and extends short ones', () => {
    const [long, short] = normalizeSegments(scenes, [pick(0, 9), pick(20, 20)], 2)
    expect(long.end - long.start).toBeLessThanOrEqual(MAX_SEGMENT)
    expect(short.end - short.start).toBeGreaterThanOrEqual(MIN_SEGMENT)
  })

  it('drops overlapping picks and clamps indexes', () => {
    const out = normalizeSegments(scenes, [pick(3, 5), pick(4, 6), pick(40, 50)], 3)
    expect(out.map((s) => [s.first, s.last])).toEqual(
      [
        [3, 5],
        [29, 29]
      ].slice(0, out.length)
    )
    expect(
      out.every((s, i) => out.every((o, j) => i === j || o.last < s.first || o.first > s.last))
    ).toBe(true)
  })

  it('falls back to evenly spaced cuts', () => {
    const out = evenSegments(scenes, 3, 'Title')
    expect(out).toHaveLength(3)
    expect(out[0].first).toBe(0)
  })
})
