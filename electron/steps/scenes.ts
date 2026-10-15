import { copyFileSync, mkdirSync, renameSync, rmSync } from 'fs'
import { extname, join } from 'path'
import type { Scene, Settings } from '../../shared/types'
import { z } from 'zod'
import { getScene, getVideo, listScenes, updateScene, updateVideo } from '../db/repo'
import { generateStructured } from '../services/llm'
import { polishSettings } from './polish'
import { ensureComfy, freeComfy, generateImage } from '../services/comfy'
import { isValidFile, probeDuration, runTool } from '../services/ffmpeg'
import { unloadAll } from '../services/ollama'
import {
  fetchCandidate,
  gatherCandidates,
  PROVIDER_LABELS,
  searchReal,
  usableProviders
} from '../services/stock'
import type { StockCandidate } from '../services/pexels'
import { fillRealSubjects, pickRelevant } from './relevance'
import { pythonPost } from '../services/python'
import type { Step, StepContext } from './types'
import { videoEvidence } from './evidence'
import { formatOf } from '../../shared/formats'
import { scanAd } from '../services/adscan'
import { credit } from '../services/chroniclingamerica'

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
  const out = await downloadTo(pick, scene, dir, sceneDuration(scene), signal)
  updateScene(scene.id, {
    asset_type: pick.kind,
    asset_path: out,
    asset_source: pick.source,
    asset_credit: pick.credit ?? null
  })
}

/** Download a pick into the scenes folder (cached by source), trimming long clips. */
async function downloadTo(
  pick: StockCandidate,
  scene: Scene,
  dir: string,
  sec: number,
  signal?: AbortSignal
): Promise<string> {
  const ext = pick.kind === 'stock_video' ? '.mp4' : '.jpg'
  const out = join(
    dir,
    `scene_${String(scene.index).padStart(3, '0')}_${pick.source.replace(/\W+/g, '_')}${ext}`
  )
  if (!isValidFile(out)) {
    await fetchCandidate(pick, out, signal)
    if (pick.kind === 'stock_video') await trimLongClip(out, sec, signal)
  }
  return out
}

/** Opening seconds with fast cuts: a new image every ~4 s, then every ~7 s. */
export const FAST_CUTS_SEC = 45

/** How many images a scene shows one after another (its main one included). */
export function shotCount(start: number, end: number): number {
  const cadence = start < FAST_CUTS_SEC ? 4 : 7
  return Math.max(1, Math.min(4, Math.round((end - start) / cadence)))
}

/**
 * Extra shots for scenes long enough to need more than one image: more results of the same
 * search first, AI variations of the scene's prompt when the banks have nothing left.
 */
async function fillSubShots(videoId: number, dir: string, ctx: StepContext): Promise<void> {
  const s = ctx.settings
  const used = usedSources(videoId)
  for (const sc of listScenes(videoId)) sc.extra_assets.forEach((x) => used.add(x.source))
  const ai: { scene: Scene; prompt: string }[] = []
  let added = 0
  for (const scene of listScenes(videoId)) {
    if (ctx.signal.aborted) throw new Error('Cancelado')
    if (scene.start_sec === null || scene.end_sec === null || scene.locked) continue
    const want = shotCount(scene.start_sec, scene.end_sec) - 1 - scene.extra_assets.length
    if (want <= 0) continue
    const extra = [...scene.extra_assets]
    if (scene.asset_type !== 'ai_image') {
      try {
        const found = await sceneCandidates(scene, s, used, undefined, ctx.signal)
        for (const pick of found) {
          if (extra.length - scene.extra_assets.length >= want) break
          if (used.has(pick.source)) continue
          const path = await downloadTo(pick, scene, dir, sceneDuration(scene), ctx.signal)
          used.add(pick.source)
          extra.push({ type: pick.kind, path, source: pick.source, credit: pick.credit ?? null })
        }
      } catch (error) {
        if (ctx.signal.aborted) throw error
      }
    }
    // AI only imitates generic subjects: a real person or event never gets a made-up shot.
    const missing = scene.real_subject ? 0 : want - (extra.length - scene.extra_assets.length)
    const variations = ['close-up detail', 'wide establishing shot', 'different angle']
    for (let k = 0; k < missing; k++) {
      ai.push({
        scene,
        prompt: aiPrompt(
          s,
          `${scene.image_prompt || scene.visual_keywords || scene.narration}, ${variations[k % 3]}`
        )
      })
    }
    if (extra.length > scene.extra_assets.length) {
      added += extra.length - scene.extra_assets.length
      updateScene(scene.id, { extra_assets: extra })
    }
  }
  if (ai.length) {
    await prepareComfy(s, ctx.signal)
    try {
      for (const { scene, prompt } of ai) {
        if (ctx.signal.aborted) throw new Error('Cancelado')
        const path = join(
          dir,
          `scene_${String(scene.index).padStart(3, '0')}_shot_${Date.now()}.png`
        )
        try {
          await generateImage(prompt, path, s, { signal: ctx.signal })
          const fresh = getScene(scene.id)
          updateScene(scene.id, {
            extra_assets: [
              ...fresh.extra_assets,
              { type: 'ai_image', path, source: 'comfyui', credit: null }
            ]
          })
          added++
        } catch (error) {
          if (ctx.signal.aborted) throw error
          ctx.log(
            `Plano extra da cena ${scene.index + 1} falhou: ${(error as Error).message}`,
            'warn'
          )
        }
      }
    } finally {
      await freeComfy(s.comfyUrl)
    }
  }
  if (added) ctx.log(`Planos extras: ${added} (cortes a cada ~4 s no início, ~7 s depois)`)
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

const realisticSchema = z.object({
  scenes: z.array(z.object({ scene: z.number().int(), realistic: z.boolean() }))
})

/**
 * Which AI images would need YouTube's synthetic-content label: a photorealistic picture of a
 * real, identifiable person, or one a viewer could take for a real event. Generic objects,
 * places, textures and abstract backgrounds do not. When the check fails, a scene about a
 * named real subject counts as realistic (the safe side).
 */
export async function markRealistic(
  scenes: Scene[],
  s: Settings,
  signal?: AbortSignal
): Promise<Map<number, boolean>> {
  const out = new Map(scenes.map((sc) => [sc.id, !!sc.real_subject]))
  if (!scenes.length) return out
  try {
    const { scenes: marks } = await generateStructured(
      `These prompts become photorealistic AI images in a documentary video. For each, answer realistic=true when the image would show a real, identifiable person, or could be mistaken for a real photo or footage of a real event. Answer false for generic objects, products, places, landscapes, textures, abstract or atmospheric backgrounds and anonymous people.
${scenes.map((sc, i) => `${i + 1}. ${sc.image_prompt || sc.visual_keywords} (narration: ${sc.narration.slice(0, 160)})`).join('\n')}
Return ONLY JSON: {"scenes": [{"scene": 1, "realistic": false}, ...]}`,
      realisticSchema,
      { settings: polishSettings(s), signal, temperature: 0 }
    )
    for (const m of marks) {
      const sc = scenes[m.scene - 1]
      if (sc) out.set(sc.id, m.realistic)
    }
  } catch (error) {
    if (signal?.aborted) throw error
  }
  return out
}

/**
 * Turn the synthetic-content label on when an AI image in the video looks real, with the
 * reason shown in the final review. Off otherwise (narration, scans, generic images).
 */
export function updateSyntheticLabel(videoId: number): void {
  const real = listScenes(videoId).filter((sc) => sc.asset_type === 'ai_image' && sc.realistic)
  updateVideo(videoId, {
    synthetic_content: real.length > 0,
    synthetic_reason: real.length
      ? `${real.length} imagem(ns) de IA fotorrealista(s) que mostram pessoa real ou parecem evento real (cenas ${real.map((sc) => sc.index + 1).join(', ')}).`
      : null
  })
}

export async function assignAi(
  scene: Scene,
  dir: string,
  s: Settings,
  signal?: AbortSignal,
  realistic?: boolean
): Promise<void> {
  const prompt = aiPrompt(s, scene.image_prompt || scene.visual_keywords || scene.narration)
  const out = join(dir, `scene_${String(scene.index).padStart(3, '0')}_ai_${Date.now()}.png`)
  await generateImage(prompt, out, s, { signal })
  updateScene(scene.id, {
    asset_type: 'ai_image',
    asset_path: out,
    asset_source: 'comfyui',
    asset_credit: null,
    // Abstract textures of public-domain formats never look like a real person or event.
    realistic: formatOf(s.format).maxMediaYear ? false : (realistic ?? !!scene.real_subject)
  })
  updateSyntheticLabel(scene.video_id)
}

export const scenesStep: Step = {
  type: 'scenes',
  status: 'SCENES',
  async run(videoId, ctx) {
    const s = ctx.settings
    const dir = join(ctx.projectDir, 'scenes')
    mkdirSync(dir, { recursive: true })
    let scenes = listScenes(videoId)
    const subject = getVideo(videoId).script?.companies?.[0]?.name ?? ''
    if (!scenes.some((sc) => sc.real_subject)) {
      try {
        const found = await fillRealSubjects(scenes, getVideo(videoId).topic, s, ctx.signal)
        found.forEach((real_subject, id) => updateScene(id, { real_subject }))
        if (found.size) ctx.log(`Fotos reais: ${found.size} cena(s) citam pessoas ou eventos reais`)
        scenes = listScenes(videoId)
      } catch (error) {
        ctx.log(`Não deu para marcar as cenas reais: ${(error as Error).message}`, 'warn')
      }
    }
    // A topic born from a real ad opens on that ad's scan, cropped from its newspaper page.
    const ev = videoEvidence(videoId)
    const hook = scenes[0]
    if (ev && hook && !hook.locked && !isValidFile(hook.asset_path)) {
      try {
        const out = join(dir, `scene_000_loc_${ev.page.id.replace(/\W+/g, '_')}.jpg`)
        if (!isValidFile(out)) await scanAd(ev.page, ev.phrase, out, ctx.signal)
        updateScene(hook.id, {
          asset_type: 'stock_photo',
          asset_path: out,
          asset_source: `loc:${ev.page.id}`,
          asset_credit: credit(ev.page)
        })
        scenes = listScenes(videoId)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        ctx.log(`Scan do anúncio indisponível: ${(error as Error).message}`, 'warn')
      }
    }
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
      const realistic = await markRealistic(needAi, s, ctx.signal)
      const real = needAi.filter((sc) => realistic.get(sc.id)).length
      if (real) ctx.log(`${real} imagem(ns) de IA parecem reais: selo de conteúdo sintético ligado`)
      await prepareComfy(s, ctx.signal)
      try {
        // All images of this video in one batch, so the model loads once.
        for (const [k, scene] of needAi.entries()) {
          if (ctx.signal.aborted) throw new Error('Cancelado')
          await assignAi(getScene(scene.id), dir, s, ctx.signal, realistic.get(scene.id))
          ctx.progress(0.3 + (0.7 * (k + 1)) / needAi.length)
        }
      } finally {
        await freeComfy(s.comfyUrl)
      }
    }
    const missing = listScenes(videoId).filter((sc) => !isValidFile(sc.asset_path))
    if (missing.length) throw new Error(`${missing.length} cena(s) sem imagem ou vídeo`)
    await fillSubShots(videoId, dir, ctx)
    updateSyntheticLabel(videoId)
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

/**
 * Public-domain formats never let AI imitate an ad, a person or an event: their AI images
 * are abstract transitions (paper, ink, texture) only.
 */
export function aiPrompt(s: Settings, prompt: string): string {
  if (!formatOf(s.format).maxMediaYear) return prompt
  return 'aged newspaper paper texture, ink smudges, halftone dots, abstract vintage background, warm sepia light, no text, no letters, no people, no faces'
}
