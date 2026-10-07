import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it } from 'vitest'
import { fetchLogos } from '../electron/services/logos'

it('downloads real company logos from Wikidata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'canal-logos-'))
  const files = await fetchLogos(
    [
      { name: 'Apple', wikipedia_title: 'Apple Inc.', values: [] },
      { name: 'Xerox', wikipedia_title: '', values: [] }
    ],
    dir
  )
  expect(files.every(Boolean)).toBe(true)
}, 60_000)
