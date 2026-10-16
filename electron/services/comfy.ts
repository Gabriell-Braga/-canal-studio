import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, extname, join } from 'path'
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
  const workflow = useZ
    ? zImageWorkflow(fullPrompt, opts.width ?? 1344, opts.height ?? 768, seed)
    : sdxlWorkflow(fullPrompt, s, opts.width ?? 1344, opts.height ?? 768, seed)
  await runWorkflow(workflow, out, s, opts.signal)
}

/** Real-ESRGAN x4 (BSD-3) in ComfyUI/models/upscale_models. */
export const UPSCALER = 'RealESRGAN_x4plus.pth'

export function hasUpscaler(comfyPath: string): boolean {
  return existsSync(join(comfyPath, 'ComfyUI', 'models', 'upscale_models', UPSCALER))
}

/** Upscale an image 4x with Real-ESRGAN through ComfyUI, saved to `out` (PNG). */
export async function upscaleImage(
  file: string,
  out: string,
  s: Settings,
  signal?: AbortSignal
): Promise<void> {
  const form = new FormData()
  form.append('image', new Blob([readFileSync(file)]), `canal_${randomUUID()}${extname(file)}`)
  form.append('overwrite', 'true')
  const up = await fetch(`${s.comfyUrl}/upload/image`, { method: 'POST', body: form })
  if (!up.ok) throw new Error(`ComfyUI /upload/image HTTP ${up.status}`)
  const { name } = (await up.json()) as { name: string }
  await runWorkflow(
    {
      '1': { class_type: 'LoadImage', inputs: { image: name } },
      '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: UPSCALER } },
      '3': {
        class_type: 'ImageUpscaleWithModel',
        inputs: { upscale_model: ['2', 0], image: ['1', 0] }
      },
      '4': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'canal-upscale', images: ['3', 0] }
      }
    },
    out,
    s,
    signal
  )
}

/** Queue a workflow and save its first output image to `out`. */
async function runWorkflow(
  workflow: object,
  out: string,
  s: Settings,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${s.comfyUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: randomUUID() })
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
    if (signal?.aborted) {
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

/** IP-Adapter Plus for SDXL (ComfyUI_IPAdapter_plus node + its models). */
export const IPADAPTER = {
  node: 'ComfyUI_IPAdapter_plus',
  model: 'ip-adapter-plus_sdxl_vit-h.safetensors',
  clipVision: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors'
}

export function hasIpAdapter(comfyPath: string): boolean {
  const root = join(comfyPath, 'ComfyUI')
  return (
    existsSync(join(root, 'custom_nodes', IPADAPTER.node)) &&
    existsSync(join(root, 'models', 'ipadapter', IPADAPTER.model)) &&
    existsSync(join(root, 'models', 'clip_vision', IPADAPTER.clipVision))
  )
}

export const ENGRAVING_STYLE =
  '19th-century newspaper wood engraving, black ink linework on aged paper, cross-hatching, no color, light sepia'

const ENGRAVING_NEGATIVE =
  'photo, photograph, photorealistic, realistic skin, color, colorful, text, letters, words, writing, typography, caption, inscription, plate number, border text, signature, watermark, logo, face, face close-up, portrait, 3d render'

async function uploadImage(file: string, s: Settings): Promise<string> {
  const form = new FormData()
  form.append('image', new Blob([readFileSync(file)]), `canal_${randomUUID()}${extname(file)}`)
  form.append('overwrite', 'true')
  const up = await fetch(`${s.comfyUrl}/upload/image`, { method: 'POST', body: form })
  if (!up.ok) throw new Error(`ComfyUI /upload/image HTTP ${up.status}`)
  return ((await up.json()) as { name: string }).name
}

/**
 * An illustration in the style of a period newspaper engraving (SDXL, 1344×768). With
 * IP-Adapter installed, 2–3 real engravings of the video steer the style (style transfer);
 * without it, the prompt alone does. Returns whether IP-Adapter was used.
 */
export async function engravingImage(
  prompt: string,
  refs: string[],
  out: string,
  s: Settings,
  signal?: AbortSignal,
  seed = Math.floor(Math.random() * 2 ** 31)
): Promise<boolean> {
  const workflow = sdxlWorkflow(`${ENGRAVING_STYLE}, ${prompt}`, s, 1344, 768, seed) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >
  workflow['7'].inputs.text = ENGRAVING_NEGATIVE
  workflow['3'].inputs.steps = 30
  const useIp = refs.length > 0 && hasIpAdapter(s.comfyPath)
  if (useIp) {
    const names = await Promise.all(refs.slice(0, 3).map((f) => uploadImage(f, s)))
    // Every reference at the same size, so they can go in one batch.
    names.forEach((name, i) => {
      workflow[`r${i}`] = { class_type: 'LoadImage', inputs: { image: name } }
      workflow[`s${i}`] = {
        class_type: 'ImageScale',
        inputs: {
          image: [`r${i}`, 0],
          upscale_method: 'lanczos',
          width: 512,
          height: 512,
          crop: 'center'
        }
      }
    })
    let batch: unknown[] = ['s0', 0]
    for (let i = 1; i < names.length; i++) {
      workflow[`b${i}`] = {
        class_type: 'ImageBatch',
        inputs: { image1: batch, image2: [`s${i}`, 0] }
      }
      batch = [`b${i}`, 0]
    }
    workflow.ipm = {
      class_type: 'IPAdapterModelLoader',
      inputs: { ipadapter_file: IPADAPTER.model }
    }
    workflow.clv = { class_type: 'CLIPVisionLoader', inputs: { clip_name: IPADAPTER.clipVision } }
    workflow.ipa = {
      class_type: 'IPAdapterAdvanced',
      inputs: {
        model: ['4', 0],
        ipadapter: ['ipm', 0],
        image: batch,
        clip_vision: ['clv', 0],
        weight: 0.8,
        weight_type: 'style transfer',
        combine_embeds: 'average',
        start_at: 0,
        end_at: 1,
        embeds_scaling: 'V only'
      }
    }
    workflow['3'].inputs.model = ['ipa', 0]
  }
  await runWorkflow(workflow, out, s, signal)
  return useIp
}
