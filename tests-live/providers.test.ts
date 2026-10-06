import { mkdtempSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it } from 'vitest'
import { searchArchive, searchMet, searchNasa } from '../electron/services/archives'
import { download } from '../electron/services/pexels'

const dir = mkdtempSync(join(tmpdir(), 'canal-prov-'))
const cases: [
  string,
  (q: string) => Promise<{ source: string; kind: string; url: string }[]>,
  string
][] = [
  ['nasa', (q) => searchNasa(q, new Set()), 'apollo launch'],
  ['met', (q) => searchMet(q, new Set()), 'shipwreck'],
  ['archive', (q) => searchArchive(q, new Set()), 'ocean']
]

for (const [name, search, query] of cases) {
  it(`${name} finds and downloads media`, { timeout: 180_000 }, async () => {
    const found = await search(query)
    console.log(
      name,
      found.length,
      found.slice(0, 2).map((c) => `${c.kind} ${c.source}`)
    )
    expect(found.length).toBeGreaterThan(0)
    const first = found[0]
    const out = join(dir, `${name}${first.kind === 'stock_video' ? '.mp4' : '.jpg'}`)
    await download(first.url, out)
    console.log(name, 'downloaded', (statSync(out).size / 1e6).toFixed(1), 'MB', out)
    expect(statSync(out).size).toBeGreaterThan(10_000)
  })
}
