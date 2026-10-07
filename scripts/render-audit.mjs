// Renders the YouTube API audit attachments in docs/auditoria to PNG and PDF.
// Usage: node scripts/render-audit.mjs  (uses the installed Microsoft Edge, headless)
import { chromium } from 'playwright'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

const dir = resolve(import.meta.dirname, '..', 'docs', 'auditoria')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })

for (const name of ['arquitetura', 'fluxo']) {
  await page.goto(pathToFileURL(join(dir, `${name}.html`)).href)
  await page.locator('#canvas').screenshot({ path: join(dir, `${name}.png`) })
  console.log(`${name}.png`)
}

await page.goto(pathToFileURL(join(dir, 'apoio.html')).href)
await page.pdf({ path: join(dir, 'apoio.pdf'), format: 'A4', preferCSSPageSize: true })
console.log('apoio.pdf')

await browser.close()
