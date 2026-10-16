/**
 * Wellcome Collection (no key): patent-medicine ads, trade cards, pamphlets and broadsheets.
 * Only public domain (PDM), CC0 and CC BY images dated up to PUBLIC_DOMAIN_UNTIL.
 */
import type { StockCandidate } from './pexels'
import { PUBLIC_DOMAIN_UNTIL } from '../../shared/formats/vintage-ads'
import { WIKIMEDIA_USER_AGENT as USER_AGENT } from './wikimedia'

const API = 'https://api.wellcomecollection.org/catalogue/v2'

const LICENSES: Record<string, string> = {
  pdm: 'Public Domain Mark',
  'cc-0': 'CC0',
  'cc-by': 'CC BY 4.0'
}

export interface WellcomeImage {
  id: string
  locations: { url: string; license?: { id: string } }[]
  source: { id: string; title?: string }
}

export interface WellcomeWork {
  production?: { dates?: { label?: string }[] }[]
}

/** Latest year (1500–2099) in any of the texts: "1880-1890" is 1890. */
function latest(texts: string[]): number | null {
  const years = texts.flatMap((t) =>
    [...t.matchAll(/\b(1[5-9]\d\d|20\d\d)\b/g)].map((m) => Number(m[1]))
  )
  return years.length ? Math.max(...years) : null
}

/** License label of a free image (PDM, CC0, CC BY), or null for anything else. */
export function wellcomeLicense(img: WellcomeImage): string | null {
  return LICENSES[img.locations[0]?.license?.id ?? ''] ?? null
}

/**
 * The image as a candidate when its license is free and its work is dated up to
 * PUBLIC_DOMAIN_UNTIL (production dates, else a year in the title); null otherwise.
 */
export function wellcomeCandidate(
  img: WellcomeImage,
  work: WellcomeWork | null
): StockCandidate | null {
  const license = wellcomeLicense(img)
  if (!license) return null
  const title = img.source.title ?? ''
  const dates = (work?.production ?? []).flatMap((p) => (p.dates ?? []).map((d) => d.label ?? ''))
  const year = latest(dates) ?? latest([title])
  if (year === null || year > PUBLIC_DOMAIN_UNTIL) return null
  const base = img.locations[0].url.replace(/\/info\.json$/, '')
  const page = `https://wellcomecollection.org/works/${img.source.id}`
  return {
    source: `wellcome:${img.id}`,
    kind: 'stock_photo',
    url: `${base}/full/1600,/0/default.jpg`,
    year,
    label: title,
    credit: `"${title}", Wellcome Collection, ${license} (${page})`
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal })
  if (!res.ok) throw new Error(`Wellcome HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function searchWellcome(
  query: string,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const { results = [] } = await getJson<{ results?: WellcomeImage[] }>(
    `${API}/images?query=${encodeURIComponent(query.slice(0, 100))}&pageSize=30`,
    signal
  )
  // Images carry no date: only the free ones get a work lookup.
  const free = results
    .filter((r) => wellcomeLicense(r) && !exclude.has(`wellcome:${r.id}`))
    .slice(0, 12)
  const out = await Promise.all(
    free.map(async (img) => {
      const work = await getJson<WellcomeWork>(
        `${API}/works/${img.source.id}?include=production`,
        signal
      ).catch(() => null)
      return wellcomeCandidate(img, work)
    })
  )
  return out.filter((c): c is StockCandidate => !!c)
}
