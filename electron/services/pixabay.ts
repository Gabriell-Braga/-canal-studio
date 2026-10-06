import type { StockCandidate } from './pexels'

interface PixabayVideoFile {
  url: string
  width: number
  height: number
  size: number
}

interface PixabayVideo {
  id: number
  duration: number
  videos: Partial<Record<'large' | 'medium' | 'small' | 'tiny', PixabayVideoFile>>
}

interface PixabayImage {
  id: number
  imageWidth: number
  imageHeight: number
  largeImageURL: string
}

async function pixabayGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (res.status === 400 && (await res.text()).includes('key'))
    throw new Error('Chave da Pixabay inválida')
  if (res.status === 429) throw new Error('Limite da Pixabay atingido (100 buscas por minuto)')
  if (!res.ok) throw new Error(`Pixabay HTTP ${res.status}`)
  return (await res.json()) as T
}

/** 1920-wide rendition when there is one; 4K files are too heavy for the render. */
function bestFile(v: PixabayVideo): PixabayVideoFile | undefined {
  const files = [v.videos.medium, v.videos.large, v.videos.small].filter(
    (f): f is PixabayVideoFile => !!f?.url && f.width >= 1280 && f.width > f.height
  )
  return files.find((f) => f.width === 1920) ?? files.sort((a, b) => a.width - b.width)[0]
}

/**
 * Pixabay (free key, Pixabay License: commercial use, no attribution required).
 * Landscape HD videos first (long enough ones before short ones), then photos.
 */
export async function searchPixabay(
  query: string,
  minDuration: number,
  key: string,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const q = encodeURIComponent(query.slice(0, 100))
  const base = `https://pixabay.com/api`
  const { hits: videos } = await pixabayGet<{ hits: PixabayVideo[] }>(
    `${base}/videos/?key=${key}&q=${q}&video_type=film&min_width=1280&safesearch=true&per_page=30`,
    signal
  )
  const usable = videos
    .filter((v) => !exclude.has(`pixabay:video:${v.id}`))
    .map((v) => ({ v, file: bestFile(v) }))
    .filter((x) => x.file)
  const long = usable.filter((x) => x.v.duration >= minDuration)
  const short = usable.filter((x) => x.v.duration < minDuration)
  const candidates: StockCandidate[] = [...long, ...short].map(({ v, file }) => ({
    source: `pixabay:video:${v.id}`,
    kind: 'stock_video',
    url: file!.url,
    duration: v.duration
  }))
  const { hits: photos } = await pixabayGet<{ hits: PixabayImage[] }>(
    `${base}/?key=${key}&q=${q}&image_type=photo&orientation=horizontal&min_width=1600&safesearch=true&per_page=20`,
    signal
  )
  for (const p of photos) {
    if (exclude.has(`pixabay:photo:${p.id}`)) continue
    candidates.push({ source: `pixabay:photo:${p.id}`, kind: 'stock_photo', url: p.largeImageURL })
  }
  return candidates
}
