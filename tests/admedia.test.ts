import { describe, expect, it } from 'vitest'
import {
  longestStill,
  MAX_USES,
  mergeCards,
  cardLines,
  planCards,
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

  it('never goes past MAX_USES, even with almost nothing to show (cards fill the rest)', () => {
    const plan = planShots(scenes(300, 15), { ads: [media('ad0', 'ad', true)], photos: [] })
    const uses = [...plan.values()].flat().filter((m) => m.file === 'ad0').length
    expect(uses).toBe(MAX_USES)
  })

  it('never shows a picture in a scene that refused it, not even as a fallback', () => {
    const lynn = media('lynn', 'place')
    const sc = scenes(200, 20).map((s) => ({ ...s, banned: new Set(['lynn']) }))
    const plan = planShots(sc, { ads: [], photos: [lynn] })
    expect([...plan.values()].flat()).toHaveLength(0)
  })

  it('keeps pictures of another era out of a scene unless it talks about later', () => {
    const box = { ...media('box1950', 'product'), year: 1950 }
    const [sc] = scenes(20, 20)
    const birth = { ...sc, start: 100, end: 120, year: 1819, narration: 'She was born in Lynn.' }
    expect(planShots([birth], { ads: [], photos: [box] }).get(0)).toEqual([])
    const after = { ...birth, narration: 'Decades later the company still sold it.' }
    expect(planShots([after], { ads: [], photos: [box] }).get(0)).toEqual([box])
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

describe('planCards', () => {
  const script = {
    claims: [{ scene: 2, quote: 'Cures uterine trouble', verdict: 'FALSE', source: 'JAMA, 1915' }],
    scenes: [{ narration: 'x' }, { narration: 'x', price: { usd: 1, year: 1903 } }]
  } as never
  const sc = (index: number, missing: number, narration = '', year: number | null = null) => ({
    index,
    missing,
    narration,
    year
  })

  it('fills the empty slots with the claim, the price, then lines of the narration, never twice', () => {
    const cards = planCards(
      [
        sc(
          2,
          3,
          'In 1903 the paper ran the ad for her cure. Women believed every single word of it.',
          1903
        )
      ],
      script,
      [1819, 1875, 1883, 1903]
    )
    const kinds = cards.get(2)?.map((c) => c.kind)
    expect(kinds).toEqual(['claim', 'price', 'timeline'])
    const again = planCards([sc(1, 2, 'x'), sc(3, 1, 'x')], script, [null])
    expect(again.size).toBe(0)
  })

  it('cuts long sentences into readable parts instead of dropping them', () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ') + '.'
    const lines = cardLines(`Too short. ${long}`)
    expect(lines).toHaveLength(3)
    for (const l of lines) expect(l.replace(/…/g, '').split(' ').length).toBeLessThanOrEqual(14)
  })

  it('alternates real pictures and cards', () => {
    expect(mergeCards(['a', 'b'], ['c1'])).toEqual(['a', 'c1', 'b'])
  })
})
