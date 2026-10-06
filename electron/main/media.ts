import { protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname, resolve } from 'path'
import { Readable } from 'stream'

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

/** Must run before app ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        bypassCSP: true
      }
    }
  ])
}

/**
 * media://local/<encoded absolute path> serves files from the allowed roots, with Range
 * support so <video> can seek.
 */
export function handleMedia(allowedRoots: () => string[]): void {
  protocol.handle('media', (request) => {
    const url = new URL(request.url)
    const file = resolve(decodeURIComponent(url.pathname.slice(1)))
    const roots = allowedRoots().map((r) => resolve(r).toLowerCase())
    if (!roots.some((r) => file.toLowerCase().startsWith(r)) || !existsSync(file)) {
      return new Response('Not found', { status: 404 })
    }
    const size = statSync(file).size
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const range = request.headers.get('range')
    const match = range?.match(/bytes=(\d*)-(\d*)/)
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
      const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream
    return new Response(stream, {
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    })
  })
}
