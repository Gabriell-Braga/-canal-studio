/**
 * Render worker. Runs in its own Node process (Electron with ELECTRON_RUN_AS_NODE=1) so the
 * main process stays responsive and a render can be cancelled by killing this process.
 *
 * Usage: render.js <job.json>
 * Prints one JSON object per line: {"type":"progress","value":0.42} | {"type":"done"} | {"type":"error","message":"..."}
 */
import { bundle } from '@remotion/bundler'
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import { createReadStream, existsSync, readFileSync, statSync } from 'fs'
import { createServer, type Server } from 'http'
import { cpus, tmpdir } from 'os'
import { extname, join, normalize, resolve, sep } from 'path'
import type { RenderJob } from '../shared/render'

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

function emit(obj: object): void {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

/** Static file server with Range support; assets stay where they are (no copy into the bundle). */
function serve(root: string): Promise<{ server: Server; base: string }> {
  const rootDir = resolve(root)
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '')
    const file = normalize(join(rootDir, rel))
    if (!file.startsWith(rootDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    const size = statSync(file).size
    const headers = {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    }
    const m = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
    if (m) {
      const start = m[1] ? Number(m[1]) : 0
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1
      })
      createReadStream(file, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size })
      createReadStream(file).pipe(res)
    }
  })
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      ok({ server, base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` })
    })
  )
}

/** Replace {{root}} in every string of the props with the server base URL. */
function withBase<T>(value: T, base: string): T {
  return JSON.parse(JSON.stringify(value).split('{{root}}').join(base)) as T
}

async function main(): Promise<void> {
  const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as RenderJob
  const { server, base } = await serve(job.root)
  try {
    emit({ type: 'log', message: 'Preparando navegador do Remotion' })
    await ensureBrowser()
    emit({ type: 'log', message: 'Empacotando composições' })
    const serveUrl = await bundle({
      entryPoint: job.entry,
      outDir: join(tmpdir(), `canal-remotion-${process.pid}`),
      onProgress: () => undefined
    })
    const concurrency = job.concurrency ?? Math.max(1, Math.floor(cpus().length / 2))

    if (job.mode === 'video' && job.video) {
      const inputProps = withBase(job.video, base)
      const composition = await selectComposition({ serveUrl, id: 'Video', inputProps })
      emit({
        type: 'log',
        message: `Renderizando ${composition.durationInFrames} quadros (concorrência ${concurrency})`
      })
      let last = -1
      await renderMedia({
        serveUrl,
        composition,
        inputProps,
        codec: 'h264',
        crf: 20,
        audioCodec: 'aac',
        audioBitrate: '192k',
        outputLocation: job.out,
        concurrency,
        // Long renders: generous per-frame timeout for big stock clips.
        timeoutInMilliseconds: 120_000,
        offthreadVideoCacheSizeInBytes: 1024 * 1024 * 1024,
        onProgress: ({ progress }) => {
          const pct = Math.floor(progress * 100)
          if (pct !== last) {
            last = pct
            emit({ type: 'progress', value: progress })
          }
        }
      })
    }

    if (job.mode === 'short' && job.short) {
      const inputProps = withBase(job.short, base)
      const composition = await selectComposition({ serveUrl, id: 'Short', inputProps })
      emit({
        type: 'log',
        message: `Renderizando short de ${composition.durationInFrames} quadros`
      })
      let last = -1
      await renderMedia({
        serveUrl,
        composition,
        inputProps,
        codec: 'h264',
        crf: 20,
        audioCodec: 'aac',
        audioBitrate: '192k',
        outputLocation: job.out,
        concurrency,
        timeoutInMilliseconds: 120_000,
        onProgress: ({ progress }) => {
          const pct = Math.floor(progress * 100)
          if (pct !== last) {
            last = pct
            emit({ type: 'progress', value: progress })
          }
        }
      })
    }

    if (job.mode === 'stills' && job.stills) {
      for (const [i, still] of job.stills.entries()) {
        const inputProps = withBase(still.props, base)
        const composition = await selectComposition({ serveUrl, id: 'Thumbnail', inputProps })
        await renderStill({
          serveUrl,
          composition,
          inputProps,
          output: still.out,
          imageFormat: 'png'
        })
        emit({ type: 'progress', value: (i + 1) / job.stills.length })
      }
    }
    emit({ type: 'done' })
  } finally {
    server.close()
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    process.exit(1)
  }
)
