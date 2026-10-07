import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Settings, StockProvider } from '../../shared/types'
import { searchStock as searchPexels, type StockCandidate } from './pexels'
import { searchPixabay } from './pixabay'
import { searchWikimedia, type WikimediaOptions } from './wikimedia'
import { searchArchive, searchMet, searchNasa } from './archives'

let cacheDir = ''

export function configureStockCache(dir: string): void {
  cacheDir = dir
  mkdirSync(dir, { recursive: true })
}

const DAY = 24 * 3600_000

/**
 * Search results are kept for 24 h: Pixabay requires it, and it spares the rate limits when
 * "Outro resultado" is clicked several times. Exclusions are applied after the cache.
 */
async function cached(
  key: string,
  load: () => Promise<StockCandidate[]>
): Promise<StockCandidate[]> {
  const file = cacheDir
    ? join(cacheDir, `${createHash('sha1').update(key).digest('hex')}.json`)
    : ''
  if (file && existsSync(file) && Date.now() - statSync(file).mtimeMs < DAY) {
    return JSON.parse(readFileSync(file, 'utf8')) as StockCandidate[]
  }
  const result = await load()
  if (file) writeFileSync(file, JSON.stringify(result))
  return result
}

function wikimediaOptions(s: Settings, relaxed = false): WikimediaOptions {
  return {
    allowCcBy: s.wikimediaAllowCcBy,
    allowCcBySa: s.wikimediaAllowCcBySa,
    relaxed
  }
}

/**
 * Real photos of a named person, product or event (Steve Jobs on stage in 2007, not a concert).
 * Wikimedia Commons only: the stock banks have no editorial photos. Runs even when the channel
 * turned Wikimedia off, since nothing else can show the real thing.
 */
export async function searchReal(
  subject: string,
  s: Settings,
  exclude: Set<string>,
  onWarn?: (message: string) => void,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  if (!subject.trim()) return []
  try {
    const all = await cached(
      `real|${s.wikimediaAllowCcBy}|${s.wikimediaAllowCcBySa}|${subject}`,
      () => searchWikimedia(subject, wikimediaOptions(s, true), new Set(), signal)
    )
    return all.filter((c) => !exclude.has(c.source)).map((c) => ({ ...c, real: true }))
  } catch (error) {
    onWarn?.(`Wikimedia (foto real): ${(error as Error).message}`)
    return []
  }
}

const KEYLESS = new Set<StockProvider>(['wikimedia', 'nasa', 'met', 'archive'])

/** Providers the channel wants, in its order, that can run with the current keys. */
export function usableProviders(s: Settings): StockProvider[] {
  return s.stockProviders.filter(
    (p) =>
      (p === 'pixabay' && !!s.pixabayApiKey) ||
      (p === 'pexels' && !!s.pexelsApiKey) ||
      KEYLESS.has(p)
  )
}

/**
 * Candidates for one scene from the first provider (in the channel's order) that has any.
 * A failing provider is skipped so one outage does not turn every scene into AI images.
 */
export async function searchAll(
  query: string,
  minDuration: number,
  s: Settings,
  exclude: Set<string>,
  onWarn?: (message: string) => void,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  for (const provider of usableProviders(s)) {
    try {
      let all: StockCandidate[]
      if (provider === 'pixabay') {
        all = await cached(`pixabay|${query}`, () =>
          searchPixabay(query, minDuration, s.pixabayApiKey, new Set(), signal)
        )
      } else if (provider === 'pexels') {
        all = await cached(`pexels|${query}`, () =>
          searchPexels(query, minDuration, s.pexelsApiKey, new Set(), signal)
        )
      } else if (provider === 'wikimedia') {
        all = await cached(
          `wikimedia|${s.wikimediaAllowCcBy}|${s.wikimediaAllowCcBySa}|${query}`,
          () => searchWikimedia(query, wikimediaOptions(s), new Set(), signal)
        )
      } else {
        const search = { nasa: searchNasa, met: searchMet, archive: searchArchive }[provider]
        all = await cached(`${provider}|${query}`, () => search(query, new Set(), signal))
      }
      // Clips long enough for the scene first; the cache keeps the original order otherwise.
      const fresh = all
        .filter((c) => !exclude.has(c.source))
        .sort(
          (a, b) =>
            Number((b.duration ?? 0) >= minDuration) - Number((a.duration ?? 0) >= minDuration)
        )
      if (fresh.length) return fresh
    } catch (error) {
      onWarn?.(`${provider}: ${(error as Error).message}`)
    }
  }
  return []
}

/**
 * Up to `perProvider` fresh candidates from each enabled provider, in the channel's order,
 * so the relevance pick can compare sources (a modern stock clip vs an archive photo).
 */
export async function gatherCandidates(
  query: string,
  minDuration: number,
  s: Settings,
  exclude: Set<string>,
  perProvider = 4,
  onWarn?: (message: string) => void,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const out: StockCandidate[] = []
  for (const provider of usableProviders(s)) {
    const one = { ...s, stockProviders: [provider] }
    const found = await searchAll(query, minDuration, one, exclude, onWarn, signal)
    out.push(...found.slice(0, perProvider))
  }
  return out
}

export const PROVIDER_LABELS: Record<StockProvider, string> = {
  pixabay: 'Pixabay',
  pexels: 'Pexels',
  wikimedia: 'Wikimedia Commons',
  nasa: 'NASA',
  met: 'The Met',
  archive: 'Internet Archive (Prelinger)'
}
