/**
 * Keyless public-domain archives. Each is good at one kind of topic, so channels enable
 * the ones that fit (space → NASA, art/history → The Met, vintage → Internet Archive).
 */
import type { StockCandidate } from './pexels'
import type { AdPage } from './chroniclingamerica'
import { PUBLIC_DOMAIN_UNTIL } from '../../shared/formats/vintage-ads'
import { WIKIMEDIA_USER_AGENT as USER_AGENT } from './wikimedia'

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`)
  return (await res.json()) as T
}

// ---------------------------------------------------------------- NASA

interface NasaItem {
  href: string
  data: { nasa_id: string; media_type: 'image' | 'video'; title: string; description?: string }[]
}

/**
 * NASA Image and Video Library. NASA media is generally not copyrighted; videos come as
 * ~mobile.mp4 renditions, images as ~large.jpg.
 */
export async function searchNasa(
  query: string,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const q = encodeURIComponent(query.slice(0, 100))
  const { collection } = await getJson<{ collection: { items: NasaItem[] } }>(
    `https://images-api.nasa.gov/search?q=${q}&media_type=video,image&page_size=24`,
    signal
  )
  const items = collection.items
    .filter((i) => !exclude.has(`nasa:${i.data[0]?.nasa_id}`))
    .slice(0, 10)
  const out = await Promise.all(
    items.map(async (item): Promise<StockCandidate | null> => {
      const meta = item.data[0]
      try {
        const files = await getJson<string[]>(item.href, signal)
        const pick =
          meta.media_type === 'video'
            ? (files.find((f) => /~mobile\.mp4$/i.test(f)) ??
              files.find((f) => /~preview\.mp4$/i.test(f)))
            : (files.find((f) => /~large\.jpg$/i.test(f)) ??
              files.find((f) => /~orig\.jpg$/i.test(f)))
        if (!pick) return null
        return {
          source: `nasa:${meta.nasa_id}`,
          kind: meta.media_type === 'video' ? 'stock_video' : 'stock_photo',
          url: encodeURI(pick.replace(/^http:/, 'https:')),
          label: `${meta.title}. ${(meta.description ?? '').slice(0, 160)}`
        }
      } catch {
        return null
      }
    })
  )
  // Videos first: moving footage beats stills.
  const found = out.filter((c): c is StockCandidate => !!c)
  return [
    ...found.filter((c) => c.kind === 'stock_video'),
    ...found.filter((c) => c.kind !== 'stock_video')
  ]
}

// ---------------------------------------------------------------- The Met

interface MetObject {
  objectID: number
  isPublicDomain: boolean
  primaryImage: string
  title: string
  objectDate?: string
  culture?: string
  objectName?: string
}

/** The Metropolitan Museum of Art Open Access (CC0 for public-domain works). */
export async function searchMet(
  query: string,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const q = encodeURIComponent(query.slice(0, 100))
  const { objectIDs } = await getJson<{ objectIDs: number[] | null }>(
    `https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&q=${q}`,
    signal
  )
  const ids = (objectIDs ?? []).filter((id) => !exclude.has(`met:${id}`)).slice(0, 14)
  const objects = await Promise.all(
    ids.map((id) =>
      getJson<MetObject>(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
        signal
      ).catch(() => null)
    )
  )
  return objects
    .filter((o): o is MetObject => !!o && o.isPublicDomain && !!o.primaryImage)
    .map((o) => ({
      source: `met:${o.objectID}`,
      kind: 'stock_photo' as const,
      url: o.primaryImage,
      label: [o.title, o.objectName, o.objectDate, o.culture].filter(Boolean).join(', ')
    }))
}

// ---------------------------------------------------------------- Internet Archive (Prelinger)

interface ArchiveFile {
  name: string
  format?: string
  width?: string
  height?: string
  length?: string
}

/**
 * Prelinger Archives on the Internet Archive: vintage industrial, educational and newsreel
 * films released to the public domain. Mostly 640x480, so best as "archive footage".
 */
export async function searchArchive(
  query: string,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const q = encodeURIComponent(
    `collection:prelinger AND mediatype:movies AND (${query.slice(0, 100)})`
  )
  const { response } = await getJson<{
    response: { docs: { identifier: string; title?: string }[] }
  }>(
    `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&fl[]=title&rows=8&output=json`,
    signal
  )
  const docs = response.docs.filter((d) => !exclude.has(`archive:${d.identifier}`)).slice(0, 6)
  const out = await Promise.all(
    docs.map(async (d): Promise<StockCandidate | null> => {
      try {
        const meta = await getJson<{ files: ArchiveFile[] }>(
          `https://archive.org/metadata/${d.identifier}`,
          signal
        )
        const mp4 = meta.files
          .filter((f) => /\.mp4$/i.test(f.name) && f.format === 'h.264')
          .sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0))[0]
        if (!mp4) return null
        return {
          source: `archive:${d.identifier}`,
          kind: 'stock_video',
          url: `https://archive.org/download/${d.identifier}/${encodeURIComponent(mp4.name)}`,
          label: `Vintage film: ${d.title ?? d.identifier}`,
          duration: Number(mp4.length) || undefined
        }
      } catch {
        return null
      }
    })
  )
  return out.filter((c): c is StockCandidate => !!c)
}

// ---------------------------------------------------------------- Internet Archive (ads)

export interface ArchiveDoc {
  identifier: string
  title?: string
  year?: string | number
  date?: string
  licenseurl?: string
  rights?: string | string[]
  'possible-copyright-status'?: string | string[]
}

/**
 * The item's own rights say public domain: a PD/CC0 license URL, the NOT_IN_COPYRIGHT status,
 * or a rights statement that starts with it. Free text that only mentions the public domain
 * ("Copyright status unknown… works not in the public domain…") is refused.
 */
export function publicRights(
  d: Pick<ArchiveDoc, 'licenseurl' | 'rights' | 'possible-copyright-status'>
): string | null {
  const all = (v: string | string[] | undefined): string[] => [v ?? []].flat()
  const url = all(d.licenseurl).find((u) => /publicdomain|cc0/i.test(u))
  if (url) return url.replace(/^https?:\/\//, '')
  if (all(d['possible-copyright-status']).some((s) => /^NOT_IN_COPYRIGHT$/i.test(s.trim())))
    return 'not in copyright'
  const text = all(d.rights).find(
    (r) =>
      /^\s*(public domain|no known copyright restrictions)/i.test(r) &&
      !/unknown|may be protected|permission/i.test(r)
  )
  return text ? text.trim().slice(0, 60) : null
}

/** An Internet Archive item as an ad page, or null (with the reason) when it cannot be used. */
export function parseArchiveDoc(
  d: ArchiveDoc,
  reject: (title: string, reason: string) => void
): AdPage | null {
  const title = d.title ?? d.identifier
  const year = Number(String(d.year ?? d.date ?? '').slice(0, 4))
  if (!year) return (reject(title, 'sem data'), null)
  if (year > PUBLIC_DOMAIN_UNTIL)
    return (reject(title, `de ${year}, depois de ${PUBLIC_DOMAIN_UNTIL}`), null)
  const free = publicRights(d)
  if (!free) return (reject(title, 'direitos não são de domínio público'), null)
  // "1909-01-01" is how the Archive stores a bare year.
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(d.date ?? '')?.[0]?.replace(/-01-01$/, '')
  const details = `https://archive.org/details/${d.identifier}`
  return {
    id: `archive:${d.identifier}`,
    newspaper: title.slice(0, 80),
    city: '',
    state: '',
    date: iso?.length === 10 && Number(iso.slice(0, 4)) === year ? iso : String(year),
    page: '',
    locUrl: details,
    imageUrl: '',
    license: `Public domain (${free})`,
    mirrorPage: details,
    origin: 'archive'
  }
}

/** The largest image of an item, with its pixel count when the metadata gives it. */
export async function archiveImage(
  identifier: string,
  signal?: AbortSignal
): Promise<{ url: string; pixels?: number } | null> {
  const meta = await getJson<{ files: ArchiveFile[] }>(
    `https://archive.org/metadata/${identifier}`,
    signal
  )
  const img = meta.files
    .filter((f) => /\.(jpe?g|png)$/i.test(f.name) && !/thumb/i.test(f.name))
    .sort(
      (a, b) =>
        Number(b.width ?? 0) * Number(b.height ?? 0) - Number(a.width ?? 0) * Number(a.height ?? 0)
    )[0]
  if (!img) return null
  return {
    url: `https://archive.org/download/${identifier}/${encodeURIComponent(img.name)}`,
    pixels: Number(img.width ?? 0) * Number(img.height ?? 0) || undefined
  }
}

/** Ad images on the Internet Archive: items dated ≤ 1930 with public-domain rights only. */
export async function searchArchiveAds(
  term: string,
  limit = 6,
  signal?: AbortSignal,
  reject: (title: string, reason: string) => void = () => undefined
): Promise<AdPage[]> {
  const q = encodeURIComponent(
    `(${term.slice(0, 100)}) AND mediatype:image AND year:[1800 TO ${PUBLIC_DOMAIN_UNTIL}]`
  )
  const fl = [
    'identifier',
    'title',
    'year',
    'date',
    'licenseurl',
    'rights',
    'possible-copyright-status'
  ]
    .map((f) => `fl[]=${f}`)
    .join('&')
  const { response } = await getJson<{ response: { docs: ArchiveDoc[] } }>(
    `https://archive.org/advancedsearch.php?q=${q}&${fl}&rows=${limit * 2}&output=json`,
    signal
  )
  const out: AdPage[] = []
  for (const d of response.docs) {
    if (out.length >= limit) break
    const page = parseArchiveDoc(d, reject)
    if (!page) continue
    const img = await archiveImage(d.identifier, signal).catch(() => null)
    if (!img) {
      reject(page.newspaper, 'sem imagem no item')
      continue
    }
    out.push({ ...page, imageUrl: img.url, mirror: img.url, pixels: img.pixels })
  }
  return out
}

/** One Internet Archive item as an ad page (same rules as the search), with its image. */
export async function archiveItem(
  identifier: string,
  reject: (title: string, reason: string) => void,
  signal?: AbortSignal
): Promise<AdPage | null> {
  const { metadata } = await getJson<{ metadata?: Omit<ArchiveDoc, 'identifier'> }>(
    `https://archive.org/metadata/${identifier}`,
    signal
  )
  if (!metadata) return (reject(identifier, 'item não encontrado'), null)
  const page = parseArchiveDoc({ identifier, ...metadata }, reject)
  if (!page) return null
  const img = await archiveImage(identifier, signal)
  if (!img) return (reject(page.newspaper, 'sem imagem no item'), null)
  return { ...page, imageUrl: img.url, mirror: img.url, pixels: img.pixels }
}

// ---------------------------------------------------------------- Internet Archive (texts)

/**
 * Rights of a book, pamphlet or almanac: its own public-domain statement, or publication up
 * to PUBLIC_DOMAIN_UNTIL (public domain in the US by date). Null when neither holds.
 */
export function textRights(d: ArchiveDoc): { year: number; rights: string } | null {
  const year = Number(String(d.year ?? d.date ?? '').slice(0, 4))
  if (!year || year > PUBLIC_DOMAIN_UNTIL) return null
  const free = publicRights(d)
  return {
    year,
    rights: free ? `Public domain (${free})` : `public domain in the US (published ${year})`
  }
}

/** Page candidates (first 6 pages, 1600 px) of the items, when their rights pass. */
export function archivePageCandidates(docs: ArchiveDoc[], exclude: Set<string>): StockCandidate[] {
  const out: StockCandidate[] = []
  for (const d of docs) {
    const r = textRights(d)
    if (!r) continue
    const title = (d.title ?? d.identifier).slice(0, 120)
    for (let k = 0; k < 6; k++) {
      const source = `archive:${d.identifier}:n${k}`
      if (exclude.has(source)) continue
      out.push({
        source,
        kind: 'stock_photo',
        url: `https://archive.org/download/${d.identifier}/page/n${k}_w1600.jpg`,
        year: r.year,
        label: `${title} page ${k}`,
        credit: `"${title}", Internet Archive, ${r.rights} (https://archive.org/details/${d.identifier})`
      })
    }
  }
  return out
}

/** Pages of books, pamphlets and almanacs dated up to PUBLIC_DOMAIN_UNTIL. */
export async function searchArchivePages(
  query: string,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const q = encodeURIComponent(
    `(${query.slice(0, 100)}) AND mediatype:texts AND year:[1800 TO ${PUBLIC_DOMAIN_UNTIL}]`
  )
  const fl = [
    'identifier',
    'title',
    'year',
    'date',
    'licenseurl',
    'rights',
    'possible-copyright-status'
  ]
    .map((f) => `fl[]=${f}`)
    .join('&')
  const { response } = await getJson<{ response: { docs: ArchiveDoc[] } }>(
    `https://archive.org/advancedsearch.php?q=${q}&${fl}&rows=5&output=json`,
    signal
  )
  return archivePageCandidates(response.docs, exclude)
}
