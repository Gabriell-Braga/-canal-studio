import { PUBLIC_DOMAIN_UNTIL } from '../../shared/formats/vintage-ads'
import { searchAdPages, type AdPage } from './chroniclingamerica'
import { WIKIMEDIA_USER_AGENT } from './wikimedia'

/**
 * Chronicling America ads mirrored on Wikimedia Commons. loc.gov answers every non-browser
 * client with a Cloudflare challenge, so these copies (uploaded with their LoC source) are
 * how the app reaches real, dated newspaper ads with full provenance.
 */

const CA_URL =
  /chroniclingamerica\.loc\.gov\/lccn\/(sn\d+)\/(\d{4}-\d{2}-\d{2})\/ed-(\d+)\/seq-(\d+)/

function strip(html: string | undefined): string {
  return (html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Newspaper name from the Commons text: "(Los Angeles Herald)" or "in the Los Angeles Herald". */
export function newspaperOf(text: string): string {
  // LoC citation style: "New-York tribune. (New York [N.Y.]), 13 June 1909."
  const cited = /^\s*"?([A-Z][^"().]{2,70}?)"?\.?\s*\([^)]*\),\s*\d/.exec(strip(text))?.[1]
  if (cited) return titleCase(cited.trim())
  const quoted = /"([^"]{4,80})"\s*\(/.exec(text)?.[1]
  if (quoted) return quoted
  const paren = /chroniclingamerica[^\s]*\s*\(([^)]{4,80})\)/.exec(text)?.[1]
  if (paren) return paren.replace(/^\{\{W\|/, '').trim()
  const inThe =
    /\bin (?:the )?((?:[A-Z][\w.'-]*\s?){1,6}(?:Herald|Tribune|Times|News|Journal|Gazette|Democrat|Republican|Post|Star|Sun|Daily|Register|Record|Press|Chronicle|Call|World|Miner|Oregonian|Citizen|Bee|Leader|Advocate))/.exec(
      text
    )?.[1]
  return inThe?.trim() ?? 'Newspaper'
}

function titleCase(s: string): string {
  return s.replace(/(^|[\s-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase())
}

/** City and state from a "(City, State)" group, when the Commons text has one. */
function placeOf(text: string): { city: string; state: string } {
  const m = /\(([A-Z][\w .'-]+?)(?:\s*\[[^\]]*\])?,\s*([A-Z][\w .'-]+)\)/.exec(strip(text))
  return m ? { city: m[1].trim(), state: m[2].trim() } : { city: '', state: '' }
}

export interface CommonsFile {
  pageid: number
  title: string
  url: string
  descriptionurl: string
  license: string
  credit: string
  description: string
}

/** An ad page record from a Commons file, or null when it has no dated LoC source ≤ 1930. */
export function parseCommonsAd(f: CommonsFile): AdPage | null {
  const text = `${f.credit} ${f.description}`
  const m = CA_URL.exec(text)
  if (!m) return null
  const [, lccn, date, ed, seq] = m
  if (Number(date.slice(0, 4)) > PUBLIC_DOMAIN_UNTIL) return null
  if (!/public domain|^pd|cc0|no restrictions/i.test(f.license)) return null
  const { city, state } = placeOf(text)
  return {
    id: `${lccn}/${date}/ed-${ed}/seq-${seq}`,
    newspaper: newspaperOf(text),
    city,
    state,
    date,
    page: Number(seq),
    locUrl: `https://chroniclingamerica.loc.gov/lccn/${lccn}/${date}/ed-${ed}/seq-${seq}/`,
    imageUrl: f.url,
    ocrText: `${f.title.replace(/^File:/, '').replace(/\.\w+$/, '')}. ${f.description}`,
    mirror: f.url,
    mirrorPage: f.descriptionurl
  }
}

/** Chronicling America ads on Commons matching the query (public domain, ≤ 1930). */
export async function searchCommonsAds(
  query: string,
  limit = 10,
  signal?: AbortSignal
): Promise<AdPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query.slice(0, 80)} insource:"chroniclingamerica.loc.gov" filetype:bitmap`,
    gsrlimit: String(Math.min(30, limit * 2)),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1600',
    iiextmetadatafilter: 'LicenseShortName|Credit|ImageDescription'
  })
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
    signal
  })
  if (!res.ok) throw new Error(`Wikimedia HTTP ${res.status}`)
  const data = (await res.json()) as {
    query?: {
      pages: Record<
        string,
        {
          pageid: number
          title: string
          index?: number
          imageinfo?: {
            url: string
            thumburl?: string
            descriptionurl: string
            extmetadata?: Record<string, { value: string } | undefined>
          }[]
        }
      >
    }
  }
  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => {
      const info = p.imageinfo?.[0]
      if (!info) return null
      return parseCommonsAd({
        pageid: p.pageid,
        title: p.title,
        url: info.thumburl ?? info.url,
        descriptionurl: info.descriptionurl,
        license: strip(info.extmetadata?.LicenseShortName?.value),
        credit: info.extmetadata?.Credit?.value ?? '',
        description: strip(info.extmetadata?.ImageDescription?.value)
      })
    })
    .filter((p): p is AdPage => !!p)
    .slice(0, limit)
}

/**
 * Newspaper ad pages for a query: the Library of Congress first, its Commons mirrors when
 * loc.gov refuses the request (or finds nothing).
 */
export async function findAdPages(
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<AdPage[]> {
  try {
    const pages = await searchAdPages(query, { from: 1880, to: PUBLIC_DOMAIN_UNTIL, limit }, signal)
    if (pages.length) return pages
  } catch (error) {
    if (signal?.aborted) throw error
  }
  return searchCommonsAds(query, limit, signal)
}
