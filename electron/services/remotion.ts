import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { RenderJob } from '../../shared/render'

let entryPoint = ''

/** remotion/index.ts in the project (dev) or in the unpacked resources (installed app). */
export function configureRemotion(appRoot: string): void {
  entryPoint = join(appRoot, 'remotion', 'index.ts')
}

/** Hash of the drawing code in remotion/, so a change there renders videos again. */
export function remotionCodeHash(): string {
  const dir = dirname(entryPoint)
  const hash = createHash('sha1')
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile()) hash.update(f.name).update(readFileSync(join(dir, f.name)))
  }
  return hash.digest('hex')
}

/**
 * Run remotion/render.ts (built to out/main/render.js) in a separate Node process.
 * Aborting kills the whole process tree, including headless Chrome.
 */
export function runRender(
  job: Omit<RenderJob, 'entry'>,
  jobFile: string,
  hooks: { progress?: (p: number) => void; log?: (m: string) => void; signal?: AbortSignal }
): Promise<void> {
  writeFileSync(jobFile, JSON.stringify({ ...job, entry: entryPoint }, null, 2))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, 'render.js'), jobFile], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true
    })
    let error = ''
    let stderr = ''
    let buffer = ''
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as { type: string; value?: number; message?: string }
          if (msg.type === 'progress') hooks.progress?.(msg.value ?? 0)
          else if (msg.type === 'log') hooks.log?.(msg.message ?? '')
          else if (msg.type === 'error') error = msg.message ?? 'erro'
        } catch {
          // Remotion and Chrome sometimes print plain text; ignore it.
        }
      }
    })
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)))
    const onAbort = (): void => {
      if (child.pid)
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    }
    hooks.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', reject)
    child.on('exit', (code) => {
      hooks.signal?.removeEventListener('abort', onAbort)
      if (hooks.signal?.aborted) reject(new Error('Cancelado'))
      else if (code === 0) resolve()
      else
        reject(
          new Error(
            `Render falhou: ${error || stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')}`
          )
        )
    })
  })
}
