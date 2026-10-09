import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import type { Focus } from '../../shared/render'
import { pythonPost } from '../services/python'
import type { StepContext } from './types'

/**
 * Point of an image to keep when it is cropped to the frame: the top of its main subject,
 * so a square photo of a person does not lose the head. Cached next to the image and
 * computed again when the image changes. Undefined = keep the crop centered.
 */
export async function focusOf(file: string, signal?: AbortSignal): Promise<Focus | undefined> {
  const cache = `${file}.focus.json`
  const mtime = statSync(file).mtimeMs
  if (existsSync(cache)) {
    try {
      const saved = JSON.parse(readFileSync(cache, 'utf8')) as { mtime: number; focus?: Focus }
      if (saved.mtime === mtime) return saved.focus
    } catch {
      // Unreadable cache: compute again.
    }
  }
  const r = await pythonPost<{ x: number | null; y: number | null; aspect: number }>(
    '/focus',
    { image_path: file },
    signal
  )
  const focus = r.x === null || r.y === null ? undefined : { x: r.x, y: r.y, aspect: r.aspect }
  writeFileSync(cache, JSON.stringify({ mtime, focus }))
  return focus
}

/** focusOf for a render: a failure only logs and leaves the crop centered. */
export async function sceneFocus(file: string, ctx: StepContext): Promise<Focus | undefined> {
  try {
    return await focusOf(file, ctx.signal)
  } catch (error) {
    ctx.log(`Enquadramento automático indisponível: ${(error as Error).message}`, 'warn')
    return undefined
  }
}
