import { describe, expect, it } from 'vitest'
import {
  longestStill,
  MAX_USES,
  planShots,
  type MediaItem,
  type PlanScene
} from '../electron/steps/admedia'
import type { MediaKind } from '../electron/steps/relevance'
import { maxStillSec } from '../shared/shots'

const media = (file: string, kind: MediaKind, main = false): MediaItem => ({
  file,
  kind,
  type: 'stock_photo',
  source: file,
  credit: null,
  main
})

/** Scenes of `sec` seconds back to back, from 0 to `total`. */
function scenes(total: number, sec: number, extra: Partial<PlanScene> = {}): PlanScene[] {
  const out: PlanScene[] = []
  for (let t = 0, i = 0; t < total; t += sec, i++)
    out.push({
      index: i,
      start: t,
      end: Math.min(total, t + sec),
      hold: 0,
      scan: false,
      mainAd: false,
      ok: [],
      ...extra
    })
  return out
}

describe('planShots', () => {
  const ads = [media('ad0', 'ad', true), media('ad1', 'ad'), media('ad2', 'ad')]
  const photos = [media('bottle', 'product'), media('lydia', 'portrait'), media('lynn', 'place')]

  it('never leaves a scene without media, even with almost nothing to show', () => {
    const plan = planShots(scenes(300, 15), { ads: [media('ad0', 'ad', true)], photos: [] })
    for (const list of plan.values()) expect(list.length).toBeGreaterThan(0)
  })

  it('falls back to other ads, then period photos, then reuse, when a scene has no approved picture', () => {
    const [sc] = scenes(20, 20)
    const plan = planShots([{ ...sc, start: 100, end: 120 }], { ads, photos })
    const kinds = plan.get(0)?.map((m) => m.kind)
    // 20 s after the first minute at most 7 s each: 3 images, ads first.
    expect(kinds).toEqual(['ad', 'ad', 'ad'])
    const second = planShots([{ ...sc, start: 100, end: 120 }], { ads: [ads[0]], photos })
    expect(second.get(0)?.map((m) => m.kind)).toEqual(['ad', 'product', 'portrait'])
  })

  it('prefers approved pictures by priority: ad, product, portrait, place, event', () => {
    const [sc] = scenes(10, 10)
    const ok = [media('engraving', 'event'), media('lynn2', 'place'), media('bottle2', 'product')]
    const plan = planShots([{ ...sc, start: 200, end: 214, ok }], { ads: [], photos: [] })
    expect(plan.get(0)?.map((m) => m.file)).toEqual(['bottle2', 'lynn2'])
  })

  it('keeps every file at most MAX_USES times while other media is left', () => {
    const many = Array.from({ length: 40 }, (_, i) => media(`p${i}`, 'place'))
    const plan = planShots(scenes(600, 15), { ads, photos: [...photos, ...many] })
    const count = new Map<string, number>()
    for (const list of plan.values())
      for (const m of list) count.set(m.file, (count.get(m.file) ?? 0) + 1)
    expect(Math.max(...count.values())).toBeLessThanOrEqual(MAX_USES)
  })

  it('keeps no image up longer than the cadence when there is enough media', () => {
    const many = Array.from({ length: 80 }, (_, i) => media(`p${i}`, 'place'))
    const sc = scenes(600, 15)
    const plan = planShots(sc, { ads, photos: [...photos, ...many] })
    for (const s of sc)
      expect(longestStill(s, plan.get(s.index)?.length ?? 0)).toBeLessThanOrEqual(
        maxStillSec(s.start) + 0.01
      )
  })

  it('opens on the scan and shows the product and the face in the first minute', () => {
    const sc = scenes(120, 20)
    sc[0] = { ...sc[0], scan: true, mainAd: true }
    const plan = planShots(sc, { ads, photos })
    expect(plan.get(0)?.[0].file).toBe('ad0')
    const first = [...plan.entries()]
      .filter(([i]) => sc[i].start < 60)
      .flatMap(([, l]) => l.map((m) => m.kind))
    expect(first).toContain('product')
    expect(first).toContain('portrait')
  })

  it('reports the longest still when a scene has fewer images than slots', () => {
    expect(longestStill({ start: 100, end: 121, hold: 0 }, 1)).toBe(21)
    expect(longestStill({ start: 100, end: 121, hold: 0 }, 3)).toBe(7)
  })
})
