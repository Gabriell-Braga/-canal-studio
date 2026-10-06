/**
 * Keyless public-domain archives. Each is good at one kind of topic, so channels enable
 * the ones that fit (space → NASA, art/history → The Met, vintage → Internet Archive).
 */
import type { StockCandidate } from './pexels'
import { WIKIMEDIA_USER_AGENT as USER_AGENT } from './wikimedia'

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`)
  return (await res.json()) as T
}

// ---------------------------------------------------------------- NASA

interface NasaItem {
  href: string
  data: { nasa_id: string; media_type: 'image' | 'video'; title: string }[]
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
          url: encodeURI(pick.replace(/^http:/, 'https:'))
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
      url: o.primaryImage
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
  const { response } = await getJson<{ response: { docs: { identifier: string }[] } }>(
    `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&rows=8&output=json`,
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
          duration: Number(mp4.length) || undefined
        }
      } catch {
        return null
      }
    })
  )
  return out.filter((c): c is StockCandidate => !!c)
}
