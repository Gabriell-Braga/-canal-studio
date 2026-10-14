import { mkdtempSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it } from 'vitest'
import {
  cropAd,
  credit,
  fetchOcrWords,
  locatePhrase,
  relativeTo,
  searchAdPages
} from '../electron/services/chroniclingamerica'

it(
  'finds an electric belt ad, locates it in the OCR and crops it',
  { timeout: 300_000 },
  async () => {
    const pages = await searchAdPages('electric belt', { from: 1900, to: 1925, limit: 5 })
    expect(pages.length).toBeGreaterThan(0)
    for (const p of pages) expect(Number(p.date.slice(0, 4))).toBeLessThanOrEqual(1925)
    for (const page of pages) {
      const ocr = await fetchOcrWords(page)
      const hit = locatePhrase(ocr.words, 'electric belt')
      if (!hit) continue
      const out = join(mkdtempSync(join(tmpdir(), 'canal-loc-')), 'ad.jpg')
      const { file, crop } = await cropAd(page, hit, out, { pad: 0.05 })
      console.log(credit(page), '\n', file, crop, relativeTo(crop, hit))
      expect(statSync(file).size).toBeGreaterThan(10_000)
      return
    }
    throw new Error('phrase not found on any page')
  }
)
