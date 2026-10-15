import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { z } from 'zod'
import type { AssetType, Scene, Settings } from '../../shared/types'
import { maxStillSec, shotDurations } from '../../shared/shots'
import { adSceneData } from '../../shared/formats/vintage-ads'
import { getVideo, listScenes, updateScene, updateVideo } from '../db/repo'
import { setState } from '../db/settings'
import { enhanceScan, scanAd } from '../services/adscan'
import { credit } from '../services/chroniclingamerica'
import { freeComfy } from '../services/comfy'
import { isValidFile, runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import type { StockCandidate } from '../services/pexels'
import { fetchCandidate, searchReal } from '../services/stock'
import { gatherAds, videoEvidence, type Evidence } from './evidence'
import { polishSettings } from './polish'
import { readTimings } from './audio'
import { MEDIA_KINDS, visualCheck, type MediaKind, type VisualVerdict } from './relevance'
import { prepareComfy, sceneCandidates } from './scenes'
import type { StepContext } from './types'

/** The same file appears at most this many times in a video. */
export const MAX_USES = 3

/** One usable picture of the video. */
export interface MediaItem {
  file: string
  kind: MediaKind
  type: AssetType
  source: string
  credit: string | null
  /** The investigated ad: its scan carries the highlighted quote */
  main?: boolean
}

export interface PlanScene {
  index: number
  start: number
  end: number
  /** Seconds the first image holds (the scan while the period announcer reads) */
  hold: number
  /** Opens on an ad scan */
  scan: boolean
  /** Opens on the investigated ad (hook and Claim Check scenes): its quote is highlighted */
  mainAd: boolean
  /** Pictures the visual check approved for this scene */
  ok: MediaItem[]
}

export interface Library {
  /** Real ads of the product, the investigated one first */
  ads: MediaItem[]
  /** Real period photos of the story (product, people, places), approved for the video */
  photos: MediaItem[]
}

const rank = (k: MediaKind): number => MEDIA_KINDS.indexOf(k)

/**
 * Which pictures each scene shows, in order (first = main asset). Each scene gets one image
 * per slot of its cadence (shared/shots), by priority: ads, the real product, the real
 * person, places, period engravings, never a random object. When a scene runs out:
 * another ad of the product, a period photo of the story, then the best media of the video
 * again (another framing). No file goes past MAX_USES while something else is left, and no
 * scene ever ends up empty. In the first minute the ad, the product and the face all show.
 */
export function planShots(scenes: PlanScene[], lib: Library): Map<number, MediaItem[]> {
  const uses = new Map<string, number>()
  const used = (m: MediaItem): number => uses.get(m.file) ?? 0
  const free = (m: MediaItem): boolean => used(m) < MAX_USES
  const best = (list: MediaItem[]): MediaItem[] =>
    [...list].sort((a, b) => used(a) - used(b) || rank(a.kind) - rank(b.kind))
  // The first minute must show the real product and the real face.
  const early = [
    lib.photos.find((p) => p.kind === 'product'),
    lib.photos.find((p) => p.kind === 'portrait')
  ].filter((m): m is MediaItem => !!m)
  const everything = [...lib.ads, ...lib.photos]
  const out = new Map<number, MediaItem[]>()

  for (const sc of scenes) {
    const need = shotDurations(sc.start, sc.end, sc.hold).length
    const list: MediaItem[] = []
    const take = (m: MediaItem | undefined): boolean => {
      if (!m || list.length >= need || list.includes(m) || !free(m)) return false
      list.push(m)
      uses.set(m.file, used(m) + 1)
      return true
    }
    if (sc.scan) {
      const main = lib.ads.find((a) => a.main)
      if (!(sc.mainAd && take(main))) take(best(lib.ads.filter((a) => !a.main))[0] ?? main)
    }
    if (sc.start < 60) for (const m of early) if (!used(m)) take(m)
    for (const m of best(sc.ok)) take(m)
    for (const m of best(lib.ads)) take(m)
    for (const m of best(lib.photos)) take(m)
    // Last resort: the best pictures of the video again, as a new framing.
    for (const m of best(everything)) take(m)
    if (!list.length && everything.length) {
      // Never an empty scene: the least used picture even past the limit.
      const m = best(everything)[0]
      list.push(m)
      uses.set(m.file, used(m) + 1)
    }
    out.set(sc.index, list)
  }
  return out
}

/** Longest any image stays up when a scene splits its time across `count` images. */
export function longestStill(sc: Pick<PlanScene, 'start' | 'end' | 'hold'>, count: number): number {
  const d = shotDurations(sc.start, sc.end, sc.hold)
  if (count >= d.length) return Math.max(...d.slice(sc.hold > 0 ? 1 : 0), 0)
  return (sc.end - sc.start - (sc.hold > 0 ? d[0] : 0)) / Math.max(1, count - (sc.hold > 0 ? 1 : 0))
}

// ---------------------------------------------------------------- building the library

const subjectsSchema = z.object({
  product: z.string(),
  person: z.string(),
  places: z.array(z.string()).max(3)
})

/** The story's product, main person and places, as Commons search terms. */
async function storySubjects(
  topic: string,
  story: string,
  s: Settings,
  signal?: AbortSignal
): Promise<z.infer<typeof subjectsSchema>> {
  return generateStructured(
    `A documentary investigates an old ad: "${topic}". Story excerpt: ${story.slice(0, 2500)}
Give Wikimedia Commons search terms for real period pictures:
- product: the product as named on its bottle or box, e.g. "Lydia Pinkham's Vegetable Compound"
- person: the real person at the center of the story (maker, founder, seller), full name, or "" (never a customer from a testimonial)
- places: up to 3 places of the story (factory, town), e.g. ["Lydia E. Pinkham Medicine Company Lynn", "Lynn Massachusetts 1900"]
Return ONLY JSON: {"product": "...", "person": "...", "places": ["..."]}`,
    subjectsSchema,
    { settings: polishSettings(s), signal, temperature: 0, effort: 'low' }
  )
}

/** Small JPEG for the visual check (cheap to send, same picture). */
async function preview(file: string, dir: string, signal?: AbortSignal): Promise<string> {
  const out = join(dir, `${basename(file).replace(/\.\w+$/, '')}.jpg`)
  if (!isValidFile(out))
    await runTool(
      'ffmpeg',
      ['-y', '-i', file, '-vf', "scale='min(768,iw)':-2", '-frames:v', '1', '-q:v', '4', out],
      signal
    )
  return out
}

/** Download a candidate into the scenes folder once, named by its source. */
async function fetchOnce(pick: StockCandidate, dir: string, signal?: AbortSignal): Promise<string> {
  const out = join(dir, `lib_${pick.source.replace(/\W+/g, '_').slice(0, 80)}.jpg`)
  if (!isValidFile(out)) await fetchCandidate(pick, out, signal)
  return out
}

type VisionCache = Record<string, VisualVerdict>

const vkey = (narration: string, file: string): string =>
  createHash('sha1')
    .update(`${narration}|${basename(file)}`)
    .digest('hex')
    .slice(0, 16)

/**
 * Ads on Trial scenes: every picture is real (ads of the product, the product, the people,
 * the places), checked by eye against the narration, planned shot by shot. No AI images:
 * in this format they could only be paper texture, which reads as an empty screen.
 */
export async function vintageScenes(videoId: number, ctx: StepContext): Promise<void> {
  const s = ctx.settings
  const dir = join(ctx.projectDir, 'scenes')
  const vdir = join(dir, 'vision')
  mkdirSync(vdir, { recursive: true })
  const video = getVideo(videoId)
  const script = video.script
  const scenes = listScenes(videoId)
  const log = (m: string, level?: 'info' | 'warn'): void => ctx.log(m, level)

  // 1. Real ads of the product, cropped from their pages and made sharp.
  const main = videoEvidence(videoId)
  let ads: Evidence[] = main ? [main] : []
  try {
    if (main) ads = await gatherAds(video, s, ctx.signal, log)
  } catch (error) {
    if (ctx.signal.aborted) throw error
    log(`Busca de outros anúncios falhou: ${(error as Error).message}`, 'warn')
  }
  const adItems: MediaItem[] = []
  for (const [k, ad] of ads.entries()) {
    const out = join(dir, `ad_${k}_${ad.page.id.replace(/\W+/g, '_').slice(0, 60)}.jpg`)
    try {
      if (!isValidFile(out)) await scanAd(ad.page, ad.phrase, out, ctx.signal)
      adItems.push({
        file: out,
        kind: 'ad',
        type: 'stock_photo',
        source: `loc:${ad.page.id}`,
        credit: credit(ad.page),
        main: k === 0
      })
    } catch (error) {
      if (ctx.signal.aborted) throw error
      log(`Scan do anúncio ${ad.page.newspaper} indisponível: ${(error as Error).message}`, 'warn')
    }
  }
  ctx.progress(0.1)
  await prepareComfy(s, ctx.signal).catch(() => undefined)
  try {
    for (const a of adItems) {
      const h = await enhanceScan(a.file, s, { comfy: true, signal: ctx.signal })
      log(`Scan ${basename(a.file)}: ${h} px de altura`)
    }
  } finally {
    await freeComfy(s.comfyUrl)
  }
  ctx.progress(0.2)

  // 2. Real period photos of the story: the product, its maker, the places.
  const story = [script?.hook, ...scenes.map((sc) => sc.narration)].join(' ')
  const subjects = await storySubjects(video.topic, story, s, ctx.signal).catch((error) => {
    if (ctx.signal.aborted) throw error
    return { product: '', person: '', places: [] as string[] }
  })
  const libQueries: { q: string; kind: MediaKind }[] = [
    ...(subjects.product
      ? [
          { q: `${subjects.product} bottle`, kind: 'product' as const },
          { q: subjects.product, kind: 'product' as const }
        ]
      : []),
    ...(subjects.person ? [{ q: subjects.person, kind: 'portrait' as const }] : []),
    ...subjects.places.map((q) => ({ q, kind: 'place' as const }))
  ]
  const exclude = new Set<string>(adItems.map((a) => a.source))
  const libCandidates: { pick: StockCandidate; kind: MediaKind }[] = []
  for (const { q, kind } of libQueries) {
    const found = await searchReal(q, s, exclude, (m) => log(m, 'warn'), ctx.signal)
    for (const pick of found.filter((c) => c.kind === 'stock_photo').slice(0, 4)) {
      exclude.add(pick.source)
      libCandidates.push({ pick, kind })
    }
  }

  // 3. Candidates of each scene: its real subject first, then the format's banks.
  const perScene = new Map<number, StockCandidate[]>()
  for (const sc of scenes) {
    if (ctx.signal.aborted) throw new Error('Cancelado')
    if (sc.locked) continue
    try {
      const found = await sceneCandidates(sc, s, exclude, undefined, ctx.signal)
      const photos = found.filter((c) => c.kind === 'stock_photo' && !c.loc).slice(0, 6)
      photos.forEach((c) => exclude.add(c.source))
      perScene.set(sc.index, photos)
    } catch (error) {
      if (ctx.signal.aborted) throw error
      log(`Busca falhou na cena ${sc.index + 1}: ${(error as Error).message}`, 'warn')
    }
  }
  ctx.progress(0.35)

  // 4. Download everything once.
  const files = new Map<string, string>()
  const all = [...libCandidates.map((c) => c.pick), ...[...perScene.values()].flat()]
  for (const pick of all) {
    if (files.has(pick.source)) continue
    try {
      files.set(pick.source, await fetchOnce(pick, dir, ctx.signal))
    } catch (error) {
      if (ctx.signal.aborted) throw error
    }
  }
  const item = (pick: StockCandidate, kind: MediaKind): MediaItem | null => {
    const file = files.get(pick.source)
    return file
      ? { file, kind, type: 'stock_photo', source: pick.source, credit: pick.credit ?? null }
      : null
  }
  ctx.progress(0.45)

  // 5. Visual check: does the picture show what the narration says? Only "yes" is used.
  const cacheFile = join(vdir, 'checks.json')
  const cache: VisionCache = existsSync(cacheFile)
    ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as VisionCache)
    : {}
  const rejected: { scene: number; file: string; reason: string }[] = []
  const check = async (
    narration: string,
    items: MediaItem[],
    scene: number
  ): Promise<MediaItem[]> => {
    const todo = items.filter((m) => !cache[vkey(narration, m.file)])
    for (let i = 0; i < todo.length; i += 8) {
      const batch = todo.slice(i, i + 8)
      try {
        const previews = await Promise.all(batch.map((m) => preview(m.file, vdir, ctx.signal)))
        const verdicts = await visualCheck(
          narration,
          previews,
          video.topic,
          polishSettings(s),
          ctx.signal
        )
        batch.forEach((m, k) => (cache[vkey(narration, m.file)] = verdicts[k]))
        writeFileSync(cacheFile, JSON.stringify(cache, null, 2))
      } catch (error) {
        if (ctx.signal.aborted) throw error
        log(`Checagem visual falhou: ${(error as Error).message}`, 'warn')
      }
    }
    const ok: MediaItem[] = []
    for (const m of items) {
      const v = cache[vkey(narration, m.file)]
      if (v?.ok) ok.push({ ...m, kind: m.kind === 'other' ? v.kind : m.kind })
      else
        rejected.push({
          scene,
          file: m.file,
          reason: v
            ? `não mostra o que a narração diz (${v.what || 'sem descrição'})`
            : 'sem checagem visual'
        })
    }
    return ok
  }
  // The story's own photos, checked once against the story.
  const photos = await check(
    `${video.topic}. ${subjects.person} ${subjects.product}`,
    libCandidates.map((c) => item(c.pick, c.kind)).filter((m): m is MediaItem => !!m),
    -1
  )
  const plan: PlanScene[] = []
  const periods =
    (readTimings(ctx.projectDir) as { periods?: { sceneId: number; end: number }[] } | null)
      ?.periods ?? []
  const claimScenes = new Set(
    (Array.isArray(script?.claims) ? (script.claims as { scene?: number }[]) : []).map((c) =>
      Number(c.scene)
    )
  )
  for (const [k, sc] of scenes.entries()) {
    if (ctx.signal.aborted) throw new Error('Cancelado')
    if (sc.locked || sc.start_sec === null || sc.end_sec === null) continue
    const own = (perScene.get(sc.index) ?? [])
      .map((p) => item(p, 'other'))
      .filter((m): m is MediaItem => !!m)
    const ok = await check(sc.narration, [...own, ...photos], sc.index)
    const data = adSceneData(script ?? null, sc.index)
    const period = periods.find((p) => p.sceneId === sc.id)
    plan.push({
      index: sc.index,
      start: sc.start_sec,
      end: sc.end_sec,
      hold: period ? period.end - sc.start_sec + 0.3 : 0,
      scan: data.scan && adItems.length > 0,
      mainAd: sc.index === 0 || claimScenes.has(sc.index) || !!data.adQuote,
      ok
    })
    ctx.progress(0.45 + (0.45 * (k + 1)) / scenes.length)
  }
  setState(`relevance.rejected.video.${videoId}`, rejected)
  if (rejected.length) log(`${rejected.length} imagem(ns) reprovada(s) na checagem visual`, 'warn')

  // 6. Shot by shot.
  const shots = planShots(plan, { ads: adItems, photos })
  let short = 0
  for (const p of plan) {
    const list = shots.get(p.index) ?? []
    const sc = scenes.find((x) => x.index === p.index) as Scene
    if (!list.length) continue
    if (longestStill(p, list.length) > maxStillSec(p.start) + 1) short++
    const [first, ...rest] = list
    updateScene(sc.id, {
      asset_type: first.type,
      asset_path: first.file,
      asset_source: first.source,
      asset_credit: first.credit,
      realistic: false,
      extra_assets: rest.map((m) => ({
        type: m.type,
        path: m.file,
        source: m.source,
        credit: m.credit
      }))
    })
  }
  if (short)
    log(`${short} cena(s) com menos imagens que o ritmo pede (ver relatório de revisão)`, 'warn')
  const missing = listScenes(videoId).filter((sc) => !isValidFile(sc.asset_path))
  if (missing.length)
    throw new Error(
      `${missing.length} cena(s) sem mídia real (cenas ${missing.map((m) => m.index + 1).join(', ')}): nenhum anúncio nem foto de época encontrados`
    )
  updateVideo(videoId, { synthetic_content: false, synthetic_reason: null })
  ctx.log(
    `Cenas: ${adItems.length} anúncio(s), ${photos.length} foto(s) de época aprovadas, ${rejected.length} reprovada(s)`
  )
  ctx.progress(1)
}
