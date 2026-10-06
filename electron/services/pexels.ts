import { createWriteStream, mkdirSync, renameSync } from 'fs'
import { dirname } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { WIKIMEDIA_USER_AGENT } from './wikimedia'

interface PexelsVideoFile {
  id: number
  quality: string | null
  file_type: string
  width: number | null
  height: number | null
  link: string
}

interface PexelsVideo {
  id: number
  url?: string
  duration: number
  width: number
  height: number
  video_files: PexelsVideoFile[]
}

interface PexelsPhoto {
  id: number
  alt?: string
  width: number
  height: number
  src: { original: string; large2x: string; landscape: string }
}

export interface StockCandidate {
  source: string // "pexels:video:123" | "pexels:photo:456"
  kind: 'stock_video' | 'stock_photo'
  url: string
  duration?: number
  /** Attribution required by the file's license, if any. */
  credit?: string
  /** What the media shows (tags, title, description), used to judge relevance */
  label?: string
}

async function pexelsGet<T>(path: string, key: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`https://api.pexels.com${path}`, {
    headers: { Authorization: key },
    signal
  })
  if (res.status === 401 || res.status === 403) throw new Error('Chave da Pexels inválida')
  if (res.status === 429) throw new Error('Limite da Pexels atingido (200/hora). Tente mais tarde.')
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Pick the 1920-wide (or best HD) MP4 rendition of a video. */
function bestFile(v: PexelsVideo): PexelsVideoFile | undefined {
  const mp4 = v.video_files.filter((f) => f.file_type === 'video/mp4' && (f.width ?? 0) >= 1280)
  return (
    mp4.find((f) => f.width === 1920) ??
    mp4.filter((f) => (f.width ?? 0) <= 2560).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
  )
}

/**
 * Landscape HD candidates for a scene, best first: videos that cover the scene duration,
 * then shorter videos, then photos. Already used sources are skipped.
 */
export async function searchStock(
  query: string,
  minDuration: number,
  key: string,
  exclude: Set<string>,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const q = encodeURIComponent(query)
  const { videos } = await pexelsGet<{ videos: PexelsVideo[] }>(
    `/videos/search?query=${q}&orientation=landscape&size=medium&per_page=20`,
    key,
    signal
  )
  const candidates: StockCandidate[] = []
  const usable = videos
    .filter((v) => v.width > v.height && !exclude.has(`pexels:video:${v.id}`))
    .map((v) => ({ v, file: bestFile(v) }))
    .filter((x) => x.file)
  const long = usable.filter((x) => x.v.duration >= minDuration)
  const short = usable.filter((x) => x.v.duration < minDuration)
  for (const { v, file } of [...long, ...short]) {
    candidates.push({
      source: `pexels:video:${v.id}`,
      kind: 'stock_video',
      url: file!.link,
      duration: v.duration,
      // The page URL slug is the clip's title: /video/old-ship-at-sea-123/
      label: (v.url ?? '').split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ')
    })
  }
  const { photos } = await pexelsGet<{ photos: PexelsPhoto[] }>(
    `/v1/search?query=${q}&orientation=landscape&size=large&per_page=10`,
    key,
    signal
  )
  for (const p of photos) {
    if (exclude.has(`pexels:photo:${p.id}`) || p.width < 1600) continue
    candidates.push({
      source: `pexels:photo:${p.id}`,
      kind: 'stock_photo',
      url: p.src.large2x,
      label: p.alt
    })
  }
  return candidates
}

export async function download(url: string, out: string, signal?: AbortSignal): Promise<void> {
  // Wikimedia's CDN rejects requests without a descriptive User-Agent.
  const res = await fetch(url, { signal, headers: { 'User-Agent': WIKIMEDIA_USER_AGENT } })
  if (!res.ok || !res.body) throw new Error(`Download falhou: HTTP ${res.status}`)
  mkdirSync(dirname(out), { recursive: true })
  const tmp = `${out}.part`
  await pipeline(
    Readable.fromWeb(res.body as import('stream/web').ReadableStream),
    createWriteStream(tmp)
  )
  renameSync(tmp, out)
}
