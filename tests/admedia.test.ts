import { describe, expect, it } from 'vitest'
import {
  ANIM_SEC,
  longestStill,
  MAX_USES,
  mergeCards,
  pickAnimationScenes,
  planCards,
  planShots,
  type MediaItem,
  type PlanScene
} from '../electron/steps/admedia'
import { pickCrops } from '../electron/steps/advisuals'
import { byRelevance, verdictOf, type MediaKind } from '../electron/steps/relevance'
import { mixAlerts, type ShotSpan } from '../shared/coverage'
import type { SceneVisual, ShotCategory } from '../shared/visuals'
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
    scenes: [{ narration: 'x' }, { narration: 'x', price: { usd: 1, year: 1903 } }],
    verdict: { law: 'FD&C Act 1938', text: 'Banned as a drug claim since 1938' }
  } as never
  type CardScene = { index: number; missing: number; start: number; end: number; hold: number }
  const sc = (index: number, missing: number, start = 100 + index * 20): CardScene => ({
    index,
    missing,
    start,
    end: start + 20,
    hold: 0
  })

  it('only makes cards that add something: claim, price, closing verdict, never a narration line', () => {
    const cards = planCards([sc(2, 3), sc(3, 1), sc(4, 2)], script, 100, 4)
    expect(cards.get(2)?.map((c) => c.kind)).toEqual(['claim'])
    expect(cards.has(3)).toBe(false)
    expect(cards.get(4)?.[0].sub).toBe('Would It Run Today?')
  })

  it('keeps cards within 8% of the video and never two in a row', () => {
    const many = {
      scenes: Array.from({ length: 20 }, (_, i) => ({ narration: 'x', ad_quote: `quote ${i}` }))
    } as never
    // 20 scenes of 20 s = 400 s; 8% = 32 s; each card holds one 7 s slot.
    const all = Array.from({ length: 20 }, (_, i) => sc(i + 1, 3))
    const cards = planCards(all, many, 32, 20)
    expect(cards.size).toBeLessThanOrEqual(4)
    // Scenes with nothing else (missing = every slot) never put two cards back to back.
    const alone = Array.from({ length: 6 }, (_, i) => sc(i + 1, 3))
    const sparse = planCards(alone, many, 1000, 20)
    const idx = [...sparse.keys()].sort((a, b) => a - b)
    for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBeGreaterThan(1)
  })

  it('alternates real pictures and cards', () => {
    expect(mergeCards(['a', 'b'], ['c1'])).toEqual(['a', 'c1', 'b'])
  })
})

describe('two-level relevance', () => {
  it('uses LITERAL and CONTEXT pictures, literal first, never NONE', () => {
    expect(verdictOf({ level: 'context', what: 'Lynn street 1880s', kind: 'place' }).ok).toBe(true)
    expect(verdictOf({ level: 'none', what: 'a Roman vase', kind: 'other' }).ok).toBe(false)
    const list = byRelevance([
      { f: 'ctx', level: 'context' as const },
      { f: 'no', level: 'none' as const },
      { f: 'lit', level: 'literal' as const }
    ])
    expect(list.map((x) => x.f)).toEqual(['lit', 'ctx'])
  })

  it('plans a literal picture before a context one in the same scene', () => {
    const [sc] = scenes(10, 10)
    const ok = [
      { ...media('street', 'place'), level: 'context' as const },
      { ...media('bottle', 'product'), level: 'literal' as const }
    ]
    const plan = planShots([{ ...sc, start: 200, end: 207, ok }], { ads: [], photos: [] })
    expect(plan.get(0)?.map((m) => m.file)).toEqual(['bottle'])
  })
})

describe('animations', () => {
  type AnimScene = { index: number; start: number; end: number; scan: boolean; visual: SceneVisual }
  const sc = (index: number, visual: SceneVisual, scan = false): AnimScene => ({
    index,
    start: index * 20,
    end: index * 20 + 20,
    scan,
    visual
  })

  it('draws the suggested animations, never on a scan, within 15–25% of the video', () => {
    const list = [sc(0, 'map', true), sc(1, 'map'), sc(2, 'tree'), sc(3, 'photo'), sc(4, 'photo')]
    const picked = pickAnimationScenes(list, 100)
    expect(picked.has(0)).toBe(false)
    expect(picked.get(1)).toBe('map')
    let sec = 0
    for (const [i, k] of picked) sec += Math.min(ANIM_SEC[k], list[i].end - list[i].start)
    expect(sec / 100).toBeLessThanOrEqual(0.25)
  })

  it('adds evidence boards and timelines when the script suggests too few', () => {
    const list = Array.from({ length: 10 }, (_, i) => sc(i, 'photo'))
    const picked = pickAnimationScenes(list, 200)
    let sec = 0
    for (const [i, k] of picked) sec += Math.min(ANIM_SEC[k], list[i].end - list[i].start)
    expect(sec / 200).toBeGreaterThanOrEqual(0.15)
    expect([...picked.values()]).toContain('evidence')
  })
})

describe('detail crops', () => {
  it('frames regions in 16:9 inside the picture, never the whole picture, never twice alike', () => {
    const crops = pickCrops(
      [
        { x: 0.4, y: 0.1, w: 0.15, h: 0.12 },
        { x: 0.41, y: 0.11, w: 0.14, h: 0.11 },
        { x: 0.1, y: 0.7, w: 0.2, h: 0.1 },
        { x: 0, y: 0, w: 0.95, h: 0.95 }
      ],
      { width: 3000, height: 2000 }
    )
    expect(crops).toHaveLength(2)
    for (const c of crops) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x + c.w).toBeLessThanOrEqual(1.0001)
      expect(c.y + c.h).toBeLessThanOrEqual(1.0001)
      expect((c.w * 3000) / (c.h * 2000)).toBeCloseTo(16 / 9, 1)
    }
  })
})

describe('time split of the review', () => {
  const span = (at: number, sec: number, category: ShotCategory, scene = 0): ShotSpan => ({
    at,
    sec,
    src: `${category}${at}`,
    still: true,
    filler: false,
    category,
    scene
  })

  it('fails cards over 8%, two cards in a row and AI over 25%', () => {
    const spans = [
      span(0, 50, 'real'),
      span(50, 20, 'animation'),
      span(70, 5, 'card', 3),
      span(75, 5, 'card', 4),
      span(80, 20, 'ai')
    ]
    const alerts = mixAlerts(spans, 100, 30).join(' | ')
    expect(alerts).toMatch(/Cartões de texto 10% .*cenas 4, 5 precisam de visual/)
    expect(alerts).toMatch(/Dois cartões seguidos/)
    expect(alerts).not.toMatch(/Ilustração de IA/)
    const ai = mixAlerts(
      [span(0, 55, 'real'), span(55, 15, 'animation'), span(70, 30, 'ai')],
      100,
      30
    )
    expect(ai.join()).toMatch(/Ilustração de IA 30%/)
  })

  it('passes a video with half real media, 20% animations and a full bank', () => {
    const ok = [
      span(0, 60, 'real'),
      span(60, 20, 'animation'),
      span(80, 15, 'ai'),
      span(95, 5, 'card')
    ]
    expect(mixAlerts(ok, 100, 30)).toEqual([])
    expect(mixAlerts(ok, 100, 14).join()).toMatch(/Banco de mídia com 14/)
  })
})
