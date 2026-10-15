// Download Chronicling America OCR batches (loc.gov/collections/chronicling-america/datasets)
// slowly, to build a local index of ads that does not depend on the search API.
//
// Usage: node scripts/loc-ocr-batch.mjs urls.txt [outDir]
//   urls.txt: one dataset file URL per line (copied from the datasets page).
//
// Limits: at most 10 downloads every 10 minutes, the app's identified User-Agent, and the
// app's shared block file: a 429, 403 or challenge page stops everything for 65 minutes
// (the run exits; start it again later). Never works around a challenge.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join, resolve } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

const UA = 'CanalStudio/1.0 (contato: braga@gabrielbraga.app)'
const WINDOW_MS = 10 * 60_000
const PER_WINDOW = 10
const LOCKOUT_MS = 65 * 60_000
const root = resolve(import.meta.dirname, '..')
const blockFile = join(root, 'dados', 'cache', 'loc-block.json')

const [list, out = join(root, 'dados', 'loc-ocr')] = process.argv.slice(2)
if (!list) {
  console.error('Uso: node scripts/loc-ocr-batch.mjs urls.txt [pasta]')
  process.exit(2)
}

function blockedUntil() {
  if (!existsSync(blockFile)) return 0
  try {
    return Date.parse(JSON.parse(readFileSync(blockFile, 'utf8')).until) || 0
  } catch {
    return 0
  }
}

function block(reason) {
  const now = Date.now()
  mkdirSync(join(root, 'dados', 'cache'), { recursive: true })
  const b = {
    at: new Date(now).toISOString(),
    until: new Date(now + LOCKOUT_MS).toISOString(),
    reason
  }
  writeFileSync(blockFile, JSON.stringify(b, null, 2))
  console.error(`loc.gov bloqueou (${reason}) às ${b.at}; nada até ${b.until}`)
  process.exit(1)
}

const urls = readFileSync(list, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^https:\/\/([a-z]+\.)?loc\.gov\//.test(l))
mkdirSync(out, { recursive: true })
const done = []
for (const url of urls) {
  const file = join(out, basename(new URL(url).pathname))
  if (existsSync(file)) continue
  const until = blockedUntil()
  if (until > Date.now()) {
    console.error(`loc.gov bloqueado até ${new Date(until).toISOString()}; rode de novo depois.`)
    process.exit(1)
  }
  // Rolling window: the 11th download waits until the first of the last 10 is 10 min old.
  if (done.length >= PER_WINDOW) {
    const wait = done[done.length - PER_WINDOW] + WINDOW_MS - Date.now()
    if (wait > 0) {
      console.log(
        `Limite de ${PER_WINDOW} downloads em 10 min: esperando ${Math.ceil(wait / 1000)} s`
      )
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  done.push(Date.now())
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  const type = res.headers.get('content-type') ?? ''
  if (res.status === 429 || res.status === 403) block(`HTTP ${res.status}`)
  if (/html/i.test(type)) {
    const body = await res.text()
    if (/Just a moment|challenges\.cloudflare\.com|cf-chl|captcha/i.test(body))
      block('página de desafio')
    console.error(`Resposta HTML inesperada para ${url}; pulando`)
    continue
  }
  if (!res.ok || !res.body) {
    console.error(`HTTP ${res.status} em ${url}; pulando`)
    continue
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${file}.part`))
  const { renameSync } = await import('fs')
  renameSync(`${file}.part`, file)
  console.log(`Baixado: ${file}`)
}
console.log('Concluído. Extraia os lotes (tar -xjf) para montar o índice local de anúncios.')
