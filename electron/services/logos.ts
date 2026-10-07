import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ScriptCompany } from '../../shared/types'
import { isValidFile } from './ffmpeg'
import { WIKIMEDIA_USER_AGENT } from './wikimedia'

const HEADERS = { 'User-Agent': WIKIMEDIA_USER_AGENT }

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`)
  return (await res.json()) as T
}

/** Wikidata item of an English Wikipedia article ("Apple Inc." → "Q312"). */
async function itemFromWikipedia(title: string, signal?: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'pageprops',
    ppprop: 'wikibase_item',
    redirects: '1',
    titles: title
  })
  const data = await getJson<{
    query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> }
  }>(`https://en.wikipedia.org/w/api.php?${params}`, signal)
  const page = Object.values(data.query?.pages ?? {})[0]
  return page?.pageprops?.wikibase_item ?? null
}

async function itemFromSearch(name: string, signal?: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    format: 'json',
    language: 'en',
    type: 'item',
    limit: '5',
    search: name
  })
  const data = await getJson<{ search?: { id: string; description?: string }[] }>(
    `https://www.wikidata.org/w/api.php?${params}`,
    signal
  )
  const hits = data.search ?? []
  const company = hits.find((h) =>
    /company|corporation|manufacturer|brand|business|conglomerate|retailer|enterprise|firm/i.test(
      h.description ?? ''
    )
  )
  return (company ?? hits[0])?.id ?? null
}

/** Commons file name of the item's logo (P154). */
async function logoFile(item: string, signal?: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'wbgetclaims',
    format: 'json',
    entity: item,
    property: 'P154'
  })
  const data = await getJson<{
    claims?: { P154?: { rank?: string; mainsnak?: { datavalue?: { value?: string } } }[] }
  }>(`https://www.wikidata.org/w/api.php?${params}`, signal)
  const claims = data.claims?.P154 ?? []
  const best = claims.find((c) => c.rank === 'preferred') ?? claims[0]
  return best?.mainsnak?.datavalue?.value ?? null
}

/** File name for a company's logo inside the project. */
export function logoPath(projectDir: string, index: number): string {
  return join(projectDir, 'logos', `logo_${index}.png`)
}

/**
 * Download each company's real logo from Wikidata/Commons as a 600 px PNG (Commons renders
 * SVG logos to PNG). Returns the path per company, or null when none was found; the badge
 * then shows the company name instead.
 */
export async function fetchLogos(
  companies: ScriptCompany[],
  projectDir: string,
  signal?: AbortSignal,
  onWarn?: (message: string) => void
): Promise<(string | null)[]> {
  mkdirSync(join(projectDir, 'logos'), { recursive: true })
  const out: (string | null)[] = []
  for (const [i, company] of companies.entries()) {
    const file = logoPath(projectDir, i)
    if (isValidFile(file, 200)) {
      out.push(file)
      continue
    }
    try {
      const item =
        (company.wikipedia_title
          ? await itemFromWikipedia(company.wikipedia_title, signal)
          : null) ?? (await itemFromSearch(company.name, signal))
      const name = item ? await logoFile(item, signal) : null
      if (!name) {
        onWarn?.(`Logo de ${company.name} não encontrado no Wikidata`)
        out.push(null)
        continue
      }
      const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=600`
      const res = await fetch(url, { headers: HEADERS, signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      out.push(file)
    } catch (error) {
      onWarn?.(`Logo de ${company.name}: ${(error as Error).message}`)
      out.push(null)
    }
  }
  return out
}
