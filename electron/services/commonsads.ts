import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fetchImage, localOcr, OCR_MIN_CONFIDENCE } from './adscan'
import { PUBLIC_DOMAIN_UNTIL } from '../../shared/formats/vintage-ads'
import { searchAdPages, type AdPage } from './chroniclingamerica'
import { WIKIMEDIA_USER_AGENT, yearOf } from './wikimedia'

/** Why a search result was not used, for the log. */
export type Reject = (title: string, reason: string) => void
const ignore: Reject = () => undefined

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
  /** Machine-readable license id on the file page (e.g. 'pd') and its categories */
  licenseCode?: string
  copyrighted?: string
  categories?: string
  credit: string
  description: string
  /** DateTimeOriginal of the file page */
  date?: string
  width?: number
  height?: number
}

/** An ad page record from a Commons file, or null when it has no dated LoC source ≤ 1930. */
export function parseCommonsAd(f: CommonsFile, reject: Reject = ignore): AdPage | null {
  const text = `${f.credit} ${f.description}`
  const m = CA_URL.exec(text)
  if (!m) return (reject(f.title, 'sem fonte da Chronicling America'), null)
  const [, lccn, date, ed, seq] = m
  if (Number(date.slice(0, 4)) > PUBLIC_DOMAIN_UNTIL)
    return (reject(f.title, `de ${date.slice(0, 4)}, depois de ${PUBLIC_DOMAIN_UNTIL}`), null)
  const license = confirmedPublicDomain(f)
  if (!license) return (reject(f.title, 'domínio público não confirmado'), null)
  const { city, state } = placeOf(text)
  return {
    id: `${lccn}/${date}/ed-${ed}/seq-${seq}`,
    newspaper: strip(newspaperOf(text)),
    city,
    state,
    date,
    page: Number(seq),
    locUrl: `https://chroniclingamerica.loc.gov/lccn/${lccn}/${date}/ed-${ed}/seq-${seq}/`,
    imageUrl: f.url,
    ocrText: `${f.title.replace(/^File:/, '').replace(/\.\w+$/, '')}. ${f.description}`,
    license,
    mirror: f.url,
    mirrorPage: f.descriptionurl,
    pixels: (f.width ?? 0) * (f.height ?? 0) || undefined
  }
}

/**
 * Any Commons file as an ad (trade cards, magazine pages, posters): public domain confirmed
 * on the file page and dated ≤ 1930, or refused.
 */
export function parseCommonsFile(f: CommonsFile, reject: Reject = ignore): AdPage | null {
  const year = yearOf(f.date ?? '') ?? yearOf(f.description)
  if (!year) return (reject(f.title, 'sem data'), null)
  if (year > PUBLIC_DOMAIN_UNTIL)
    return (reject(f.title, `de ${year}, depois de ${PUBLIC_DOMAIN_UNTIL}`), null)
  const license = confirmedPublicDomain(f)
  if (!license) return (reject(f.title, 'domínio público não confirmado'), null)
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(f.date ?? '')?.[1]
  const name = f.title.replace(/^File:/, '').replace(/\.\w+$/, '')
  return {
    id: `commons:${f.pageid}`,
    newspaper: (f.description.split(/(?<=\.)\s/)[0] || name).slice(0, 80),
    city: '',
    state: '',
    date: iso && Number(iso.slice(0, 4)) === year ? iso : String(year),
    page: '',
    locUrl: f.descriptionurl,
    imageUrl: f.url,
    ocrText: `${name}. ${f.description}`,
    license,
    mirror: f.url,
    mirrorPage: f.descriptionurl,
    origin: 'commons',
    pixels: (f.width ?? 0) * (f.height ?? 0) || undefined
  }
}

/** Commons files (namespace 6) matching a CirrusSearch query, with their license metadata. */
export async function commonsFiles(
  search: string,
  limit: number,
  signal?: AbortSignal
): Promise<CommonsFile[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: search,
    gsrlimit: String(Math.min(30, limit)),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1600',
    iiextmetadatafilter:
      'LicenseShortName|License|Copyrighted|Categories|Credit|ImageDescription|DateTimeOriginal'
  })
  return queryFiles(params, signal)
}

/** One Commons file by its title ("File:…"). */
export async function commonsFile(
  title: string,
  signal?: AbortSignal
): Promise<CommonsFile | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1600',
    iiextmetadatafilter:
      'LicenseShortName|License|Copyrighted|Categories|Credit|ImageDescription|DateTimeOriginal'
  })
  return (await queryFiles(params, signal))[0] ?? null
}

async function queryFiles(params: URLSearchParams, signal?: AbortSignal): Promise<CommonsFile[]> {
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
            width?: number
            height?: number
            extmetadata?: Record<string, { value: string } | undefined>
          }[]
        }
      >
    }
  }
  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((p) => {
      const info = p.imageinfo?.[0]
      if (!info) return []
      const meta = info.extmetadata
      return [
        {
          pageid: p.pageid,
          title: p.title,
          url: info.thumburl ?? info.url,
          descriptionurl: info.descriptionurl,
          license: strip(meta?.LicenseShortName?.value),
          licenseCode: strip(meta?.License?.value),
          copyrighted: strip(meta?.Copyrighted?.value),
          categories: strip(meta?.Categories?.value),
          credit: meta?.Credit?.value ?? '',
          description: strip(meta?.ImageDescription?.value),
          date: strip(meta?.DateTimeOriginal?.value),
          width: info.width,
          height: info.height
        }
      ]
    })
}

/** Chronicling America ads on Commons matching the query (public domain, ≤ 1930). */
export async function searchCommonsAds(
  query: string,
  limit = 10,
  signal?: AbortSignal,
  reject: Reject = ignore
): Promise<AdPage[]> {
  const files = await commonsFiles(
    `${query.slice(0, 80)} insource:"chroniclingamerica.loc.gov" filetype:bitmap`,
    limit * 2,
    signal
  )
  return files
    .map((f) => parseCommonsAd(f, reject))
    .filter((p): p is AdPage => !!p)
    .slice(0, limit)
}

/**
 * Any Commons image of the product (trade cards, magazine ads), within the product's
 * categories when known: only confirmed public domain dated ≤ 1930.
 */
export async function searchCommonsGeneral(
  term: string,
  categories: string[],
  limit = 8,
  signal?: AbortSignal,
  reject: Reject = ignore
): Promise<AdPage[]> {
  const cats = categories
    .filter(Boolean)
    .map((c) => `"${c.replace(/^Category:/i, '').replace(/"/g, '')}"`)
  const files = await commonsFiles(
    `${term.slice(0, 80)}${cats.length ? ` incategory:${cats.join('|')}` : ''} filetype:bitmap`,
    limit * 2,
    signal
  )
  return files
    .map((f) => parseCommonsFile(f, reject))
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

/**
 * Read an ad image (Commons, Internet Archive or a local file) with the local OCR so the
 * topic and script work from the ad's real words (a caption is not enough). Cached next to
 * the downloaded copy, with the OCR confidence.
 */
export async function withOcr(page: AdPage, signal?: AbortSignal): Promise<AdPage> {
  if (!page.mirror) return page
  const dir = join(tmpdir(), 'canal-commons-ads')
  const file = join(dir, `${createHash('sha1').update(page.mirror).digest('hex')}.jpg`)
  const cache = `${file}.ocr2.json`
  try {
    if (existsSync(cache)) {
      const c = JSON.parse(readFileSync(cache, 'utf8')) as { text: string; confidence: number }
      return { ...page, ocrText: c.text, ocrConfidence: c.confidence }
    }
    mkdirSync(dir, { recursive: true })
    if (!existsSync(file)) await fetchImage(page.mirror, file, signal)
    const ocr = await localOcr(file, signal)
    if (ocr.confidence < OCR_MIN_CONFIDENCE || !ocr.text)
      return { ...page, ocrConfidence: ocr.confidence }
    writeFileSync(cache, JSON.stringify({ text: ocr.text, confidence: ocr.confidence }))
    return { ...page, ocrText: ocr.text, ocrConfidence: ocr.confidence }
  } catch (error) {
    if (signal?.aborted) throw error
    return page
  }
}

/**
 * The file page itself must confirm public domain: its license template is a PD one and it
 * is marked not copyrighted; the PD template found (e.g. PD-US-expired) is returned for the
 * credit line. Anything else (CC licenses, unknown, fair use) is refused.
 */
export function confirmedPublicDomain(f: CommonsFile): string | null {
  if (!/^(pd|cc0)/i.test(f.licenseCode ?? '')) return null
  if ((f.copyrighted ?? '').toLowerCase() !== 'false') return null
  const template =
    /PD[- ]US[- ]expired|PD[- ]US[- ]no[- ]notice|PD[- ]US[- ]not[- ]renewed|PD[- ]US|PD[- ]old[\w-]*|CC0/i.exec(
      f.categories ?? ''
    )?.[0]
  return template ? `${f.license || 'Public domain'} (${template.replace(/ /g, '-')})` : null
}
