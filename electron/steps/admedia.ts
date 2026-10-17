import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { z } from 'zod'
import type { CardProps } from '../../shared/render'
import type { AssetType, Scene, Script, Settings } from '../../shared/types'
import { priceTag } from '../../shared/cpi'
import { eraProblem, lateClue, sceneYears } from '../../shared/era'
import { MIX } from '../../shared/coverage'
import { formatOf } from '../../shared/formats'
import { maxStillSec, shotDurations } from '../../shared/shots'
import { adSceneData } from '../../shared/formats/vintage-ads'
import type { SceneVisual, VisualSpec } from '../../shared/visuals'
import { getVideo, listScenes, updateScene, updateVideo } from '../db/repo'
import { setState } from '../db/settings'
import { enhanceScan, localOcr, scanAd } from '../services/adscan'
import { credit } from '../services/chroniclingamerica'
import { freeComfy } from '../services/comfy'
import { isAssetFile, isValidFile, runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import type { StockCandidate } from '../services/pexels'
import { runRender } from '../services/remotion'
import { fetchCandidate, gatherCandidates, searchReal } from '../services/stock'
import {
  DATA_VISUALS,
  dataSpec,
  detailViews,
  evidenceSpec,
  parallaxView,
  scenePlans,
  shortVariants,
  writeShot,
  type ScenePlan
} from './advisuals'
import { gatherAds, videoEvidence, type Evidence } from './evidence'
import { makeIllustration } from './illustrate'
import { polishSettings } from './polish'
import { readTimings } from './audio'
import {
  byRelevance,
  MEDIA_KINDS,
  visualCheck,
  type MediaKind,
  type Relevance,
  type VisualVerdict
} from './relevance'
import { prepareComfy } from './scenes'
import type { StepContext } from './types'

/** The same file appears at most this many times in a video. */
export const MAX_USES = 3

/** Distinct pictures a video should have before planning its shots. */
export const BANK_MIN = MIX.minBank

/** One usable picture of the video. */
export interface MediaItem {
  file: string
  kind: MediaKind
  type: AssetType
  source: string
  credit: string | null
  /** Year the source dates it to (ads: the paper's date) */
  year?: number
  /** The investigated ad: its scan carries the highlighted quote */
  main?: boolean
  /** How the visual check related it to the scene (literal before context) */
  level?: Relevance
}

export interface PlanScene {
  index: number
  start: number
  end: number
  /** Seconds the first shot holds (the scan while the period announcer reads, or the animation) */
  hold: number
  /** Opens on an ad scan */
  scan: boolean
  /** Opens on the investigated ad (hook and Claim Check scenes): its quote is highlighted */
  mainAd: boolean
  /** Pictures the visual check approved for this scene */
  ok: MediaItem[]
  /** Year the scene is set in (its own or the last one before it) */
  year?: number | null
  narration?: string
  /** Files the checks refused for this scene: never shown in it, not even as a fallback */
  banned?: Set<string>
  /** Shot file of the scene's animation: its first shot, `hold` seconds long */
  anim?: string
}

export interface Library {
  /** Real ads of the product, the investigated one first */
  ads: MediaItem[]
  /** Real period photos of the story (product, people, places), approved for the video */
  photos: MediaItem[]
}

const rank = (k: MediaKind): number => MEDIA_KINDS.indexOf(k)
const levelRank = (l?: Relevance): number => (l === 'context' ? 1 : 0)

/** Images a scene needs at its cadence (shared/shots), its animation included. */
export const slotsOf = (sc: Pick<PlanScene, 'start' | 'end' | 'hold'>): number =>
  shotDurations(sc.start, sc.end, sc.hold).length

/**
 * Which pictures each scene shows, in order (first = main asset; after the animation when the
 * scene has one). Each scene gets one image per slot of its cadence (shared/shots), literal
 * pictures before context ones, then by priority: ads, the real product, the real person,
 * places, period engravings. When a scene runs out: another ad of the product, then a period
 * photo of the story. A file refused for a scene (visual check, period clue) never shows in
 * it, a picture from another era only where the scene talks about it, and no file goes past
 * MAX_USES. In the first minute the ad, the product and the face all show.
 */
export function planShots(scenes: PlanScene[], lib: Library): Map<number, MediaItem[]> {
  const uses = new Map<string, number>()
  const used = (m: MediaItem): number => uses.get(m.file) ?? 0
  const best = (list: MediaItem[]): MediaItem[] =>
    byRelevance(list).sort(
      (a, b) =>
        levelRank(a.level) - levelRank(b.level) || used(a) - used(b) || rank(a.kind) - rank(b.kind)
    )
  // The first minute must show the real product and the real face.
  const early = [
    lib.photos.find((p) => p.kind === 'product'),
    lib.photos.find((p) => p.kind === 'portrait')
  ].filter((m): m is MediaItem => !!m)
  const out = new Map<number, MediaItem[]>()

  for (const sc of scenes) {
    const need = slotsOf(sc) - (sc.anim ? 1 : 0)
    const list: MediaItem[] = []
    const fits = (m: MediaItem): boolean =>
      !sc.banned?.has(m.file) && !eraProblem(m.year, sc.year, sc.narration ?? '')
    const take = (m: MediaItem | undefined, anyEra = false): boolean => {
      if (!m || list.length >= need || list.includes(m) || used(m) >= MAX_USES) return false
      if (sc.banned?.has(m.file) || (!anyEra && !fits(m))) return false
      list.push(m)
      uses.set(m.file, used(m) + 1)
      return true
    }
    // The scan the script asks for is the scene's subject: its own date does not matter.
    if (sc.scan) {
      const main = lib.ads.find((a) => a.main)
      if (!(sc.mainAd && take(main, true)))
        take(best(lib.ads.filter((a) => !a.main && !sc.banned?.has(a.file)))[0] ?? main, true)
    }
    if (sc.start < 60) for (const m of early) if (!used(m)) take(m)
    for (const m of best(sc.ok)) take(m)
    for (const m of best(lib.ads)) take(m)
    for (const m of best(lib.photos)) take(m)
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

// ---------------------------------------------------------------- data cards

/**
 * Text cards only where they add something the narration does not already say: the ad's
 * literal words (with their source), a Claim Check verdict, a key number (price then and
 * now) and "Would It Run Today?" on the closing scene. Never a line of the narration (the
 * captions show it). At most one per scene, never right after another card, and all of them
 * within `budgetSec` (8% of the video).
 */
export function planCards(
  scenes: (Pick<PlanScene, 'index' | 'start' | 'end' | 'hold'> & { missing: number })[],
  script: Script | null,
  budgetSec: number,
  lastIndex: number,
  adSource = 'The ad'
): Map<number, CardProps[]> {
  const claims = Array.isArray(script?.claims)
    ? (script.claims as { scene?: number; quote?: string; verdict?: string; source?: string }[])
    : []
  const verdict = script?.verdict as { law: string; text: string } | null | undefined
  const seen = new Set<string>()
  const out = new Map<number, CardProps[]>()
  let spent = 0
  let previousCard = false
  for (const sc of [...scenes].sort((a, b) => a.start - b.start)) {
    if (sc.missing <= 0) {
      previousCard = false
      continue
    }
    const data = adSceneData(script, sc.index)
    const options: CardProps[] = []
    for (const c of claims.filter((c) => Number(c.scene) === sc.index && c.quote))
      options.push({ kind: 'claim', text: String(c.quote), stamp: c.verdict, sub: c.source })
    if (data.adQuote) options.push({ kind: 'quote', text: data.adQuote, sub: adSource })
    const price = data.price ? priceTag(data.price.usd, data.price.year) : null
    if (price)
      options.push({
        kind: 'price',
        text: `${price.then} in ${data.price?.year}`,
        sub: `≈ ${price.today} today`
      })
    if (sc.index === lastIndex && verdict?.text)
      options.push({
        kind: 'claim',
        text: verdict.text,
        stamp: verdict.law,
        sub: 'Would It Run Today?'
      })
    const card = options.find((o) => !seen.has(`${o.kind}|${o.text}`))
    const slots = shotDurations(sc.start, sc.end, sc.hold)
    const sec = slots[slots.length - 1] ?? sc.end - sc.start
    // A scene with nothing else to show would put its card right after the previous one.
    const alone = sc.missing >= slots.length
    if (!card || spent + sec > budgetSec || (alone && previousCard)) {
      previousCard = false
      continue
    }
    seen.add(`${card.kind}|${card.text}`)
    spent += sec
    out.set(sc.index, [card])
    previousCard = alone
  }
  return out
}

/** Real pictures first, each card after one of them, so the scene alternates. */
export function mergeCards<T>(media: T[], cards: T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(media.length, cards.length); i++) {
    if (media[i]) out.push(media[i])
    if (cards[i]) out.push(cards[i])
  }
  return out
}

/** Render the cards as stills in the scenes folder (once per content) and wrap them as media. */
async function renderCards(
  cards: Map<number, CardProps[]>,
  dir: string,
  ctx: StepContext
): Promise<Map<number, MediaItem[]>> {
  const out = new Map<number, MediaItem[]>()
  const todo: { props: CardProps; out: string; composition: 'Card' }[] = []
  for (const [index, list] of cards) {
    out.set(
      index,
      list.map((props) => {
        const hash = createHash('sha1').update(JSON.stringify(props)).digest('hex').slice(0, 12)
        const file = join(dir, `card_${props.kind}_${hash}.png`)
        if (!isValidFile(file)) todo.push({ props, out: file, composition: 'Card' })
        return {
          file,
          kind: 'other',
          type: 'stock_photo',
          source: `card:${props.kind}`,
          credit: null
        }
      })
    )
  }
  if (todo.length)
    await runRender(
      { mode: 'stills', root: ctx.projectDir, out: '', stills: todo },
      join(ctx.projectDir, 'cards-job.json'),
      { progress: () => undefined, log: (m) => ctx.log(m), signal: ctx.signal }
    )
  return out
}

// ---------------------------------------------------------------- animations

/** Seconds an animation holds (at most its scene's length). */
export const ANIM_SEC: Record<VisualSpec['kind'], number> = {
  map: 9,
  timeline: 8,
  tree: 9,
  label: 8,
  letter: 9,
  counter: 6,
  evidence: 10
}

/** Animations a video draws at most, per kind. */
const ANIM_MAX: Record<VisualSpec['kind'], number> = {
  map: 1,
  timeline: 2,
  tree: 1,
  label: 1,
  letter: 2,
  counter: 1,
  evidence: 3
}

/**
 * Which scenes get an animation, within the 15–25% target: the scenes whose suggested visual
 * is an animation first (in order), then evidence boards (2–3 per video) and timelines for
 * the rest until 15% is reached. Scenes that open on a scan are never used.
 */
export function pickAnimationScenes(
  scenes: { index: number; start: number; end: number; scan: boolean; visual: SceneVisual }[],
  duration: number
): Map<number, VisualSpec['kind']> {
  const out = new Map<number, VisualSpec['kind']>()
  const count = new Map<string, number>()
  let sec = 0
  const kindOf = (v: SceneVisual): VisualSpec['kind'] | null =>
    v === 'evidence' || (DATA_VISUALS as readonly string[]).includes(v)
      ? (v as VisualSpec['kind'])
      : v === 'quote'
        ? 'counter'
        : null
  const add = (sc: (typeof scenes)[number], kind: VisualSpec['kind']): void => {
    const len = Math.min(ANIM_SEC[kind], sc.end - sc.start)
    if (out.has(sc.index) || sc.scan || (count.get(kind) ?? 0) >= ANIM_MAX[kind]) return
    if ((sec + len) / duration > MIX.animation[1]) return
    out.set(sc.index, kind)
    count.set(kind, (count.get(kind) ?? 0) + 1)
    sec += len
  }
  for (const sc of scenes) {
    const kind = kindOf(sc.visual)
    if (kind) add(sc, kind)
  }
  // Under 15%: evidence boards on the scenes that bring proof, then timelines.
  for (const kind of ['evidence', 'timeline', 'evidence', 'letter'] as const)
    for (const sc of scenes) {
      if (sec / duration >= MIX.animation[0] + 0.02) break
      if (!out.has(sc.index) && sc.visual !== 'scan') add(sc, kind)
    }
  return out
}

// ---------------------------------------------------------------- building the library

const subjectsSchema = z.object({
  product: z.string(),
  person: z.string(),
  places: z.array(z.string()).max(3),
  extras: z.array(z.string()).max(6).default([])
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
- extras: up to 6 more period subjects of the story, each a short search: the product's trade card, label or box, the company's headquarters, a period magazine cover or newspaper about it, the law the story cites (e.g. "Pure Food and Drug Act 1906"), other people of the story
Return ONLY JSON: {"product": "...", "person": "...", "places": ["..."], "extras": ["..."]}`,
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
    // v3: the stricter relevance rules (text pages, other people, unrelated plates).
    .update(`v3|${narration}|${basename(file)}`)
    .digest('hex')
    .slice(0, 16)

/** Runs `fn` over `items` with at most `n` at a time, keeping the order of the results. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

/** Real pictures that get a 2.5D move: photos and engravings with a subject, never scans. */
const PARALLAX_KINDS: MediaKind[] = ['product', 'portrait', 'place', 'event']

/**
 * Ads on Trial scenes: real ads and period pictures from every archive (searched by a list
 * of concrete shots per scene, checked by eye at two levels), data animations and evidence
 * boards drawn from the script, detail and parallax framings of the real pictures, engraving
 * illustrations where nothing real exists (≤ 25%), and text cards only where they add
 * something (≤ 8%).
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
  const narrated = scenes.filter((sc) => sc.start_sec !== null && sc.end_sec !== null)
  const duration = Math.max(1, ...narrated.map((sc) => sc.end_sec as number))

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
        year: Number(ad.page.date.slice(0, 4)) || undefined,
        main: k === 0,
        level: 'literal'
      })
    } catch (error) {
      if (ctx.signal.aborted) throw error
      log(`Scan do anúncio ${ad.page.newspaper} indisponível: ${(error as Error).message}`, 'warn')
    }
  }
  ctx.progress(0.05)
  await prepareComfy(s, ctx.signal).catch(() => undefined)
  try {
    for (const a of adItems) {
      const h = await enhanceScan(a.file, s, { comfy: true, signal: ctx.signal })
      log(`Scan ${basename(a.file)}: ${h} px de altura`)
    }
  } finally {
    await freeComfy(s.comfyUrl)
  }
  ctx.progress(0.1)

  // 2. Real period photos of the story, and a list of concrete shots for every scene.
  const story = [script?.hook, ...scenes.map((sc) => sc.narration)].join(' ')
  const subjects = await storySubjects(video.topic, story, s, ctx.signal).catch((error) => {
    if (ctx.signal.aborted) throw error
    return { product: '', person: '', places: [] as string[], extras: [] as string[] }
  })
  const scriptVisual = (index: number): string | undefined =>
    index === 0 ? 'scan' : (script?.scenes[index - 1]?.visual as string | undefined)
  const plans: Map<number, ScenePlan> = await scenePlans(
    narrated.map((sc) => ({
      index: sc.index,
      narration: sc.narration,
      visual: scriptVisual(sc.index)
    })),
    video.topic,
    s,
    ctx.signal
  ).catch((error) => {
    if (ctx.signal.aborted) throw error
    log(`Plano de tomadas falhou: ${(error as Error).message}`, 'warn')
    return new Map<number, ScenePlan>()
  })
  // Every archive of the format except the newspaper pages (their ads come from step 1).
  const pack = formatOf(s.format)
  const archives = {
    ...s,
    stockProviders: [...new Set([...pack.mediaProviders, ...s.stockProviders])].filter(
      (p) => p !== 'loc' && p !== 'pixabay' && p !== 'pexels'
    )
  }
  const exclude = new Set<string>(adItems.map((a) => a.source))
  const libQueries: { q: string; kind: MediaKind }[] = [
    ...(subjects.product
      ? [
          { q: `${subjects.product} bottle`, kind: 'product' as const },
          { q: subjects.product, kind: 'product' as const }
        ]
      : []),
    ...(subjects.person ? [{ q: subjects.person, kind: 'portrait' as const }] : []),
    ...subjects.places.map((q) => ({ q, kind: 'place' as const })),
    ...subjects.extras.map((q) => ({ q, kind: 'other' as const }))
  ]
  const libCandidates: { pick: StockCandidate; kind: MediaKind }[] = []
  for (const { q, kind } of libQueries) {
    const found = [
      ...(await searchReal(q, s, exclude, (m) => log(m, 'warn'), ctx.signal)),
      ...(await gatherCandidates(q, 0, archives, exclude, 3, undefined, ctx.signal))
    ]
    for (const pick of found.filter((c) => c.kind === 'stock_photo').slice(0, 8)) {
      if (exclude.has(pick.source)) continue
      exclude.add(pick.source)
      libCandidates.push({ pick, kind })
    }
  }

  // 3. Candidates of each scene: its planned shots in every archive, short variants when a
  // term finds nothing.
  const perScene = new Map<number, StockCandidate[]>()
  await pool(
    narrated.filter((sc) => !sc.locked),
    3,
    async (sc) => {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      const terms = plans.get(sc.index)?.terms.slice(0, 4) ?? [
        sc.narration.split(/\s+/).slice(0, 6).join(' ')
      ]
      const found: StockCandidate[] = []
      for (const term of terms) {
        for (const q of shortVariants(term)) {
          try {
            const got = (
              await gatherCandidates(q, 0, archives, exclude, 3, undefined, ctx.signal)
            ).filter(
              (c) => c.kind === 'stock_photo' && !c.loc && !found.some((f) => f.source === c.source)
            )
            found.push(...got)
            if (got.length) break
          } catch (error) {
            if (ctx.signal.aborted) throw error
          }
        }
      }
      const picks = found.slice(0, 10)
      picks.forEach((c) => exclude.add(c.source))
      perScene.set(sc.index, picks)
    }
  )
  ctx.progress(0.3)

  // 4. Download everything once.
  const files = new Map<string, string>()
  const all = [...libCandidates.map((c) => c.pick), ...[...perScene.values()].flat()]
  await pool(all, 4, async (pick) => {
    if (files.has(pick.source)) return
    try {
      files.set(pick.source, await fetchOnce(pick, dir, ctx.signal))
    } catch (error) {
      if (ctx.signal.aborted) throw error
    }
  })
  const item = (pick: StockCandidate, kind: MediaKind): MediaItem | null => {
    const file = files.get(pick.source)
    return file
      ? {
          file,
          kind,
          type: 'stock_photo',
          source: pick.source,
          credit: pick.credit ?? null,
          year: pick.year
        }
      : null
  }
  ctx.progress(0.4)

  // 5a. Printed clues of a later ad (nylon, ZIP codes, "yours for only"): refused everywhere.
  const rejected: { scene: number; file: string; reason: string }[] = []
  const ocrFile = join(vdir, 'ocr.json')
  const ocrCache: Record<string, string> = existsSync(ocrFile)
    ? (JSON.parse(readFileSync(ocrFile, 'utf8')) as Record<string, string>)
    : {}
  const late = new Set<string>()
  for (const file of new Set(files.values())) {
    if (ctx.signal.aborted) throw new Error('Cancelado')
    const key = basename(file)
    if (ocrCache[key] === undefined) {
      ocrCache[key] = (await localOcr(file, ctx.signal)).text
      writeFileSync(ocrFile, JSON.stringify(ocrCache, null, 2))
    }
    const clue = lateClue(ocrCache[key])
    if (clue) {
      late.add(file)
      rejected.push({
        scene: -1,
        file,
        reason: `pista de anúncio posterior a 1930 no texto (${clue})`
      })
    }
  }
  for (const [source, file] of files) if (late.has(file)) files.delete(source)

  // 5b. Visual check at two levels: LITERAL (what the line says) or CONTEXT (its place, era,
  // product, kind of object). NONE is never used.
  const cacheFile = join(vdir, 'checks.json')
  const cache: VisionCache = existsSync(cacheFile)
    ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as VisionCache)
    : {}
  // Refusals from before the two levels are checked again: some are CONTEXT now.
  const fresh = (v: VisualVerdict | undefined): boolean => !!v && (v.ok || !!v.level)
  const check = async (
    narration: string,
    items: MediaItem[],
    scene: number
  ): Promise<MediaItem[]> => {
    const todo = items.filter((m) => !fresh(cache[vkey(narration, m.file)]))
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
      if (v?.ok)
        ok.push({ ...m, kind: m.kind === 'other' ? v.kind : m.kind, level: v.level ?? 'literal' })
      else
        rejected.push({
          scene,
          file: m.file,
          reason: v
            ? `não tem relação com a narração (${v.what || 'sem descrição'})`
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
  const periods =
    (readTimings(ctx.projectDir) as { periods?: { sceneId: number; end: number }[] } | null)
      ?.periods ?? []
  const claimScenes = new Set(
    (Array.isArray(script?.claims) ? (script.claims as { scene?: number }[]) : []).map((c) =>
      Number(c.scene)
    )
  )
  const years = sceneYears(scenes.map((sc) => sc.year))
  const plan: PlanScene[] = []
  for (const [k, sc] of scenes.entries()) {
    if (ctx.signal.aborted) throw new Error('Cancelado')
    if (sc.locked || sc.start_sec === null || sc.end_sec === null) continue
    const own = (perScene.get(sc.index) ?? [])
      .map((p) => item(p, 'other'))
      .filter((m): m is MediaItem => !!m)
    const before = rejected.length
    const approved = await check(sc.narration, [...own, ...photos], sc.index)
    // Another era than the scene's (±15 years) only where the narration talks about it.
    const ok = approved.filter((m) => {
      const why = eraProblem(m.year, years[k], sc.narration)
      if (why) rejected.push({ scene: sc.index, file: m.file, reason: `fora da época (${why})` })
      return !why
    })
    const banned = new Set([...late, ...rejected.slice(before).map((r) => r.file)])
    const data = adSceneData(script ?? null, sc.index)
    const period = periods.find((p) => p.sceneId === sc.id)
    plan.push({
      index: sc.index,
      start: sc.start_sec,
      end: sc.end_sec,
      hold: period ? period.end - sc.start_sec + 0.3 : 0,
      scan: data.scan && adItems.length > 0,
      mainAd: sc.index === 0 || claimScenes.has(sc.index) || !!data.adQuote,
      ok,
      year: years[k],
      narration: sc.narration,
      banned
    })
    ctx.progress(0.4 + (0.3 * (k + 1)) / scenes.length)
  }
  setState(`relevance.rejected.video.${videoId}`, rejected)
  if (rejected.length) log(`${rejected.length} imagem(ns) reprovada(s) na checagem visual`, 'warn')

  // 6. The video's bank: every distinct real picture it may show.
  const bank = [...adItems, ...photos]
  for (const p of plan) for (const m of p.ok) if (!bank.some((b) => b.file === m.file)) bank.push(m)
  writeFileSync(
    join(dir, 'bank.json'),
    JSON.stringify(
      {
        items: bank.map(({ file, kind, year, source, credit, level }) => ({
          file,
          kind,
          year,
          source,
          credit,
          level
        }))
      },
      null,
      2
    )
  )
  const notes: string[] = []
  if (bank.length < BANK_MIN) {
    notes.push(`Banco de mídia com ${bank.length} imagens distintas (mínimo ${BANK_MIN})`)
    log(notes[0], 'warn')
  }

  // 7. Animations and evidence boards from the script's data (15–25% of the video).
  const wanted = pickAnimationScenes(
    plan.map((p) => ({
      ...p,
      scan: p.scan || p.hold > 0,
      visual: plans.get(p.index)?.visual ?? 'photo'
    })),
    duration
  )
  const made = new Map<string, VisualSpec | null>()
  const anims: string[] = []
  for (const p of plan) {
    const kind = wanted.get(p.index)
    if (!kind) continue
    let spec: VisualSpec | null = null
    try {
      if (kind === 'evidence') {
        const proofs = [
          ...adItems,
          ...byRelevance(p.ok).filter((m) => m.level === 'literal'),
          ...photos
        ]
        const unique = proofs.filter((m, i) => proofs.findIndex((x) => x.file === m.file) === i)
        spec = evidenceSpec(
          unique
            .slice((anims.length * 2) % Math.max(1, unique.length - 2), undefined)
            .slice(0, 4)
            .map((m) => ({
              file: m.file,
              caption:
                m.kind === 'ad' ? `${m.year ?? ''} ad`.trim() : m.year ? String(m.year) : undefined
            }))
        )
      } else {
        // Map, tree and label are the same for the whole video; timelines move their red year.
        const key = kind === 'timeline' || kind === 'letter' ? `${kind}:${p.index}` : kind
        if (!made.has(key))
          made.set(
            key,
            await dataSpec(kind, {
              narration: p.narration ?? '',
              story,
              script: script ?? null,
              ads,
              product: subjects.product,
              pictures: bank.map((b) => ({ file: b.file, year: b.year })),
              s,
              signal: ctx.signal
            })
          )
        spec = made.get(key) ?? null
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error
      log(`Animação ${kind} da cena ${p.index + 1} falhou: ${(error as Error).message}`, 'warn')
    }
    if (!spec) continue
    const sec = Math.min(ANIM_SEC[spec.kind], p.end - p.start)
    p.anim = writeShot(dir, { shot: 'visual', spec, sec })
    p.hold = sec
    anims.push(spec.kind)
  }
  if (anims.length) log(`Animações: ${anims.join(', ')}`)
  ctx.progress(0.75)

  // 8. Shot by shot: real pictures, their details and parallax moves.
  const shots = planShots(plan, { ads: adItems, photos })
  const uses = new Map<string, number>()
  const views = new Map<string, string[]>()
  let sinceParallax = 0
  const frame = async (m: MediaItem): Promise<MediaItem> => {
    const n = uses.get(m.file) ?? 0
    uses.set(m.file, n + 1)
    if (m.kind === 'ad') return m
    // Second and third uses of a picture: a close-up of another part of it.
    if (n > 0) {
      if (!views.has(m.file))
        views.set(m.file, await detailViews(m.file, dir, ctx.signal).catch(() => []))
      const v = views.get(m.file)?.[n - 1]
      return v ? { ...m, file: v } : m
    }
    // At most one in three shots moves in 2.5D.
    if (PARALLAX_KINDS.includes(m.kind) && ++sinceParallax >= 3) {
      const v = await parallaxView(m.file, dir, ctx.signal)
      if (v) {
        sinceParallax = 0
        return { ...m, file: v }
      }
    }
    return m
  }
  const framed = new Map<number, MediaItem[]>()
  for (const p of plan) {
    const list: MediaItem[] = []
    for (const m of shots.get(p.index) ?? []) list.push(await frame(m))
    framed.set(p.index, list)
  }

  // 9. Engraving illustrations where real media ran out (≤ 25% of the video).
  const missingOf = (p: PlanScene): number =>
    slotsOf(p) - (p.anim ? 1 : 0) - (framed.get(p.index)?.length ?? 0)
  const refs = bank
    .filter((b) => b.kind === 'event' || b.kind === 'ad')
    .slice(0, 3)
    .map((b) => b.file)
  const realPeople = [subjects.person, ...((script?.people as string[] | undefined) ?? [])].filter(
    Boolean
  )
  let aiSec = 0
  let illustrations = 0
  for (const p of plan) {
    const missing = missingOf(p)
    if (missing <= 0) continue
    const slots = shotDurations(p.start, p.end, p.hold)
    const slotSec = slots[slots.length - 1] ?? p.end - p.start
    if (aiSec + slotSec > MIX.maxAi * duration) break
    const out = join(dir, `illustration_${p.index}.png`)
    const ill = isValidFile(out)
      ? { file: out, prompt: '' }
      : await makeIllustration(p.narration ?? '', refs, out, ctx, realPeople).catch((error) => {
          if (ctx.signal.aborted) throw error
          log(`Ilustração da cena ${p.index + 1} falhou: ${(error as Error).message}`, 'warn')
          return null
        })
    if (!ill) continue
    const ai: MediaItem = {
      file: ill.file,
      kind: 'other',
      type: 'ai_image',
      source: 'ai:engraving',
      credit: null
    }
    // One illustration covers up to two slots of its scene (the second as a close-up).
    const list = framed.get(p.index) ?? []
    list.push(ai)
    aiSec += slotSec
    illustrations++
    if (missing > 1 && aiSec + slotSec <= MIX.maxAi * duration) {
      const [detail] = await detailViews(ill.file, dir, ctx.signal).catch(() => [])
      if (detail) {
        list.push({ ...ai, file: detail })
        aiSec += slotSec
      }
    }
    framed.set(p.index, list)
  }
  await freeComfy(s.comfyUrl).catch(() => undefined)
  if (illustrations)
    log(
      `${illustrations} ilustração(ões) de época geradas (${Math.round((aiSec / duration) * 100)}% do vídeo)`
    )
  ctx.progress(0.9)

  // 10. Text cards only where they add something (≤ 8%, never two in a row).
  const lastIndex = Math.max(...plan.map((p) => p.index))
  const cards = planCards(
    plan.map((p) => ({ ...p, missing: missingOf(p) })),
    script ?? null,
    MIX.maxCards * duration,
    lastIndex,
    ads[0] ? `${ads[0].page.newspaper}, ${ads[0].page.date.slice(0, 4)}` : 'The ad'
  )
  const cardItems = await renderCards(cards, dir, ctx)
  let short = 0
  for (const p of plan) {
    const list = [
      ...(p.anim
        ? [
            {
              file: p.anim,
              kind: 'other' as const,
              type: 'stock_photo' as const,
              source: 'visual:animation',
              credit: null
            }
          ]
        : []),
      ...mergeCards(framed.get(p.index) ?? [], cardItems.get(p.index) ?? [])
    ]
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
  if (short) {
    notes.push(`${short} cena(s) com menos imagens que o ritmo pede`)
    log(notes.at(-1) as string, 'warn')
  }
  setState(`review.notes.media.${videoId}`, notes)
  const missing = listScenes(videoId).filter((sc) => !isAssetFile(sc.asset_path))
  if (missing.length)
    throw new Error(
      `${missing.length} cena(s) sem mídia real (cenas ${missing.map((m) => m.index + 1).join(', ')}): nenhum anúncio nem foto de época encontrados`
    )
  // Engravings in the style of the period are not realistic: no synthetic-content label.
  updateVideo(videoId, { synthetic_content: false, synthetic_reason: null })
  ctx.log(
    `Cenas: ${adItems.length} anúncio(s), ${photos.length} foto(s) da história, banco de ${bank.length}, ${anims.length} animação(ões), ${illustrations} ilustração(ões), ${[...cardItems.values()].flat().length} cartão(ões), ${rejected.length} reprovada(s)`
  )
  ctx.progress(1)
}
