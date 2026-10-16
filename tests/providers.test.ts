import { describe, expect, it } from 'vitest'
import { wellcomeCandidate, type WellcomeImage } from '../electron/services/wellcome'
import {
  findInShard,
  shardPath,
  siCandidates,
  siYear,
  type SiRecord
} from '../electron/services/smithsonian'
import { archivePageCandidates, textRights } from '../electron/services/archives'

const img = (license: string, title = 'Advertisement for a cure, c 1890'): WellcomeImage => ({
  id: 'abc',
  locations: [
    { url: 'https://iiif.wellcomecollection.org/image/L1/info.json', license: { id: license } }
  ],
  source: { id: 'w1', title }
})

describe('Wellcome Collection', () => {
  it('accepts only PDM, CC0 and CC BY, with the credit', () => {
    for (const id of ['pdm', 'cc-0', 'cc-by'])
      expect(wellcomeCandidate(img(id), null)).not.toBeNull()
    for (const id of ['inc', 'cc-by-nc', 'cc-by-nd'])
      expect(wellcomeCandidate(img(id), null)).toBeNull()
    const c = wellcomeCandidate(img('cc-by'), null)
    expect(c?.url).toBe('https://iiif.wellcomecollection.org/image/L1/full/1600,/0/default.jpg')
    expect(c?.credit).toMatch(
      /Wellcome Collection, CC BY 4\.0 \(https:\/\/wellcomecollection\.org\/works\/w1\)/
    )
  })

  it('dates by the work production (latest year), else the title; undated or after 1930 is refused', () => {
    expect(
      wellcomeCandidate(img('pdm', 'A broadsheet'), {
        production: [{ dates: [{ label: '1880-1890' }] }]
      })?.year
    ).toBe(1890)
    expect(wellcomeCandidate(img('pdm', 'A broadsheet'), null)).toBeNull()
    expect(
      wellcomeCandidate(img('pdm', 'A broadsheet'), {
        production: [{ dates: [{ label: '1939' }] }]
      })
    ).toBeNull()
  })
})

const record = (dates: Partial<SiRecord['content']>, access = 'CC0'): SiRecord => ({
  id: 'ld1-1',
  title: "Lydia E. Pinkham's Vegetable Compound",
  content: {
    descriptiveNonRepeating: {
      data_source: 'National Museum of American History',
      online_media: {
        media: [
          {
            type: 'Images',
            content: 'https://ids.si.edu/ids/deliveryService?id=NMAH-1',
            usage: { access }
          }
        ]
      }
    },
    ...dates
  }
})

describe('Smithsonian Open Access', () => {
  it('finds the dump shard from the hash and the record in it', () => {
    expect(shardPath({ unitCode: 'NMAH', hash: '8e51e50ef9' })).toBe('nmah/8e.txt')
    const line = JSON.stringify(record({ indexedStructured: { date: ['1920s'] } }))
    expect(findInShard(`{"id":"x"}\n${line}\n{"id":"y"}`, 'ld1-1')?.title).toMatch(/Pinkham/)
    expect(findInShard(line, 'nope')).toBeNull()
  })

  it('takes the latest year: 1920s passes, 1930s and "after 1906" alone do not', () => {
    expect(siYear(record({ indexedStructured: { date: ['1920s'] } }))).toBe(1929)
    expect(siCandidates(record({ indexedStructured: { date: ['1930s'] } }))).toEqual([])
    expect(siCandidates(record({ freetext: { date: [{ content: 'after 1906' }] } }))).toEqual([])
    expect(
      siYear(record({ freetext: { date: [{ content: 'after 1906' }, { content: 'ca 1923' }] } }))
    ).toBe(1923)
  })

  it('uses only CC0 images, at 1600 px, credited', () => {
    const [c] = siCandidates(record({ indexedStructured: { date: ['1920s'] } }))
    expect(c.url).toBe('https://ids.si.edu/ids/deliveryService?id=NMAH-1&max=1600')
    expect(c.credit).toBe(
      '"Lydia E. Pinkham\'s Vegetable Compound", Smithsonian National Museum of American History, CC0'
    )
    expect(
      siCandidates(record({ indexedStructured: { date: ['1920s'] } }, 'Usage conditions apply'))
    ).toEqual([])
  })
})

describe('Internet Archive texts', () => {
  it('accepts a book by its public-domain rights or by publication up to 1930', () => {
    expect(textRights({ identifier: 'a', year: 1915 })?.rights).toBe(
      'public domain in the US (published 1915)'
    )
    expect(
      textRights({ identifier: 'a', year: 1908, 'possible-copyright-status': 'NOT_IN_COPYRIGHT' })
        ?.rights
    ).toBe('Public domain (not in copyright)')
    expect(textRights({ identifier: 'a', year: 1935 })).toBeNull()
    expect(textRights({ identifier: 'a' })).toBeNull()
  })

  it('gives the first 6 pages of each item, credited', () => {
    const pages = archivePageCandidates(
      [{ identifier: 'LydiaEPinkham', title: 'Lydia E. Pinkham', year: 1915 }],
      new Set()
    )
    expect(pages).toHaveLength(6)
    expect(pages[0].url).toBe('https://archive.org/download/LydiaEPinkham/page/n0_w1600.jpg')
    expect(pages[0].credit).toMatch(/Internet Archive, public domain in the US \(published 1915\)/)
  })
})
