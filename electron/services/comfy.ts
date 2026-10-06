import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Settings } from '../../shared/types'
import { startDetached } from './exec'

const NEGATIVE =
  'text, watermark, logo, signature, letters, words, caption, blurry, low quality, jpeg artifacts, deformed, extra fingers, cartoon, anime'

export async function comfyUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/** Start ComfyUI from its portable folder if it is not running, and wait for the API. */
export async function ensureComfy(s: Settings, signal?: AbortSignal): Promise<void> {
  if (await comfyUp(s.comfyUrl)) return
  const python = join(s.comfyPath, 'python_embeded', 'python.exe')
  if (!existsSync(python)) throw new Error(`ComfyUI não encontrado em ${s.comfyPath}`)
  startDetached(
    python,
    ['-s', join('ComfyUI', 'main.py'), '--windows-standalone-build', '--disable-auto-launch'],
    s.comfyPath
  )
  for (let i = 0; i < 90; i++) {
    if (signal?.aborted) throw new Error('Cancelado')
    await new Promise((r) => setTimeout(r, 2000))
    if (await comfyUp(s.comfyUrl)) return
  }
  throw new Error('ComfyUI não respondeu em 3 minutos')
}

/** Z-Image Turbo files in ComfyUI/models (Apache 2.0). */
export const ZIMAGE = {
  unet: 'z_image_turbo_int8_convrot.safetensors',
  clip: 'qwen_3_4b_fp8_mixed.safetensors',
  vae: 'ae.safetensors'
}

export function hasZImage(comfyPath: string): boolean {
  const models = join(comfyPath, 'ComfyUI', 'models')
  return (
    existsSync(join(models, 'diffusion_models', ZIMAGE.unet)) &&
    existsSync(join(models, 'text_encoders', ZIMAGE.clip)) &&
    existsSync(join(models, 'vae', ZIMAGE.vae))
  )
}

/** Z-Image Turbo: distilled, 9 steps at CFG 1 (no negative prompt), photographic output. */
function zImageWorkflow(prompt: string, width: number, height: number, seed: number): object {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: ZIMAGE.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: ZIMAGE.clip, type: 'lumina2' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: ZIMAGE.vae } },
    '4': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '6': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['5', 0] } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 9,
        cfg: 1,
        sampler_name: 'res_multistep',
        scheduler: 'simple',
        denoise: 1,
        model: ['4', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0]
      }
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'canal-studio', images: ['9', 0] } }
  }
}

function sdxlWorkflow(
  prompt: string,
  s: Settings,
  width: number,
  height: number,
  seed: number
): object {
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: s.comfyCheckpoint } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE, clip: ['4', 1] } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 25,
        cfg: 6.5,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0]
      }
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'canal-studio', images: ['8', 0] } }
  }
}

interface HistoryEntry {
  status?: {
    status_str?: string
    completed?: boolean
    messages?: [string, { exception_message?: string }][]
  }
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>
}

/** Generate one SDXL image and save it to `out` (PNG). */
export async function generateImage(
  prompt: string,
  out: string,
  s: Settings,
  opts: { width?: number; height?: number; seed?: number; signal?: AbortSignal } = {}
): Promise<void> {
  const useZ = s.imageModel === 'z-image' && hasZImage(s.comfyPath)
  // Z-Image renders lettering well, so ask for none; brand names in prompts become signs.
  const fullPrompt = useZ
    ? `${prompt}. Cinematic documentary photograph, 35mm film, natural light, realistic detail. No text, no lettering, no logos, no watermarks.`
    : `${prompt}, cinematic documentary photograph, dramatic natural lighting, highly detailed, 35mm film`
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31)
  const res = await fetch(`${s.comfyUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: useZ
        ? zImageWorkflow(fullPrompt, opts.width ?? 1344, opts.height ?? 768, seed)
        : sdxlWorkflow(fullPrompt, s, opts.width ?? 1344, opts.height ?? 768, seed),
      client_id: randomUUID()
    })
  })
  const queued = (await res.json()) as {
    prompt_id?: string
    error?: { message: string }
    node_errors?: unknown
  }
  if (!res.ok || !queued.prompt_id) {
    throw new Error(
      `ComfyUI recusou o workflow: ${queued.error?.message ?? res.status} ${JSON.stringify(queued.node_errors ?? '')}`
    )
  }
  const id = queued.prompt_id
  for (let i = 0; i < 600; i++) {
    if (opts.signal?.aborted) {
      await fetch(`${s.comfyUrl}/interrupt`, { method: 'POST' }).catch(() => undefined)
      throw new Error('Cancelado')
    }
    await new Promise((r) => setTimeout(r, 1000))
    const history = (await (await fetch(`${s.comfyUrl}/history/${id}`)).json()) as Record<
      string,
      HistoryEntry
    >
    const entry = history[id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      const err = entry.status.messages?.find(([k]) => k === 'execution_error')?.[1]
        ?.exception_message
      throw new Error(`ComfyUI falhou: ${err ?? 'erro desconhecido'}`)
    }
    const image = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0]
    if (!image) continue
    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type
    })
    const img = await fetch(`${s.comfyUrl}/view?${params}`)
    if (!img.ok) throw new Error(`ComfyUI /view HTTP ${img.status}`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, Buffer.from(await img.arrayBuffer()))
    return
  }
  throw new Error('ComfyUI demorou mais de 10 minutos para uma imagem')
}

/** Unload models and free VRAM after a batch (POST /free). */
export async function freeComfy(url: string): Promise<void> {
  await fetch(`${url}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true })
  }).catch(() => undefined)
}
