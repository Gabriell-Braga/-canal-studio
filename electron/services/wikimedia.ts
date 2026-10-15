import type { StockCandidate } from './pexels'

/** Wikimedia asks API clients to identify themselves. */
const USER_AGENT = 'CanalStudio/1.0 (local desktop app; https://commons.wikimedia.org)'

interface ImageInfo {
  url: string
  thumburl?: string
  width: number
  height: number
  descriptionurl: string
  extmetadata?: Record<string, { value: string } | undefined>
}

interface Page {
  pageid: number
  title: string
  imageinfo?: ImageInfo[]
}

const FREE = /^(public domain|pd|cc0|no restrictions)/i
const ATTRIBUTION = /^cc[ -]by(?![ -]?(sa|nc|nd))[ -]?\d/i
const SHARE_ALIKE = /^cc[ -]by[ -]sa[ -]?\d/i

export interface WikimediaOptions {
  /** CC BY files, credited in the description */
  allowCcBy: boolean
  /** CC BY-SA files, credited the same way: most photos of real people and events */
  allowCcBySa?: boolean
  /** Searching for a real person or event: accept smaller and squarer photos too */
  relaxed?: boolean
  /** Portraits of a person: tall photos are fine, only the face size matters */
  portrait?: boolean
  /** Skip files made after this year (public-domain formats) */
  maxYear?: number
  /** Search inside these Commons categories first (incategory:) */
  categories?: string[]
  /** Internal: restrict this search to these categories */
  categoryFilter?: string[]
}

function strip(html: string | undefined): string {
  return (html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Wikimedia Commons: historical photos, paintings, maps and documents. No key needed.
 * Only files that are public domain / CC0 / "no restrictions", plus CC BY and CC BY-SA when
 * allowed (credited in the description). NC and ND are always skipped: a monetized video is
 * commercial and an adaptation.
 */
export async function searchWikimedia(
  query: string,
  options: WikimediaOptions,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  // The format's categories first; a plain search when they hold nothing for this query.
  if (options.categories?.length) {
    const inside = await searchWikimedia(
      query,
      { ...options, categories: undefined, categoryFilter: options.categories },
      exclude,
      signal
    )
    if (inside.length) return inside
  }
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query.slice(0, 100)} filetype:bitmap${
      options.categoryFilter?.length
        ? ` incategory:${options.categoryFilter.map((c) => c.replace(/ /g, '_')).join('|')}`
        : ''
    }`,
    gsrlimit: '30',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1920',
    iiextmetadatafilter: 'LicenseShortName|Artist|Credit|ImageDescription|DateTimeOriginal'
  })
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal
  })
  if (!res.ok) throw new Error(`Wikimedia HTTP ${res.status}`)
  const data = (await res.json()) as {
    query?: { pages: Record<string, Page & { index?: number }> }
  }
  const pages = Object.values(data.query?.pages ?? {}).sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0)
  )

  const candidates: StockCandidate[] = []
  for (const page of pages) {
    const info = page.imageinfo?.[0]
    const source = `wikimedia:${page.pageid}`
    if (!info || exclude.has(source)) continue
    // Landscape-ish and big enough to fill 1080p after a Ken Burns zoom. A real event photo is
    // worth a softer or squarer frame (cropped to 16:9) over generic stock.
    const [minWidth, minRatio] = options.portrait
      ? [500, 0.4]
      : options.relaxed
        ? [900, 0.95]
        : [1200, 1.2]
    if (info.width < minWidth || info.width / info.height < minRatio) continue
    const license = strip(info.extmetadata?.LicenseShortName?.value)
    const free = FREE.test(license)
    const credited =
      (options.allowCcBy && ATTRIBUTION.test(license)) ||
      (!!options.allowCcBySa && SHARE_ALIKE.test(license))
    if (!free && !credited) continue
    if (options.maxYear) {
      const year = yearOf(strip(info.extmetadata?.DateTimeOriginal?.value))
      if (year !== null && year > options.maxYear) continue
    }
    const artist = strip(info.extmetadata?.Artist?.value) || 'Unknown author'
    candidates.push({
      source,
      kind: 'stock_photo',
      url: info.thumburl ?? info.url,
      label: `${page.title.replace(/^File:/, '').replace(/\.\w+$/, '')}. ${strip(
        info.extmetadata?.ImageDescription?.value
      ).slice(0, 160)}`,
      credit: free
        ? undefined
        : `"${page.title.replace(/^File:/, '')}" by ${artist}, ${license}, via Wikimedia Commons (${info.descriptionurl})`
    })
  }
  return candidates
}

/** First 4-digit year (1500–2099) in a Commons date field, or null. */
export function yearOf(text: string): number | null {
  const m = /\b(1[5-9]\d\d|20\d\d)\b/.exec(text)
  return m ? Number(m[1]) : null
}

export { USER_AGENT as WIKIMEDIA_USER_AGENT }
