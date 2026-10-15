import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdPage } from '../electron/services/chroniclingamerica'
import { createVideo, getVideo } from '../electron/db/repo'
import { getSettings } from '../electron/db/settings'
import { adOverlays } from '../electron/steps/adoverlays'
import {
  bestAd,
  findVideoEvidence,
  productKeyword,
  rankAds,
  searchOrder,
  videoEvidence
} from '../electron/steps/evidence'
import { parseCommonsFile, type CommonsFile } from '../electron/services/commonsads'
import { parseArchiveDoc } from '../electron/services/archives'
import type { Scene, Script } from '../shared/types'
import { freshDb } from './helpers'

/** What each search layer returns in a test, and every call made to it. */
const layers = vi.hoisted(() => ({
  loc: [] as unknown[],
  mirrors: [] as unknown[],
  general: [] as unknown[],
  archive: [] as unknown[],
  calls: [] as string[]
}))

vi.mock('../electron/services/llm', () => ({
  generateStructured: async () => ({
    product: "Lydia E. Pinkham's Vegetable Compound",
    keyword: 'Pinkham',
    terms: ['Pinkham', 'Lydia Pinkham'],
    categories: ['Lydia E. Pinkham Medicine Company']
  })
}))
vi.mock('../electron/services/chroniclingamerica', async (orig) => ({
  ...(await orig<typeof import('../electron/services/chroniclingamerica')>()),
  searchAdPages: async (q: string) => {
    layers.calls.push(`loc:${q}`)
    return layers.loc
  }
}))
vi.mock('../electron/services/commonsads', async (orig) => ({
  ...(await orig<typeof import('../electron/services/commonsads')>()),
  searchCommonsAds: async (q: string) => {
    layers.calls.push(`mirrors:${q}`)
    return layers.mirrors
  },
  searchCommonsGeneral: async (q: string, cats: string[]) => {
    layers.calls.push(`general:${q}:${cats.join('|')}`)
    return layers.general
  },
  withOcr: async (p: unknown) => p
}))
vi.mock('../electron/services/archives', async (orig) => ({
  ...(await orig<typeof import('../electron/services/archives')>()),
  searchArchiveAds: async (q: string) => {
    layers.calls.push(`archive:${q}`)
    return layers.archive
  }
}))

function page(id: string, ocrText: string, extra: Partial<AdPage> = {}): AdPage {
  return {
    id,
    newspaper: 'The Sun',
    city: 'New York',
    state: 'New York',
    date: '1905-03-01',
    page: 4,
    locUrl: `https://loc.gov/${id}`,
    imageUrl: `https://loc.gov/${id}.jpg`,
    ocrText,
    ...extra
  }
}

const PINKHAM = "Lydia E. Pinkham's Vegetable Compound"

describe('matching the product in noisy OCR', () => {
  it('finds the product through line-break hyphens and a missing apostrophe', () => {
    const ev = bestAd([page('a', 'WOMEN READ THIS. PINKHAMS VEGE-\nTABLE COMPOUND cures')], PINKHAM)
    expect(ev?.phrase).toBe('PINKHAMS VEGE- TABLE COMPOUND cures')
  })

  it('takes the most distinctive word as keyword', () => {
    expect(productKeyword(PINKHAM)).toBe('pinkhams')
    expect(productKeyword("Dr. Kilmer's Swamp Root")).toBe('kilmers')
  })

  it('prefers more mentions, then OCR confidence, then resolution', () => {
    const one = 'Ask for Pinkham today.'
    const two = 'Pinkham! Mrs. Pinkham answers letters.'
    expect(bestAd([page('a', one), page('b', two)], PINKHAM, 'Pinkham')?.page.id).toBe('b')
    const ranked = rankAds(
      [
        page('low', one, { ocrConfidence: 70, pixels: 4e6 }),
        page('high', one, { ocrConfidence: 90, pixels: 1e6 }),
        page('big', one, { ocrConfidence: 90, pixels: 3e6 })
      ],
      PINKHAM,
      'Pinkham'
    )
    expect(ranked.best?.page.id).toBe('big')
  })

  it('says why each page was dropped', () => {
    const { best, rejected } = rankAds(
      [page('a', ''), page('b', 'Beecham pills for the liver')],
      PINKHAM,
      'Pinkham'
    )
    expect(best).toBeNull()
    expect(rejected[0]).toMatch(/OCR sem texto/)
    expect(rejected[1]).toMatch(/não cita “Pinkham”/)
  })

  it('searches the shortest terms first, without repeats', () => {
    expect(searchOrder(PINKHAM, ['Pinkham', 'Lydia Pinkham', 'pinkham'])).toEqual([
      'Pinkham',
      'Lydia Pinkham',
      PINKHAM
    ])
  })
})

describe('only public-domain ads up to 1930', () => {
  const file = (over: Partial<CommonsFile>): CommonsFile => ({
    pageid: 7,
    title: 'File:Pinkham trade card.jpg',
    url: 'https://upload.wikimedia.org/x.jpg',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Pinkham_trade_card.jpg',
    license: 'Public domain',
    licenseCode: 'pd',
    copyrighted: 'False',
    categories: 'PD-US-expired',
    credit: '',
    description: 'Trade card for Lydia Pinkham. Lynn, Mass.',
    date: '1885',
    ...over
  })

  it('accepts a dated PD Commons file and refuses later or unlicensed ones', () => {
    const reasons: string[] = []
    const reject = (_t: string, r: string): number => reasons.push(r)
    const ok = parseCommonsFile(file({}), reject)
    expect(ok).toMatchObject({ origin: 'commons', date: '1885', page: '' })
    expect(parseCommonsFile(file({ date: '1936' }), reject)).toBeNull()
    expect(parseCommonsFile(file({ licenseCode: 'cc-by-sa-4.0' }), reject)).toBeNull()
    expect(parseCommonsFile(file({ date: '', description: 'Trade card' }), reject)).toBeNull()
    expect(reasons).toEqual([
      'de 1936, depois de 1930',
      'domínio público não confirmado',
      'sem data'
    ])
  })

  it('accepts an Internet Archive item only with public rights', () => {
    const reasons: string[] = []
    const reject = (_t: string, r: string): number => reasons.push(r)
    const doc = { identifier: 'pinkham-ad', title: 'Pinkham ad', year: '1902' }
    expect(
      parseArchiveDoc(
        { ...doc, licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/' },
        reject
      )
    ).toMatchObject({ origin: 'archive', mirrorPage: 'https://archive.org/details/pinkham-ad' })
    expect(parseArchiveDoc({ ...doc, rights: 'All rights reserved' }, reject)).toBeNull()
    const unknown =
      'Copyright status unknown. Works not in the public domain cannot be commercially exploited.'
    expect(parseArchiveDoc({ ...doc, rights: unknown }, reject)).toBeNull()
    expect(reasons).toEqual([
      'direitos não são de domínio público',
      'direitos não são de domínio público'
    ])
  })
})

describe('evidence for topics typed by hand', () => {
  beforeEach(() => {
    freshDb()
    Object.assign(layers, { loc: [], mirrors: [], general: [], archive: [], calls: [] })
  })

  it('falls through an empty mirror layer to the product categories', async () => {
    layers.general = [
      page('commons:7', 'LYDIA E. PINKHAMS VEGE-\nTABLE COMPOUND', { origin: 'commons' })
    ]
    const v = createVideo({ topic: 'The Woman on the Bottle', durationMin: 8, synthetic: false })
    const logs: string[] = []
    const ev = await findVideoEvidence(getVideo(v.id), getSettings(v.channel_id), undefined, (m) =>
      logs.push(m)
    )
    expect(ev?.page.id).toBe('commons:7')
    expect(videoEvidence(v.id)?.page.origin).toBe('commons')
    expect(layers.calls.slice(0, 7)).toEqual([
      'loc:Pinkham',
      'loc:Lydia Pinkham',
      `loc:${PINKHAM}`,
      'mirrors:Pinkham',
      'mirrors:Lydia Pinkham',
      `mirrors:${PINKHAM}`,
      'general:Pinkham:Lydia E. Pinkham Medicine Company'
    ])
    expect(logs.some((l) => /Commons \(Chronicling America\) “Pinkham”: 0 resultado/.test(l))).toBe(
      true
    )
    expect(logs.at(-1)).toMatch(/Anúncio escolhido/)
  })

  it('keeps the attached ad on the next run', async () => {
    layers.loc = [page('b', 'Use Pinkham for women.')]
    const v = createVideo({ topic: 'Pinkham', durationMin: 8, synthetic: false })
    await findVideoEvidence(getVideo(v.id), getSettings(v.channel_id))
    const calls = layers.calls.length
    await findVideoEvidence(getVideo(v.id), getSettings(v.channel_id))
    expect(layers.calls).toHaveLength(calls)
  })

  it('attaches nothing when no layer finds the product', async () => {
    layers.loc = [page('x', 'Beecham pills')]
    const v = createVideo({ topic: 'Unknown tonic', durationMin: 8, synthetic: false })
    expect(await findVideoEvidence(getVideo(v.id), getSettings(v.channel_id))).toBeNull()
    expect(videoEvidence(v.id)).toBeNull()
    expect(layers.calls.filter((c) => c.startsWith('archive:'))).toHaveLength(3)
  })

  it('does not stamp claims over a scan without a real ad', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canal-scan-'))
    const file = join(dir, 'scene.jpg')
    writeFileSync(
      `${file}.scan.json`,
      JSON.stringify({ page: page('x', ''), phrase: '', crop: {}, highlights: [], words: [] })
    )
    const scene = {
      id: 1,
      video_id: 1,
      index: 0,
      start_sec: 0,
      end_sec: 6,
      asset_path: file
    } as Scene
    const script = {
      claims: [{ scene: 0, quote: 'Cures all', verdict: 'FALSE', source: 'AMA 1911' }]
    } as unknown as Script
    expect(adOverlays(script, [scene]).overlays.claims).toHaveLength(1)
    expect(adOverlays(script, [scene], false).overlays.claims).toHaveLength(0)
  })

  it('shows the archive source on the paper trail instead of a newspaper page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canal-scan-'))
    const file = join(dir, 'scene.jpg')
    const ad = page('commons:7', '', {
      newspaper: 'Trade card for Lydia Pinkham',
      date: '1885',
      page: '',
      city: '',
      state: '',
      origin: 'commons',
      mirrorPage: 'https://commons.wikimedia.org/wiki/File:Pinkham.jpg'
    })
    writeFileSync(
      `${file}.scan.json`,
      JSON.stringify({ page: ad, phrase: '', crop: {}, highlights: [], words: [] })
    )
    const scene = { id: 1, video_id: 1, index: 0, start_sec: 0, end_sec: 6, asset_path: file }
    const { overlays } = adOverlays(null, [scene as Scene])
    expect(overlays.paperTrail).toMatchObject({
      newspaper: 'Trade card for Lydia Pinkham',
      place: 'Wikimedia Commons',
      date: '1885',
      page: '',
      link: 'commons.wikimedia.org/wiki/File:Pinkham.jpg'
    })
  })
})
