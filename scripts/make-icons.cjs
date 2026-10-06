// Renders build/logo/*.svg to the app icons with Electron itself (no extra tools).
// Usage: npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const big = readFileSync(join(root, 'build/logo/logo.svg'), 'utf8')
const small = readFileSync(join(root, 'build/logo/logo-small.svg'), 'utf8')

let win = null

/** Draw an SVG once at 512 px in one reused offscreen window. */
async function render512(svg) {
  win ??= new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace(
    '<svg ',
    '<svg width="512" height="512" '
  )}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 200))
  return win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
}

const scale = (image, size) => image.resize({ width: size, height: size, quality: 'best' }).toPNG()

/** ICO with PNG-compressed entries (supported since Windows Vista). */
function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const bigImage = await render512(big)
  const smallImage = await render512(small)
  const png512 = scale(bigImage, 512)
  writeFileSync(join(root, 'resources/icon.png'), png512)
  writeFileSync(join(root, 'build/icon.png'), png512)
  const entries = [16, 20, 24, 32, 40, 48, 64, 128, 256].map((size) => ({
    size,
    png: scale(size <= 40 ? smallImage : bigImage, size)
  }))
  writeFileSync(join(root, 'build/icon.ico'), ico(entries))
  writeFileSync(join(root, 'resources/icon.ico'), ico(entries))
  mkdirSync(join(root, 'build/logo/preview'), { recursive: true })
  for (const e of entries) writeFileSync(join(root, `build/logo/preview/${e.size}.png`), e.png)
  console.log('icons written')
  app.quit()
})
