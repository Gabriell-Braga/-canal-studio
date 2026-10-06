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

function strip(html: string | undefined): string {
  return (html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Wikimedia Commons: historical photos, paintings, maps and documents. No key needed.
 * Only files that are public domain / CC0 / "no restrictions", plus CC BY when allowed
 * (credited in the description). CC BY-SA, NC and ND are always skipped: a video
 * would be an adaptation they restrict.
 */
export async function searchWikimedia(
  query: string,
  allowCcBy: boolean,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query.slice(0, 100)} filetype:bitmap`,
    gsrlimit: '30',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1920',
    iiextmetadatafilter: 'LicenseShortName|Artist|Credit'
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
    // Landscape-ish and big enough to fill 1080p after a Ken Burns zoom.
    if (info.width < 1200 || info.width / info.height < 1.2) continue
    const license = strip(info.extmetadata?.LicenseShortName?.value)
    const free = FREE.test(license)
    if (!free && !(allowCcBy && ATTRIBUTION.test(license))) continue
    const artist = strip(info.extmetadata?.Artist?.value) || 'Unknown author'
    candidates.push({
      source,
      kind: 'stock_photo',
      url: info.thumburl ?? info.url,
      credit: free
        ? undefined
        : `"${page.title.replace(/^File:/, '')}" by ${artist}, ${license}, via Wikimedia Commons (${info.descriptionurl})`
    })
  }
  return candidates
}

export { USER_AGENT as WIKIMEDIA_USER_AGENT }
