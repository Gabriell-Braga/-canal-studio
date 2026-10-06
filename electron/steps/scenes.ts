import { copyFileSync, mkdirSync } from 'fs'
import { extname, join } from 'path'
import type { Scene, Settings } from '../../shared/types'
import { getScene, listScenes, updateScene } from '../db/repo'
import { ensureComfy, freeComfy, generateImage } from '../services/comfy'
import { isValidFile } from '../services/ffmpeg'
import { unloadAll } from '../services/ollama'
import { download, searchStock } from '../services/pexels'
import { pythonPost } from '../services/python'
import type { Step } from './types'

function sceneDuration(s: Scene): number {
  return s.start_sec !== null && s.end_sec !== null ? s.end_sec - s.start_sec : 12
}

/** Spread AI scenes evenly so they do not cluster: e.g. ratio 0.3 → every ~3rd scene. */
export function aiIndexes(count: number, ratio: number): Set<number> {
  const n = Math.round(count * Math.max(0, Math.min(1, ratio)))
  const set = new Set<number>()
  for (let k = 0; k < n; k++) set.add(Math.floor(((k + 0.5) * count) / n))
  return set
}

function usedSources(videoId: number, exceptSceneId?: number): Set<string> {
  return new Set(
    listScenes(videoId)
      .filter((s) => s.id !== exceptSceneId && s.asset_source)
      .map((s) => s.asset_source as string)
  )
}

/** Try Pexels for one scene. Returns false when nothing usable was found. */
export async function assignStock(
  scene: Scene,
  dir: string,
  s: Settings,
  extraExclude: string[] = [],
  signal?: AbortSignal
): Promise<boolean> {
  if (!s.pexelsApiKey) return false
  const exclude = usedSources(scene.video_id, scene.id)
  extraExclude.forEach((e) => exclude.add(e))
  const query = scene.visual_keywords || scene.narration.split(/\s+/).slice(0, 4).join(' ')
  const candidates = await searchStock(query, sceneDuration(scene), s.pexelsApiKey, exclude, signal)
  const pick = candidates[0]
  if (!pick) return false
  const ext = pick.kind === 'stock_video' ? '.mp4' : '.jpg'
  const out = join(
    dir,
    `scene_${String(scene.index).padStart(3, '0')}_${pick.source.replace(/\W+/g, '_')}${ext}`
  )
  if (!isValidFile(out)) await download(pick.url, out, signal)
  updateScene(scene.id, { asset_type: pick.kind, asset_path: out, asset_source: pick.source })
  return true
}

/** Free VRAM held by Ollama and Whisper, then make sure ComfyUI is up. */
export async function prepareComfy(s: Settings, signal?: AbortSignal): Promise<void> {
  await unloadAll(s.ollamaUrl)
  await pythonPost('/unload', {}).catch(() => undefined)
  await ensureComfy(s, signal)
}

export async function assignAi(
  scene: Scene,
  dir: string,
  s: Settings,
  signal?: AbortSignal
): Promise<void> {
  const prompt = scene.image_prompt || scene.visual_keywords || scene.narration
  const out = join(dir, `scene_${String(scene.index).padStart(3, '0')}_ai_${Date.now()}.png`)
  await generateImage(prompt, out, s, { signal })
  updateScene(scene.id, { asset_type: 'ai_image', asset_path: out, asset_source: 'comfyui' })
}

export const scenesStep: Step = {
  type: 'scenes',
  status: 'SCENES',
  async run(videoId, ctx) {
    const s = ctx.settings
    const dir = join(ctx.projectDir, 'scenes')
    mkdirSync(dir, { recursive: true })
    const scenes = listScenes(videoId)
    const wantAi = aiIndexes(scenes.length, s.aiImageRatio)
    const needAi: Scene[] = []
    let stock = 0
    let kept = 0
    if (!s.pexelsApiKey) ctx.log('Sem chave da Pexels: todas as cenas usarão imagens IA', 'warn')

    for (const [i, scene] of scenes.entries()) {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      if (scene.locked || isValidFile(scene.asset_path)) {
        kept++
        continue
      }
      if (wantAi.has(i) || !s.pexelsApiKey) {
        needAi.push(scene)
        continue
      }
      try {
        if (await assignStock(scene, dir, s, [], ctx.signal)) stock++
        else needAi.push(scene)
      } catch (error) {
        ctx.log(`Pexels falhou na cena ${scene.index + 1}: ${(error as Error).message}`, 'warn')
        needAi.push(scene)
      }
      ctx.progress((0.3 * (i + 1)) / scenes.length)
    }
    ctx.log(`Cenas: ${stock} de banco, ${needAi.length} para IA, ${kept} já prontas`)

    if (needAi.length) {
      await prepareComfy(s, ctx.signal)
      try {
        // All images of this video in one batch, so the model loads once.
        for (const [k, scene] of needAi.entries()) {
          if (ctx.signal.aborted) throw new Error('Cancelado')
          await assignAi(getScene(scene.id), dir, s, ctx.signal)
          ctx.progress(0.3 + (0.7 * (k + 1)) / needAi.length)
        }
      } finally {
        await freeComfy(s.comfyUrl)
      }
    }
    const missing = listScenes(videoId).filter((sc) => !isValidFile(sc.asset_path))
    if (missing.length) throw new Error(`${missing.length} cena(s) sem imagem ou vídeo`)
    ctx.progress(1)
  }
}

/** "Escolher arquivo do PC": copy into the project and lock the scene. */
export function useLocalFile(sceneId: number, file: string, projectDir: string): Scene {
  const scene = getScene(sceneId)
  const ext = extname(file).toLowerCase()
  const isVideo = ['.mp4', '.mov', '.webm', '.mkv'].includes(ext)
  const out = join(
    projectDir,
    'scenes',
    `scene_${String(scene.index).padStart(3, '0')}_local_${Date.now()}${ext}`
  )
  mkdirSync(join(projectDir, 'scenes'), { recursive: true })
  copyFileSync(file, out)
  return updateScene(sceneId, {
    asset_type: isVideo ? 'stock_video' : 'stock_photo',
    asset_path: out,
    asset_source: `local:${file}`,
    locked: true
  })
}
