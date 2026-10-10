import { describe, expect, it } from 'vitest'
import {
  MAX_SEGMENT,
  MIN_SEGMENT,
  evenSegments,
  extendSegment,
  normalizeSegments,
  remapTime,
  spokenLength,
  tightCuts
} from '../electron/steps/shorts'

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

describe('tightCuts', () => {
  it('shrinks long pauses between words and keeps short ones', () => {
    const words = [
      { start: 0.5, end: 1 },
      { start: 1.1, end: 1.5 },
      { start: 3, end: 3.5 }
    ]
    const cuts = tightCuts(words, 5)
    expect(cuts).toEqual([
      { from: 0.38, to: 1.62, at: 0 },
      { from: 2.88, to: 3.8, at: expect.closeTo(1.24) }
    ])
    expect(remapTime(cuts, 1)).toBeCloseTo(0.62)
    expect(remapTime(cuts, 2)).toBeCloseTo(1.24)
    expect(remapTime(cuts, 3)).toBeCloseTo(1.36)
    expect(remapTime(cuts, 5)).toBeCloseTo(2.16)
  })
})

describe('extendSegment', () => {
  // Scenes of 12 s each with one word per second and a 2 s pause at the end of each scene.
  const words = Array.from({ length: 360 }, (_, i) => ({ start: i, end: i + 0.8 })).filter(
    (w) => w.start % 12 < 10
  )
  const length = (a: number, b: number): number => spokenLength(words, a, b)

  it('adds following scenes until the cut lasts its old length again', () => {
    const longer = extendSegment(scenes, 24, 60, 36, [], length)
    expect(longer).toEqual({ last: 5, end: 72 })
    expect(length(24, 72)).toBeGreaterThanOrEqual(36)
  })

  it('stops before scenes another short uses', () => {
    expect(extendSegment(scenes, 24, 60, 36, [[60, 84]], length)).toBeNull()
  })
})
