import { describe, expect, it } from 'vitest'
import {
  credit,
  filterByDate,
  locatePhrase,
  parseAlto,
  parseResult,
  relativeTo,
  toCandidate
} from '../electron/services/chroniclingamerica'

const ALTO = `<?xml version="1.0"?>
<alto xmlns="http://www.loc.gov/standards/alto/ns-v2#"><Layout>
<Page ID="P1" HEIGHT="2000" WIDTH="1000" PHYSICAL_IMG_NR="1"><PrintSpace>
<TextLine><String ID="S1" HPOS="100" VPOS="200" WIDTH="80" HEIGHT="20" CONTENT="DR."/>
<SP/><String ID="S2" HPOS="190" VPOS="200" WIDTH="120" HEIGHT="20" CONTENT="SANDEN'S"/>
<SP/><String ID="S3" HPOS="320" VPOS="200" WIDTH="150" HEIGHT="24" CONTENT="Eleotric"/>
<SP/><String ID="S4" HPOS="480" VPOS="202" WIDTH="70" HEIGHT="20" CONTENT="BELT,"/></TextLine>
<TextLine><String ID="S5" HPOS="100" VPOS="240" WIDTH="60" HEIGHT="20" CONTENT="cures"/>
<SP/><String ID="S6" HPOS="170" VPOS="240" WIDTH="40" HEIGHT="20" CONTENT="&amp;"/></TextLine>
</PrintSpace></Page></Layout></alto>`

describe('chronicling america', () => {
  it('parses ALTO into page-relative word boxes', () => {
    const { words, width, height, text } = parseAlto(ALTO)
    expect([width, height]).toEqual([1000, 2000])
    expect(words).toHaveLength(6)
    expect(words[0]).toEqual({ text: 'DR.', x: 0.1, y: 0.1, w: 0.08, h: 0.01 })
    expect(text).toBe("DR. SANDEN'S Eleotric BELT, cures &")
  })

  it('locates a phrase despite OCR noise', () => {
    const { words } = parseAlto(ALTO)
    const hit = locatePhrase(words, 'Sandens electric belt')!
    expect(hit.words).toHaveLength(3)
    expect(hit.x).toBeCloseTo(0.19)
    expect(hit.y).toBeCloseTo(0.1)
    expect(hit.x + hit.w).toBeCloseTo(0.55)
    expect(hit.y + hit.h).toBeCloseTo(0.112)
    expect(locatePhrase(words, 'magnetic corset')).toBeNull()
  })

  it('maps a box into crop coordinates', () => {
    expect(
      relativeTo({ x: 0.1, y: 0.25, w: 0.5, h: 0.5 }, { x: 0.2, y: 0.375, w: 0.1, h: 0.25 })
    ).toEqual({
      x: 0.2,
      y: 0.25,
      w: 0.2,
      h: 0.5
    })
  })

  it('never returns pages after 1930', () => {
    const pages = [
      { date: '1899-01-01' },
      { date: '1925-06-01' },
      { date: '1930-12-31' },
      { date: '1931-01-01' }
    ]
    expect(filterByDate(pages, 1900, 1950).map((p) => p.date)).toEqual(['1925-06-01', '1930-12-31'])
    expect(filterByDate(pages).map((p) => p.date)).toEqual([
      '1899-01-01',
      '1925-06-01',
      '1930-12-31'
    ])
  })

  it('maps a loc.gov result and credits it', () => {
    const page = parseResult({
      id: 'https://www.loc.gov/resource/sn83045462/1907-05-27/ed-1/?sp=2&q=electric+belt',
      date: '1907-05-27',
      partof_title: ['evening star (washington, d.c.) 1854-1972'],
      location_city: ['washington'],
      location_state: ['district of columbia'],
      image_url: [
        'https://tile.loc.gov/image-services/iiif/service:ndnp:dcu:batch_dcu_x:data:sn83045462:00280652179:1907052701:0200/full/pct:6.25/0/default.jpg#h=1&w=1'
      ]
    })!
    expect(page.id).toBe('sn83045462/1907-05-27/ed-1/seq-2')
    expect(page.altoUrl).toBe(
      'https://tile.loc.gov/storage-services/service/ndnp/dcu/batch_dcu_x/data/sn83045462/00280652179/1907052701/0200.xml'
    )
    expect(credit(page)).toBe(
      'Evening Star (Washington, District Of Columbia), May 27, 1907, page 2. Library of Congress, Chronicling America: https://www.loc.gov/resource/sn83045462/1907-05-27/ed-1/?sp=2'
    )
    expect(toCandidate(page, 'x.jpg')).toMatchObject({
      source: 'loc:sn83045462/1907-05-27/ed-1/seq-2',
      kind: 'stock_photo',
      url: 'x.jpg'
    })
  })
})
