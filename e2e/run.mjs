// End-to-end checks against the built app (npm run build first).
// The window opens without focus (CANAL_E2E=1) so it does not interrupt other work.
// Usage: node e2e/run.mjs <scenario> [--keep-data]
import { _electron as electron } from 'playwright'
import { createWriteStream, mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { scenarios } from './scenarios.mjs'

const name = process.argv[2] ?? 'phase1'
const scenario = scenarios[name]
if (!scenario) {
  console.error(`Unknown scenario "${name}". Options: ${Object.keys(scenarios).join(', ')}`)
  process.exit(2)
}

const root = resolve(import.meta.dirname, '..')
const dataDir = process.env.CANAL_DATA_DIR ?? mkdtempSync(join(tmpdir(), `canal-e2e-${name}-`))
const shotsDir = process.env.E2E_SHOTS ?? join(dataDir, 'screenshots')
mkdirSync(shotsDir, { recursive: true })

async function launch() {
  // E2E_EXE runs the packaged app (dist/win-unpacked/canal-studio.exe) instead of out/.
  const app = await electron.launch({
    ...(process.env.E2E_EXE
      ? { executablePath: process.env.E2E_EXE, args: [] }
      : { args: [join(root, 'out', 'main', 'index.js')] }),
    cwd: root,
    env: { ...process.env, CANAL_E2E: '1', CANAL_DATA_DIR: dataDir, CANAL_TICK_MS: '1000' }
  })
  const out = createWriteStream(join(dataDir, 'main-process.log'), { flags: 'a' })
  app.process().stdout?.pipe(out)
  app.process().stderr?.pipe(out)
  app.process().on('exit', (code, signal) =>
    out.write(`
[exit code=${code} signal=${signal}]
`)
  )
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // The app opens on the channel picker; scenarios work on the first channel unless told otherwise.
  if (process.env.E2E_STAY_ON_PICKER !== '1') {
    await page.getByTestId('channel-card').first().click()
    await page.getByTestId('channel-switcher').waitFor()
  }
  return { app, page }
}

let step = 0
const ctx = {
  dataDir,
  launch,
  log: (msg) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`),
  shot: async (page, label) => {
    const file = join(shotsDir, `${String(++step).padStart(2, '0')}-${label}.png`)
    await page.waitForTimeout(450) /* let enter animations finish */
    await page.screenshot({ path: file })
    console.log(`  screenshot: ${file}`)
  },
  /** Call the preload API from the page. */
  api: (page, path, ...args) =>
    page.evaluate(([p, a]) => p.split('.').reduce((o, k) => o[k], window.api)(...a), [path, args]),
  waitUntil: async (fn, { timeoutMs = 600_000, everyMs = 2000, label = 'condition' } = {}) => {
    const start = Date.now()
    for (;;) {
      const value = await fn()
      if (value) return value
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
      await new Promise((r) => setTimeout(r, everyMs))
    }
  }
}

console.log(`Scenario ${name} · data ${dataDir}`)
try {
  await scenario(ctx)
  console.log('E2E PASSED')
  process.exit(0)
} catch (error) {
  console.error('E2E FAILED:', error)
  process.exit(1)
}
