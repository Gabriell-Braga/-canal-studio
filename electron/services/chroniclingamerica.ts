import { createHash } from 'crypto'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { runTool } from './ffmpeg'
import type { StockCandidate } from './pexels'

/**
 * Library of Congress "Chronicling America" newspaper pages (public domain, up to 1963; we stop
 * at 1930) through the loc.gov JSON API. No key. Since 2025 the old chroniclingamerica.loc.gov
 * API is gone: search is https://www.loc.gov/collections/chronicling-america/?fo=json, images
 * come from the IIIF server and OCR (ALTO XML) from tile.loc.gov storage-services.
 */
const USER_AGENT = 'CanalStudio/1.0 (local desktop app; vintage newspaper research)'
const CUTOFF_YEAR = 1930

export interface AdPage {
  id: string // "sn83045462/1907-05-27/ed-1/seq-2"
  newspaper: string
  city: string
  state: string
  date: string // YYYY-MM-DD
  page: number | string
  locUrl: string
  imageUrl: string
  ocrText?: string
  altoUrl?: string
  /** The ad already cropped, mirrored on Wikimedia Commons (used when loc.gov is unreachable) */
  mirror?: string
  /** Commons file page of the mirror, for the credit line */
  mirrorPage?: string
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export interface OcrWord extends Box {
  text: string
}

// LoC rate-limits hard (429, then a temporary block): one request at a time, spaced out.
let chain: Promise<unknown> = Promise.resolve()
let last = 0
const GAP_MS = 1500

async function locFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const run = async (): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + GAP_MS - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      last = Date.now()
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal })
      if (res.status === 429 && attempt < 3) {
        const retry = Number(res.headers.get('retry-after')) || 10 * 2 ** attempt
        await new Promise((r) => setTimeout(r, retry * 1000))
        continue
      }
      if (res.status === 403 && (res.headers.get('content-type') ?? '').includes('html'))
        throw new Error('Library of Congress bloqueou o acesso (403/Cloudflare). Tente mais tarde.')
      if (!res.ok) throw new Error(`Library of Congress HTTP ${res.status}`)
      return res
    }
  }
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return p
}

const first = (v: unknown): string =>
  (Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '').trim()
const titleCase = (s: string): string => s.replace(/\b[a-z]/g, (c) => c.toUpperCase())

/** Pages dated within [from, to] and never after 1930. */
export function filterByDate<T extends { date: string }>(
  pages: T[],
  from = 0,
  to = CUTOFF_YEAR
): T[] {
  const max = Math.min(to, CUTOFF_YEAR)
  return pages.filter((p) => {
    const year = Number(p.date.slice(0, 4))
    return Number.isFinite(year) && year >= from && year <= max
  })
}

/** "https://tile.loc.gov/image-services/iiif/service:ndnp:dcu:batch:data:sn..:reel:1907052701:0200/full/pct:6.25/0/default.jpg" */
function iiifBase(imageUrl: string): string | undefined {
  return imageUrl.match(
    /^(https:\/\/tile\.loc\.gov\/image-services\/iiif\/service:ndnp:[^/]+)/
  )?.[1]
}

/** Map one loc.gov search result to an AdPage; undefined when it is not a newspaper page. */
export function parseResult(item: Record<string, unknown>): AdPage | undefined {
  const link = first(item.id) || first(item.url)
  const m = link.match(/resource\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/(ed-\d+)\/?\?(?:.*&)?sp=(\d+)/)
  const base = iiifBase(first(item.image_url))
  if (!m || !base) return undefined
  const [, lccn, date, ed, seq] = m
  const partOf = first(item.partof_title) || first(item.title)
  return {
    id: `${lccn}/${date}/${ed}/seq-${seq}`,
    newspaper: titleCase(partOf.replace(/\s*\(.*$/, '').replace(/\s+\d{4}-\d{4}$/, '')),
    city: titleCase(first(item.location_city)),
    state: titleCase(first(item.location_state)),
    date: first(item.date).slice(0, 10) || date,
    page: Number(seq),
    locUrl: `https://www.loc.gov/resource/${lccn}/${date}/${ed}/?sp=${seq}`,
    // pct:50 keeps small print legible (full size is ~6000x8000) at a sane download size
    imageUrl: `${base}/full/pct:50/0/default.jpg`,
    ocrText: first(item.description) || undefined,
    altoUrl: `https://tile.loc.gov/storage-services/${base
      .replace(/^.*\/iiif\//, '')
      .replace(/:/g, '/')}.xml`
  }
}

export async function searchAdPages(
  query: string,
  opts: { from?: number; to?: number; limit?: number },
  signal?: AbortSignal
): Promise<AdPage[]> {
  const from = opts.from ?? 1836
  const to = Math.min(opts.to ?? CUTOFF_YEAR, CUTOFF_YEAR)
  const params = new URLSearchParams({
    q: query.slice(0, 200),
    dates: `${from}/${to}`,
    fo: 'json',
    c: String(Math.min(opts.limit ?? 20, 100)),
    at: 'results'
  })
  const res = await locFetch(
    `https://www.loc.gov/collections/chronicling-america/?${params}`,
    signal
  )
  const data = (await res.json()) as { results?: Record<string, unknown>[] }
  const pages = (data.results ?? []).map(parseResult).filter((p): p is AdPage => !!p)
  return filterByDate(pages, from, to).slice(0, opts.limit ?? 20)
}

const attr = (tag: string, name: string): string | undefined =>
  tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
const unescape = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** ALTO XML to words with page-relative (0-1) boxes. */
export function parseAlto(xml: string): {
  text: string
  words: OcrWord[]
  width: number
  height: number
} {
  const pageTag = xml.match(/<(?:\w+:)?Page\b[^>]*>/)?.[0] ?? ''
  const width = Number(attr(pageTag, 'WIDTH'))
  const height = Number(attr(pageTag, 'HEIGHT'))
  if (!width || !height) throw new Error('ALTO sem dimensões da página')
  const words: OcrWord[] = []
  for (const [tag] of xml.matchAll(/<(?:\w+:)?String\b[^>]*>/g)) {
    const text = unescape(attr(tag, 'CONTENT') ?? '')
    if (!text) continue
    words.push({
      text,
      x: Number(attr(tag, 'HPOS')) / width,
      y: Number(attr(tag, 'VPOS')) / height,
      w: Number(attr(tag, 'WIDTH')) / width,
      h: Number(attr(tag, 'HEIGHT')) / height
    })
  }
  return { text: words.map((w) => w.text).join(' '), words, width, height }
}

export async function fetchOcrWords(
  page: AdPage,
  signal?: AbortSignal
): Promise<ReturnType<typeof parseAlto>> {
  if (!page.altoUrl) throw new Error(`Página sem ALTO: ${page.id}`)
  const res = await locFetch(page.altoUrl, signal)
  return parseAlto(await res.text())
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length)
}

export function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y
  }
}

/**
 * Best fuzzy match of a phrase in reading order: case, punctuation and a few wrong letters are
 * tolerated. ponytail: one OCR word per phrase word; words split or merged by OCR are missed.
 */
export function locatePhrase(words: OcrWord[], phrase: string): (Box & { words: Box[] }) | null {
  const target = phrase.split(/\s+/).map(norm).filter(Boolean)
  const tokens = words.map((w) => norm(w.text))
  if (!target.length) return null
  let best: { score: number; at: number } | null = null
  for (let at = 0; at + target.length <= words.length; at++) {
    let score = 0
    let ok = true
    for (let k = 0; k < target.length && ok; k++) {
      const s = similarity(tokens[at + k], target[k])
      ok = s >= (target[k].length <= 3 ? 0.66 : 0.7)
      score += s
    }
    if (ok && (!best || score > best.score)) best = { score, at }
  }
  if (!best) return null
  const hit = words
    .slice(best.at, best.at + target.length)
    .map(({ x, y, w, h }) => ({ x, y, w, h }))
  return { ...union(hit), words: hit }
}

/** A page-relative box expressed relative to a crop of the same page (both 0-1). */
export function relativeTo(crop: Box, box: Box): Box {
  return {
    x: (box.x - crop.x) / crop.w,
    y: (box.y - crop.y) / crop.h,
    w: box.w / crop.w,
    h: box.h / crop.h
  }
}

const clamp = (v: number): number => Math.max(0, Math.min(1, v))

/** Crop the ad region (0-1 box) out of the page scan, padded, upscaled to at least 1600 px wide. */
export async function cropAd(
  page: AdPage,
  box: Box,
  outFile: string,
  opts: { pad?: number } = {},
  signal?: AbortSignal
): Promise<{ file: string; crop: Box }> {
  const cacheDir = join(tmpdir(), 'canal-loc-cache')
  const cached = join(cacheDir, `${createHash('sha1').update(page.imageUrl).digest('hex')}.jpg`)
  if (!existsSync(cached)) {
    // Through the shared queue so page downloads also respect the LoC rate limit.
    const res = await locFetch(page.imageUrl, signal)
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(`${cached}.part`, Buffer.from(await res.arrayBuffer()))
    renameSync(`${cached}.part`, cached)
  }
  const pad = opts.pad ?? 0.03
  const x = clamp(box.x - pad)
  const y = clamp(box.y - pad)
  const crop = { x, y, w: clamp(box.x + box.w + pad) - x, h: clamp(box.y + box.h + pad) - y }
  mkdirSync(dirname(outFile), { recursive: true })
  await runTool(
    'ffmpeg',
    [
      '-y',
      '-i',
      cached,
      '-vf',
      `crop=iw*${crop.w}:ih*${crop.h}:iw*${crop.x}:ih*${crop.y},scale='max(iw,1600)':-2:flags=lanczos`,
      '-q:v',
      '2',
      outFile
    ],
    signal
  )
  return { file: outFile, crop }
}

export function credit(page: AdPage): string {
  const date = new Date(`${page.date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
  const place = [page.city, page.state].filter(Boolean).join(', ')
  const via = page.mirrorPage ? ` (via Wikimedia Commons: ${page.mirrorPage})` : ''
  return `${page.newspaper}${place ? ` (${place})` : ''}, ${date}, page ${page.page}. Library of Congress, Chronicling America: ${page.locUrl}${via}`
}

export function toCandidate(page: AdPage, file?: string): StockCandidate {
  return {
    source: `loc:${page.id}`,
    kind: 'stock_photo',
    url: file ?? page.imageUrl,
    label: `${page.newspaper}, ${page.date}. ${(page.ocrText ?? '').slice(0, 160)}`.trim(),
    credit: credit(page),
    real: true
  }
}
