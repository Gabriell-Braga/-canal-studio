import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it } from 'vitest'
import { scanAd } from '../electron/services/adscan'
import { credit } from '../electron/services/chroniclingamerica'
import { findAdPages } from '../electron/services/commonsads'

it('finds real Chronicling America ads and saves one as a scan', async () => {
  const pages = await findAdPages('tonic', 5)
  console.log(pages.map((p) => `${p.newspaper} ${p.date} ${p.locUrl}`).join('\n'))
  expect(pages.length).toBeGreaterThan(0)
  const out = join(mkdtempSync(join(tmpdir(), 'canal-ads-')), 'ad.jpg')
  const scan = await scanAd(pages[0], 'tonic', out)
  console.log(out, credit(scan.page))
  expect(scan.page.date <= '1930-12-31').toBe(true)
})
