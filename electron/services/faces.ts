import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import type { Settings } from '../../shared/types'
import { download } from './pexels'
import { pythonGet, pythonPost } from './python'
import { searchWikimedia } from './wikimedia'

/**
 * Thumbnail faces of real people: the base is always a real, freely licensed photo, and the only
 * AI step is LivePortrait's Expression Editor moving the muscles of that same face. No txt2img,
 * no face swap; ArcFace similarity checks the edited face is still the same person.
 */

export interface FaceBox {
  box: [number, number, number, number]
  height: number
  yaw: number
  blur: number
}

export interface FaceInfo {
  faces: FaceBox[]
  width: number
  height: number
}

export const FACE_MIN_HEIGHT = 400
export const FACE_MAX_YAW = 45
/** Laplacian variance of the face resized to 256x256; below this it reads as soft or blurry. */
export const FACE_MIN_BLUR = 40
export const IDENTITY_MIN = 0.6

/** The face to use, or null: exactly one dominant face, big, frontal or 3/4, sharp. */
export function acceptFace(info: FaceInfo): FaceBox | null {
  const [main, second] = info.faces // biggest first
  if (!main) return null
  // Other people in the background are fine; a second face half as tall competes for attention.
  if (second && second.height >= main.height * 0.5) return null
  if (main.height < FACE_MIN_HEIGHT) return null
  if (Math.abs(main.yaw) > FACE_MAX_YAW) return null
  if (main.blur < FACE_MIN_BLUR) return null
  return main
}

export function identityOk(similarity: number): boolean {
  return similarity >= IDENTITY_MIN
}

export type ExpressionPreset = 'laugh' | 'shock' | 'smug' | 'worried'

type ExpressionParams = Record<
  | 'rotate_pitch'
  | 'rotate_yaw'
  | 'rotate_roll'
  | 'blink'
  | 'eyebrow'
  | 'wink'
  | 'pupil_x'
  | 'pupil_y'
  | 'aaa'
  | 'eee'
  | 'woo'
  | 'smile',
  number
>

const NEUTRAL: ExpressionParams = {
  rotate_pitch: 0,
  rotate_yaw: 0,
  rotate_roll: 0,
  blink: 0,
  eyebrow: 0,
  wink: 0,
  pupil_x: 0,
  pupil_y: 0,
  aaa: 0,
  eee: 0,
  woo: 0,
  smile: 0
}

/**
 * Moderate values inside the node's ranges (smile -0.3..1.3, aaa -30..120, eyebrow -10..15,
 * blink -20..5 where negative opens the eyes): strong enough to read at thumbnail size,
 * mild enough that ArcFace still sees the same person.
 */
export const PRESETS: Record<ExpressionPreset, ExpressionParams> = {
  laugh: { ...NEUTRAL, smile: 1, aaa: 35, eee: 6, eyebrow: 4, blink: 1 },
  shock: { ...NEUTRAL, aaa: 55, woo: 4, eyebrow: 11, blink: -7 },
  smug: { ...NEUTRAL, smile: 0.6, eyebrow: -3, blink: 2, rotate_roll: 4, rotate_pitch: -3 },
  worried: { ...NEUTRAL, smile: -0.2, eyebrow: 8, woo: 3, aaa: 8, blink: -3, pupil_y: 3 }
}

export function expressionWorkflow(image: string, preset: ExpressionPreset): object {
  return {
    '1': { class_type: 'LoadImage', inputs: { image } },
    '2': {
      class_type: 'ExpressionEditor',
      inputs: {
        ...PRESETS[preset],
        src_ratio: 1,
        sample_ratio: 1,
        sample_parts: 'OnlyExpression',
        crop_factor: 1.7,
        src_image: ['1', 0]
      }
    },
    '3': { class_type: 'SaveImage', inputs: { filename_prefix: 'canal-face', images: ['2', 0] } }
  }
}

/** A real photo of `name` from Wikimedia Commons (PD / CC0 / CC BY / CC BY-SA) with a usable face. */
export async function findFacePhoto(
  name: string,
  _settings: Settings,
  signal?: AbortSignal
): Promise<{ file: string; credit?: string; source: string; box: FaceBox['box'] } | null> {
  const candidates = await searchWikimedia(
    `${name} portrait`,
    { allowCcBy: true, allowCcBySa: true, relaxed: true },
    new Set(),
    signal
  )
  const dir = join(tmpdir(), 'canal-studio-faces')
  for (const c of candidates.slice(0, 12)) {
    const file = join(dir, `${c.source.replace(':', '-')}.jpg`)
    try {
      if (!existsSync(file)) await download(c.url, file, signal)
      const face = acceptFace(await pythonPost<FaceInfo>('/face_info', { path: file }, signal))
      if (face) return { file, credit: c.credit, source: c.source, box: face.box }
    } catch (e) {
      if (signal?.aborted) throw e
      // A broken download or an image the detector cannot read: try the next one.
    }
  }
  return null
}

interface HistoryEntry {
  status?: { status_str?: string; messages?: [string, { exception_message?: string }][] }
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>
}

/** Change only the expression of the face in `photo` and write the result to `out`. */
export async function editExpression(
  photo: string,
  preset: ExpressionPreset,
  out: string,
  s: Settings,
  signal?: AbortSignal
): Promise<void> {
  const form = new FormData()
  form.append('image', new Blob([readFileSync(photo)]), `canal-${randomUUID()}-${basename(photo)}`)
  form.append('overwrite', 'true')
  const up = await fetch(`${s.comfyUrl}/upload/image`, { method: 'POST', body: form, signal })
  if (!up.ok) throw new Error(`ComfyUI /upload/image HTTP ${up.status}`)
  const { name, subfolder } = (await up.json()) as { name: string; subfolder?: string }

  const res = await fetch(`${s.comfyUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: expressionWorkflow(subfolder ? `${subfolder}/${name}` : name, preset),
      client_id: randomUUID()
    }),
    signal
  })
  const queued = (await res.json()) as { prompt_id?: string; error?: { message: string } }
  if (!res.ok || !queued.prompt_id) {
    throw new Error(`ComfyUI recusou o workflow: ${queued.error?.message ?? res.status}`)
  }
  const id = queued.prompt_id
  // ponytail: same polling as comfy.ts generateImage; extract a shared helper if a third caller appears.
  for (let i = 0; i < 300; i++) {
    if (signal?.aborted) {
      await fetch(`${s.comfyUrl}/interrupt`, { method: 'POST' }).catch(() => undefined)
      throw new Error('Cancelado')
    }
    await new Promise((r) => setTimeout(r, 1000))
    const entry = (
      (await (await fetch(`${s.comfyUrl}/history/${id}`)).json()) as Record<string, HistoryEntry>
    )[id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      const err = entry.status.messages?.find(([k]) => k === 'execution_error')?.[1]
      throw new Error(`ComfyUI falhou: ${err?.exception_message ?? 'erro desconhecido'}`)
    }
    // Node 3 is SaveImage; the editor node also emits a temp preview of the face crop.
    const image = entry.outputs?.['3']?.images?.[0]
    if (!image) continue
    const img = await fetch(`${s.comfyUrl}/view?${new URLSearchParams(image)}`)
    if (!img.ok) throw new Error(`ComfyUI /view HTTP ${img.status}`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, Buffer.from(await img.arrayBuffer()))
    await pythonPost('/color_match', { reference: photo, path: out }, signal)
    return
  }
  throw new Error('ComfyUI demorou mais de 5 minutos para editar a expressão')
}

export async function checkIdentity(
  original: string,
  edited: string,
  signal?: AbortSignal
): Promise<{ similarity: number; ok: boolean }> {
  const { similarity } = await pythonPost<{ similarity: number }>(
    '/face_similarity',
    { a: original, b: edited },
    signal
  )
  return { similarity, ok: identityOk(similarity) }
}

/** ComfyUI has the Expression Editor node and the sidecar has insightface. */
export async function expressionAvailable(s: Settings): Promise<boolean> {
  try {
    const res = await fetch(`${s.comfyUrl}/object_info/ExpressionEditor`, {
      signal: AbortSignal.timeout(3000)
    })
    const node = (await res.json()) as Record<string, unknown>
    if (!res.ok || !node.ExpressionEditor) return false
    return (await pythonGet<{ insightface?: boolean }>('/health')).insightface === true
  } catch {
    return false
  }
}
