/**
 * Smithsonian Open Access: patent-medicine bottles, labels and trade cards. The search API
 * (api.data.gov key) returns no image URLs; those live only in the public S3 dump, one
 * line-delimited JSON shard per unit and hash prefix, cached on disk. CC0 images only, dated
 * up to PUBLIC_DOMAIN_UNTIL.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { StockCandidate } from './pexels'
import { PUBLIC_DOMAIN_UNTIL } from '../../shared/formats/vintage-ads'

const API = 'https://api.si.edu/openaccess/api/v1.0/search'
const DUMP = 'https://smithsonian-open-access.s3-us-west-2.amazonaws.com/metadata/edan'
/** Shards are ~10 MB: at most this many new downloads per search. */
const NEW_SHARDS = 4

export interface SiRow {
  id: string
  hash: string
  unitCode: string
  title: string
}

export interface SiRecord {
  id: string
  title: string
  content: {
    descriptiveNonRepeating?: {
      data_source?: string
      online_media?: { media?: { type?: string; content?: string; usage?: { access?: string } }[] }
    }
    indexedStructured?: { date?: string[] }
    freetext?: { date?: { content?: string }[]; notes?: { content?: string }[] }
  }
}

/** Dump file that holds a search row's record. */
export function shardPath(row: Pick<SiRow, 'hash' | 'unitCode'>): string {
  return `${row.unitCode.toLowerCase()}/${row.hash.slice(0, 2)}.txt`
}

/**
 * Latest year the record is dated to, or null: "1920s" counts as 1929, "ca 1923" as 1923.
 * "after 1906" is only a lower bound and dates nothing on its own.
 */
export function siYear(r: SiRecord): number | null {
  const years: number[] = []
  for (const d of r.content.indexedStructured?.date ?? []) {
    const m = /^(\d{3})0s$/.exec(d.trim())
    if (m) years.push(Number(m[1]) * 10 + 9)
    else if (/^\d{4}$/.test(d.trim())) years.push(Number(d))
  }
  for (const d of r.content.freetext?.date ?? []) {
    const text = d.content ?? ''
    if (/\b(after|post)\b/i.test(text)) continue
    for (const m of text.matchAll(/\b(1[5-9]\d\d|20\d\d)(s)?\b/g))
      years.push(Number(m[1]) + (m[2] ? 9 : 0))
  }
  return years.length ? Math.max(...years) : null
}

/** CC0 image URLs of a record (1600 px), when it is dated up to PUBLIC_DOMAIN_UNTIL. */
export function siCandidates(r: SiRecord): StockCandidate[] {
  const year = siYear(r)
  if (year === null || year > PUBLIC_DOMAIN_UNTIL) return []
  const dn = r.content.descriptiveNonRepeating
  const media = (dn?.online_media?.media ?? []).filter(
    (m) => m.usage?.access === 'CC0' && m.type === 'Images' && m.content
  )
  return media.slice(0, 2).map((m, i) => ({
    source: `smithsonian:${r.id}:${i}`,
    kind: 'stock_photo',
    url: `${m.content}&max=1600`,
    year,
    label: [r.title, ...(r.content.freetext?.notes ?? []).map((n) => n.content ?? '')]
      .join('. ')
      .slice(0, 300),
    credit: `"${r.title}", Smithsonian ${dn?.data_source ?? 'Institution'}, CC0`
  }))
}

/** The record of `id` in a shard's text, or null. */
export function findInShard(text: string, id: string): SiRecord | null {
  const at = text.indexOf(`"id":"${id}"`)
  if (at < 0) return null
  const start = text.lastIndexOf('\n', at) + 1
  const end = text.indexOf('\n', at)
  return JSON.parse(text.slice(start, end < 0 ? undefined : end)) as SiRecord
}

export async function searchSmithsonian(
  query: string,
  key: string,
  cacheDir: string,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  if (!key) return []
  // Only records whose media are CC0: about 1% of the index, and the only ones in the dump.
  const q = encodeURIComponent(`${query.slice(0, 100)} AND media_usage:CC0`)
  const res = await fetch(`${API}?q=${q}&rows=30&api_key=${encodeURIComponent(key)}`, { signal })
  if (!res.ok) throw new Error(`Smithsonian HTTP ${res.status}`)
  const rows = ((await res.json()) as { response?: { rows?: SiRow[] } }).response?.rows ?? []
  const dir = join(cacheDir, 'si')
  mkdirSync(dir, { recursive: true })
  const shards = new Map<string, string>()
  let fetched = 0
  const out: StockCandidate[] = []
  for (const row of rows) {
    if (!row.hash || !row.unitCode || exclude.has(`smithsonian:${row.id}:0`)) continue
    const rel = shardPath(row)
    let text = shards.get(rel)
    if (text === undefined) {
      const file = join(dir, rel.replace('/', '_'))
      if (existsSync(file)) text = readFileSync(file, 'utf8')
      else {
        if (fetched >= NEW_SHARDS) continue
        fetched++
        const r = await fetch(`${DUMP}/${rel}`, { signal })
        if (!r.ok) continue
        text = await r.text()
        writeFileSync(file, text)
      }
      shards.set(rel, text)
    }
    const record = findInShard(text, row.id)
    if (record) out.push(...siCandidates(record))
  }
  return out
}
