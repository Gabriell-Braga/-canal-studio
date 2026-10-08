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

it('never reuses another company logo kept in the project', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'canal-logos-'))
  const [meta] = await fetchLogos(
    [{ name: 'Meta', wikipedia_title: 'Meta Platforms', values: [] }],
    dir
  )
  const [google] = await fetchLogos(
    [{ name: 'Google', wikipedia_title: 'Google', values: [] }],
    dir
  )
  expect(google).not.toBe(meta)
  expect(google).toMatch(/logo_google\.png$/)
}, 60_000)
