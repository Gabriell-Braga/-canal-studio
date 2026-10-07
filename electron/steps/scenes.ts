import { copyFileSync, mkdirSync, renameSync, rmSync } from 'fs'
import { extname, join } from 'path'
import type { Scene, Settings } from '../../shared/types'
import { getScene, getVideo, listScenes, updateScene } from '../db/repo'
import { ensureComfy, freeComfy, generateImage } from '../services/comfy'
import { isValidFile, probeDuration, runTool } from '../services/ffmpeg'
import { unloadAll } from '../services/ollama'
import { download } from '../services/pexels'
import { gatherCandidates, PROVIDER_LABELS, searchReal, usableProviders } from '../services/stock'
import type { StockCandidate } from '../services/pexels'
import { pickRelevant } from './relevance'
import { pythonPost } from '../services/python'
import type { Step } from './types'

/** Hook and first scene: real photos or footage, never AI images, when a bank has anything. */
const REAL_OPENING = 2

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

/** Try the stock providers for one scene. Returns false when nothing usable was found. */
export async function assignStock(
  scene: Scene,
  dir: string,
  s: Settings,
  extraExclude: string[] = [],
  signal?: AbortSignal,
  onWarn?: (message: string) => void
): Promise<boolean> {
  if (!usableProviders(s).length && !scene.real_subject) return false
  const exclude = usedSources(scene.video_id, scene.id)
  extraExclude.forEach((e) => exclude.add(e))
  const candidates = await sceneCandidates(scene, s, exclude, onWarn, signal)
  const topic = getVideo(scene.video_id).topic
  const pick = (
    await pickRelevant([scene], new Map([[scene.id, candidates]]), topic, s, signal)
  ).get(scene.id)
  if (!pick) return false
  await downloadCandidate(scene, pick, dir, signal)
  return true
}

/** Search query for a scene: its visual keywords, else the first words of the narration. */
function sceneQuery(scene: Scene): string {
  return scene.visual_keywords || scene.narration.split(/\s+/).slice(0, 4).join(' ')
}

/** Real photos of the named person or event first, then the stock banks. */
async function sceneCandidates(
  scene: Scene,
  s: Settings,
  exclude: Set<string>,
  onWarn?: (message: string) => void,
  signal?: AbortSignal
): Promise<StockCandidate[]> {
  const real = await searchReal(scene.real_subject, s, exclude, onWarn, signal)
  const stock = await gatherCandidates(
    sceneQuery(scene),
    sceneDuration(scene),
    s,
    exclude,
    4,
    onWarn,
    signal
  )
  return [...real.slice(0, 6), ...stock]
}

async function downloadCandidate(
  scene: Scene,
  pick: StockCandidate,
  dir: string,
  signal?: AbortSignal
): Promise<void> {
  const ext = pick.kind === 'stock_video' ? '.mp4' : '.jpg'
  const out = join(
    dir,
    `scene_${String(scene.index).padStart(3, '0')}_${pick.source.replace(/\W+/g, '_')}${ext}`
  )
  if (!isValidFile(out)) {
    await download(pick.url, out, signal)
    if (pick.kind === 'stock_video') await trimLongClip(out, sceneDuration(scene), signal)
  }
  updateScene(scene.id, {
    asset_type: pick.kind,
    asset_path: out,
    asset_source: pick.source,
    asset_credit: pick.credit ?? null
  })
}

/**
 * Archive films and NASA videos run for minutes and often open with title cards. Keep only
 * a stretch from the middle (scene length + margin), re-encoded to 1080p-friendly H.264.
 */
async function trimLongClip(file: string, sceneSec: number, signal?: AbortSignal): Promise<void> {
  const total = await probeDuration(file)
  const keep = Math.min(total, sceneSec + 4)
  if (total <= Math.max(60, keep * 3)) return
  const start = Math.min(total * 0.25, total - keep)
  const tmp = file.replace(/\.mp4$/i, '.cut.mp4')
  await runTool(
    'ffmpeg',
    [
      '-y',
      '-ss',
      start.toFixed(2),
      '-i',
      file,
      '-t',
      keep.toFixed(2),
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      tmp
    ],
    signal
  )
  rmSync(file, { force: true })
  renameSync(tmp, file)
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
  updateScene(scene.id, {
    asset_type: 'ai_image',
    asset_path: out,
    asset_source: 'comfyui',
    asset_credit: null
  })
}

export const scenesStep: Step = {
  type: 'scenes',
  status: 'SCENES',
  async run(videoId, ctx) {
    const s = ctx.settings
    const dir = join(ctx.projectDir, 'scenes')
    mkdirSync(dir, { recursive: true })
    const scenes = listScenes(videoId)
    const subject = getVideo(videoId).script?.companies?.[0]?.name ?? ''
    const wantAi = aiIndexes(scenes.length, s.aiImageRatio)
    const needAi: Scene[] = []
    const wantStock: Scene[] = []
    const candidates = new Map<number, StockCandidate[]>()
    const used = usedSources(videoId)
    let stock = 0
    let kept = 0
    const providers = usableProviders(s)
    if (!providers.length)
      ctx.log('Nenhum banco de imagens ativo: todas as cenas usarão IA', 'warn')
    else ctx.log(`Bancos de mídia: ${providers.map((p) => PROVIDER_LABELS[p]).join(' → ')}`)

    for (const [i, scene] of scenes.entries()) {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      if (scene.locked || isValidFile(scene.asset_path)) {
        kept++
        continue
      }
      // The opening scenes always use real media: the first thing on screen sets the tone.
      // A scene about a real person or event tries a real photo first, even in an AI slot.
      const real = !!scene.real_subject
      if ((wantAi.has(i) && i >= REAL_OPENING && !real) || (!providers.length && !real)) {
        needAi.push(scene)
        continue
      }
      try {
        let found = await sceneCandidates(scene, s, used, (m) => ctx.log(m, 'warn'), ctx.signal)
        if (!found.length && i < REAL_OPENING && subject) {
          found = await gatherCandidates(
            subject,
            sceneDuration(scene),
            s,
            used,
            4,
            undefined,
            ctx.signal
          )
        }
        if (found.length) {
          candidates.set(scene.id, found)
          wantStock.push(scene)
        } else needAi.push(scene)
      } catch (error) {
        ctx.log(`Busca falhou na cena ${scene.index + 1}: ${(error as Error).message}`, 'warn')
        needAi.push(scene)
      }
      ctx.progress((0.15 * (i + 1)) / scenes.length)
    }

    if (wantStock.length) {
      ctx.log(`Escolhendo a mídia mais relevante para ${wantStock.length} cena(s)`)
      const topic = getVideo(videoId).topic
      const picks = await pickRelevant(wantStock, candidates, topic, s, ctx.signal, (m) =>
        ctx.log(m, 'warn')
      )
      for (const [k, scene] of wantStock.entries()) {
        // An opening scene keeps the best search hit rather than falling back to an AI image.
        const pick =
          picks.get(scene.id) ??
          (scene.index < REAL_OPENING
            ? candidates.get(scene.id)?.find((c) => !used.has(c.source))
            : undefined)
        // No fitting option, or the same file already chosen for another scene.
        if (!pick || used.has(pick.source)) {
          needAi.push(scene)
          continue
        }
        try {
          await downloadCandidate(scene, pick, dir, ctx.signal)
          used.add(pick.source)
          stock++
        } catch (error) {
          ctx.log(`Download falhou na cena ${scene.index + 1}: ${(error as Error).message}`, 'warn')
          needAi.push(scene)
        }
        ctx.progress(0.15 + (0.15 * (k + 1)) / wantStock.length)
      }
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
