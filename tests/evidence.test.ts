import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdPage } from '../electron/services/chroniclingamerica'
import { createVideo, getVideo } from '../electron/db/repo'
import { getSettings } from '../electron/db/settings'
import { adOverlays } from '../electron/steps/adoverlays'
import { bestAd, findVideoEvidence, videoEvidence } from '../electron/steps/evidence'
import type { Scene, Script } from '../shared/types'
import { freshDb } from './helpers'

const found = vi.hoisted(() => ({ pages: [] as unknown[], queries: [] as string[] }))
vi.mock('../electron/services/llm', () => ({
  generateStructured: async () => ({ product: 'Swamp Root' })
}))
vi.mock('../electron/services/commonsads', () => ({
  findAdPages: async (q: string) => {
    found.queries.push(q)
    return found.pages
  },
  withOcr: async (p: unknown) => p
}))

function page(id: string, ocrText: string): AdPage {
  return {
    id,
    newspaper: 'The Sun',
    city: 'New York',
    state: 'New York',
    date: '1905-03-01',
    page: 4,
    locUrl: `https://loc.gov/${id}`,
    imageUrl: `https://loc.gov/${id}.jpg`,
    ocrText
  }
}

describe('evidence for topics typed by hand', () => {
  beforeEach(() => {
    freshDb()
    found.pages = []
    found.queries = []
  })

  it('picks the page that names the product most and quotes from the first mention', () => {
    const ev = bestAd(
      [
        page('a', 'Local news. Swamp Root sold here.'),
        page(
          'b',
          'DR. KILMER’S SWAMP ROOT cures the kidneys. Try SWAMP-ROOT? no: Swamp  Root today.'
        )
      ],
      'Swamp Root'
    )
    expect(ev?.page.id).toBe('b')
    expect(ev?.phrase).toBe('SWAMP ROOT cures the kidneys. Try')
    expect(bestAd([page('c', 'Nothing about it')], 'Swamp Root')).toBeNull()
  })

  it('searches the product, attaches the best ad and keeps it on the next run', async () => {
    found.pages = [page('b', 'Use Swamp Root for the kidneys.')]
    const v = createVideo({
      topic: 'The Kidney Cure That Was Mostly Alcohol',
      durationMin: 8,
      synthetic: false
    })
    const ev = await findVideoEvidence(getVideo(v.id), getSettings(v.channel_id))
    expect(found.queries).toEqual(['Swamp Root'])
    expect(videoEvidence(v.id)?.page.id).toBe('b')
    expect(ev?.phrase).toMatch(/^Swamp Root/)
    await findVideoEvidence(getVideo(v.id), getSettings(v.channel_id))
    expect(found.queries).toHaveLength(1)
  })

  it('attaches nothing when no ad is found', async () => {
    const v = createVideo({ topic: 'Unknown tonic', durationMin: 8, synthetic: false })
    expect(await findVideoEvidence(getVideo(v.id), getSettings(v.channel_id))).toBeNull()
    expect(videoEvidence(v.id)).toBeNull()
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
})
