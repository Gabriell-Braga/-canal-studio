import { describe, expect, it } from 'vitest'
import { buildReport } from '../shared/coverage'
import type { RenderScene } from '../shared/render'

const img = (src: string, sec: number): Omit<RenderScene, 'start' | 'end'> => ({
  src: `{{root}}/scenes/${src}`,
  type: 'image',
  motion: 0,
  sec
})
const scene = (start: number, end: number, ...shots: ReturnType<typeof img>[]): RenderScene => {
  const [main, ...rest] = shots
  return { ...main, start, end, shots: rest }
}

describe('review report', () => {
  it('finds the longest still and flags stills over the cadence', () => {
    const r = buildReport(
      [scene(0, 12, img('a.jpg', 4), img('b.jpg', 8)), scene(70, 79, img('c.jpg', 9))],
      79,
      [],
      []
    )
    expect(r.longestStill).toMatchObject({ file: 'c.jpg', sec: 9 })
    // 8 s at 0:04 breaks the 5 s rule of the first minute; 9 s after it breaks the 8 s rule.
    expect(r.longStills.map((s) => s.file)).toEqual(['b.jpg', 'c.jpg'])
    expect(r.noMedia).toEqual([{ from: 12, to: 70 }])
  })

  it('counts repeated files and flags more than 3 uses', () => {
    const r = buildReport(
      [
        scene(0, 20, img('a.jpg', 5), img('a.jpg', 5), img('b.jpg', 5), img('a.jpg', 5)),
        scene(20, 30, img('a.jpg', 5), img('b.jpg', 5))
      ],
      30,
      [],
      []
    )
    expect(r.repeated).toEqual([
      { file: 'a.jpg', count: 4 },
      { file: 'b.jpg', count: 2 }
    ])
    expect(r.alerts.some((a) => a.includes('a.jpg') && a.includes('4 vezes'))).toBe(true)
    expect(r.alerts.some((a) => a.includes('b.jpg'))).toBe(false)
  })

  it('flags announcer segments that break the rules', () => {
    const scenes = [scene(0, 400, img('a.jpg', 400))]
    const ok = buildReport(
      scenes,
      400,
      [
        { start: 70, end: 76 },
        { start: 200, end: 206 }
      ],
      []
    )
    expect(ok.alerts.some((a) => a.includes('Locutor'))).toBe(false)
    const bad = buildReport(
      scenes,
      400,
      [
        { start: 30, end: 35 },
        { start: 100, end: 105 },
        { start: 150, end: 155 },
        { start: 300, end: 305 }
      ],
      []
    )
    expect(bad.alerts.join('\n')).toMatch(/antes de 60 s/)
    expect(bad.alerts.join('\n')).toMatch(/4 trechos/)
    expect(bad.alerts.join('\n')).toMatch(/menos de 90 s/)
  })
})

describe('opening highlight', () => {
  it('falls back to the first claim when the hook quote is too short', async () => {
    const { hookBoxes } = await import('../electron/steps/adoverlays')
    const words = 'Lydia Pinkham cured of irregularities and uterine trouble'
      .split(' ')
      .map((text, i) => ({ text, x: i * 0.1, y: 0.5, w: 0.08, h: 0.03 }))
    const scan = { words, highlights: [] } as unknown as Parameters<typeof hookBoxes>[0]
    const script = {
      claims: [{ scene: 3, quote: 'cured of irregularities and uterine trouble' }]
    } as unknown as Parameters<typeof hookBoxes>[2]
    const boxes = hookBoxes(scan, 'Lydia Pinkham', script)
    expect(boxes.length).toBe(6)
    expect(boxes[0].x).toBeCloseTo(0.2)
  })
})
