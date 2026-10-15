import { describe, expect, it } from 'vitest'
import { adRegion } from '../electron/services/adscan'
import { adOverlays } from '../electron/steps/adoverlays'
import { formatOf, scriptSchemaFor } from '../shared/formats'
import { adSceneData } from '../shared/formats/vintage-ads'
import type { Scene, Script } from '../shared/types'

const script = {
  title_options: ['They Invented a Disease to Sell Mouthwash'],
  hook: 'Halitosis. A word nobody used.',
  hook_ad_quote: 'Even your best friends won’t tell you',
  scenes: [
    {
      narration: 'A',
      visual_keywords: '',
      image_prompt: '',
      real_subject: '',
      ad_quote: '',
      price: { usd: 1, year: 1924 },
      scan: false
    },
    {
      narration: 'B',
      visual_keywords: '',
      image_prompt: '',
      real_subject: '',
      ad_quote: 'Cures in a week',
      price: null,
      scan: true
    }
  ],
  outro: 'C',
  claims: [
    { scene: 2, quote: 'Cures in a week', verdict: 'FALSE', source: 'JAMA, 1915' },
    { scene: 1, quote: 'No source', verdict: 'FALSE', source: '' }
  ],
  ingredients: null,
  verdict: { law: 'FTC Act 1914', text: 'False health claims were banned.' }
} as unknown as Script

function scene(index: number, start: number, end: number): Scene {
  return {
    id: index + 1,
    video_id: 1,
    index,
    narration: '',
    visual_keywords: '',
    image_prompt: '',
    real_subject: '',
    asset_type: 'stock_photo',
    asset_path: null,
    asset_source: null,
    asset_credit: null,
    start_sec: start,
    end_sec: end,
    locked: false,
    year: null,
    realistic: false,
    extra_assets: []
  }
}

describe('Ads on Trial', () => {
  it('validates the overlay fields of the format', () => {
    const schema = scriptSchemaFor(formatOf('vintage-ads'))
    const parsed = schema.parse({
      ...script,
      teaser: 't',
      hook_visual_keywords: '',
      outro_visual_keywords: ''
    })
    expect(parsed.claims).toHaveLength(2)
  })

  it('maps scenes to ad lines, prices and scans', () => {
    expect(adSceneData(script, 0)).toEqual({
      adQuote: 'Even your best friends won’t tell you',
      price: null,
      scan: true
    })
    expect(adSceneData(script, 1).price).toEqual({ usd: 1, year: 1924 })
    expect(adSceneData(script, 2).scan).toBe(true)
  })

  it('builds price tags from the CPI table and stamps only sourced claims', () => {
    const { overlays } = adOverlays(script, [
      scene(0, 0, 6),
      scene(1, 6, 14),
      scene(2, 14, 22),
      scene(3, 22, 30)
    ])
    expect(overlays.priceTags[0].today).toMatch(/\$/)
    expect(overlays.claims).toHaveLength(1)
    expect(overlays.claims[0].verdict).toBe('FALSE')
    expect(overlays.verdict?.law).toBe('FTC Act 1914')
    expect(overlays.verdict?.at).toBeCloseTo(22.5)
  })

  it('crops the whole ad around a phrase, capped in size', () => {
    const words = [
      { text: 'ELECTRIC', x: 0.1, y: 0.2, w: 0.05, h: 0.01 },
      { text: 'BELT', x: 0.16, y: 0.2, w: 0.03, h: 0.01 },
      { text: 'cures', x: 0.1, y: 0.25, w: 0.03, h: 0.01 },
      { text: 'far', x: 0.7, y: 0.25, w: 0.03, h: 0.01 }
    ]
    const r = adRegion(words, { x: 0.1, y: 0.2, w: 0.09, h: 0.01 })
    expect(r.x).toBeLessThanOrEqual(0.1)
    expect(r.y + r.h).toBeGreaterThanOrEqual(0.26)
    expect(r.w).toBeLessThanOrEqual(0.35)
  })
})
