import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { z } from 'zod'
import type { CardProps } from '../../shared/render'
import type { AssetType, Scene, Script, Settings } from '../../shared/types'
import { priceTag } from '../../shared/cpi'
import { eraProblem, lateClue, sceneYears } from '../../shared/era'
import { maxStillSec, shotDurations } from '../../shared/shots'
import { adSceneData } from '../../shared/formats/vintage-ads'
import { getVideo, listScenes, updateScene, updateVideo } from '../db/repo'
import { setState } from '../db/settings'
import { enhanceScan, localOcr, scanAd } from '../services/adscan'
import { credit } from '../services/chroniclingamerica'
import { freeComfy } from '../services/comfy'
import { isValidFile, runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import type { StockCandidate } from '../services/pexels'
import { runRender } from '../services/remotion'
import { fetchCandidate, searchReal } from '../services/stock'
import { gatherAds, videoEvidence, type Evidence } from './evidence'
import { polishSettings } from './polish'
import { readTimings } from './audio'
import { MEDIA_KINDS, visualCheck, type MediaKind, type VisualVerdict } from './relevance'
import { prepareComfy, sceneCandidates } from './scenes'
import type { StepContext } from './types'

/** The same file appears at most this many times in a video. */
export const MAX_USES = 3

/** Distinct pictures a video should have before planning its shots. */
export const BANK_MIN = 25

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
  /** Year the scene is set in (its own or the last one before it) */
  year?: number | null
  narration?: string
  /** Files the checks refused for this scene: never shown in it, not even as a fallback */
  banned?: Set<string>
}

export interface Library {
  /** Real ads of the product, the investigated one first */
  ads: MediaItem[]
  /** Real period photos of the story (product, people, places), approved for the video */
  photos: MediaItem[]
}

const rank = (k: MediaKind): number => MEDIA_KINDS.indexOf(k)

/** Images a scene needs at its cadence (shared/shots). */
export const slotsOf = (sc: Pick<PlanScene, 'start' | 'end' | 'hold'>): number =>
  shotDurations(sc.start, sc.end, sc.hold).length

/**
 * Which pictures each scene shows, in order (first = main asset). Each scene gets one image
 * per slot of its cadence (shared/shots), by priority: ads, the real product, the real
 * person, places, period engravings, never a random object. When a scene runs out: another
 * ad of the product, then a period photo of the story. A file refused for a scene (visual
 * check, period clue) never shows in it, a picture from another era only where the scene
 * talks about it, and no file goes past MAX_USES: slots left empty become data cards
 * (planCards). In the first minute the ad, the product and the face all show.
 */
export function planShots(scenes: PlanScene[], lib: Library): Map<number, MediaItem[]> {
  const uses = new Map<string, number>()
  const used = (m: MediaItem): number => uses.get(m.file) ?? 0
  const best = (list: MediaItem[]): MediaItem[] =>
    [...list].sort((a, b) => used(a) - used(b) || rank(a.kind) - rank(b.kind))
  // The first minute must show the real product and the real face.
  const early = [
    lib.photos.find((p) => p.kind === 'product'),
    lib.photos.find((p) => p.kind === 'portrait')
  ].filter((m): m is MediaItem => !!m)
  const out = new Map<number, MediaItem[]>()

  for (const sc of scenes) {
    const need = slotsOf(sc)
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
 * Sentences of a narration, short enough to read on screen: a long one is cut into equal
 * parts of at most 14 words, so every scene has enough lines to fill its slots.
 */
export function cardLines(narration: string): string[] {
  return (narration.match(/[^.!?]+[.!?]*/g) ?? []).flatMap((t) => {
    const words = t.trim().split(/\s+/).filter(Boolean)
    if (words.length < 5) return []
    if (words.length <= 18) return [words.join(' ')]
    const parts = Math.ceil(words.length / 14)
    const size = Math.ceil(words.length / parts)
    return Array.from({ length: parts }, (_, i) => words.slice(i * size, (i + 1) * size))
      .filter((w) => w.length >= 5)
      .map((w, i, all) => `${i ? '…' : ''}${w.join(' ')}${i < all.length - 1 ? '…' : ''}`)
  })
}

/**
 * Full-screen cards for the slots planShots left empty, from what the scene says: its
 * Claim Check, its price, the ad's words, the story's timeline, then a line of its narration.
 * No card repeats in the video; a scene with nothing to say keeps fewer images.
 */
export function planCards(
  scenes: (Pick<PlanScene, 'index' | 'year' | 'narration'> & { missing: number })[],
  script: Script | null,
  years: (number | null)[]
): Map<number, CardProps[]> {
  const claims = Array.isArray(script?.claims)
    ? (script.claims as { scene?: number; quote?: string; verdict?: string; source?: string }[])
    : []
  const story = [...new Set(years.filter((y): y is number => !!y))].sort((a, b) => a - b)
  // At most 7 marks: the ends and evenly spaced years between them.
  const marks =
    story.length <= 7
      ? story
      : [
          ...new Set(
            Array.from({ length: 7 }, (_, i) => story[Math.round((i * (story.length - 1)) / 6)])
          )
        ]
  const seen = new Set<string>()
  const out = new Map<number, CardProps[]>()
  for (const sc of scenes) {
    if (sc.missing <= 0) continue
    const data = adSceneData(script, sc.index)
    const options: CardProps[] = []
    for (const c of claims.filter((c) => Number(c.scene) === sc.index && c.quote))
      options.push({ kind: 'claim', text: String(c.quote), stamp: c.verdict, sub: c.source })
    const price = data.price ? priceTag(data.price.usd, data.price.year) : null
    if (price)
      options.push({
        kind: 'price',
        text: `${price.then} in ${data.price?.year}`,
        sub: `≈ ${price.today} today`
      })
    if (data.adQuote) options.push({ kind: 'quote', text: data.adQuote, sub: 'The ad' })
    const lines = cardLines(sc.narration ?? '')
    if (sc.year && marks.length >= 3)
      options.push({
        kind: 'timeline',
        text: lines.find((l) => l.includes(String(sc.year))) ?? '',
        years: marks.includes(sc.year) ? marks : [...marks, sc.year].sort((a, b) => a - b),
        current: sc.year
      })
    for (const l of lines) options.push({ kind: 'quote', text: l })
    const list: CardProps[] = []
    for (const o of options) {
      const key = `${o.kind}|${o.text}|${o.current ?? ''}`
      if (list.length >= sc.missing || seen.has(key)) continue
      seen.add(key)
      list.push(o)
    }
    if (list.length) out.set(sc.index, list)
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
        year: Number(ad.page.date.slice(0, 4)) || undefined,
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
    return { product: '', person: '', places: [] as string[], extras: [] as string[] }
  })
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
  const exclude = new Set<string>(adItems.map((a) => a.source))
  const libCandidates: { pick: StockCandidate; kind: MediaKind }[] = []
  for (const { q, kind } of libQueries) {
    const found = await searchReal(q, s, exclude, (m) => log(m, 'warn'), ctx.signal)
    for (const pick of found.filter((c) => c.kind === 'stock_photo').slice(0, 6)) {
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
  ctx.progress(0.45)

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

  // 5b. Visual check: does the picture show what the narration says? Only "yes" is used.
  const cacheFile = join(vdir, 'checks.json')
  const cache: VisionCache = existsSync(cacheFile)
    ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as VisionCache)
    : {}
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
  const years = sceneYears(scenes.map((sc) => sc.year))
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
    ctx.progress(0.45 + (0.45 * (k + 1)) / scenes.length)
  }
  setState(`relevance.rejected.video.${videoId}`, rejected)
  if (rejected.length) log(`${rejected.length} imagem(ns) reprovada(s) na checagem visual`, 'warn')

  // 6. The video's bank: every distinct picture it may show. Below BANK_MIN the gaps become
  // data cards instead of repeats, and the review says so.
  const bank = [...adItems, ...photos]
  for (const p of plan) for (const m of p.ok) if (!bank.some((b) => b.file === m.file)) bank.push(m)
  writeFileSync(
    join(dir, 'bank.json'),
    JSON.stringify(
      {
        items: bank.map(({ file, kind, year, source, credit }) => ({
          file,
          kind,
          year,
          source,
          credit
        }))
      },
      null,
      2
    )
  )
  const notes: string[] = []
  if (bank.length < BANK_MIN) {
    notes.push(
      `Banco de mídia com ${bank.length} imagens distintas (mínimo ${BANK_MIN}): lacunas viraram cartões de dados`
    )
    log(notes[0], 'warn')
  }

  // 7. Shot by shot; slots without media get a data card.
  const shots = planShots(plan, { ads: adItems, photos })
  const cards = planCards(
    plan.map((p) => ({ ...p, missing: slotsOf(p) - (shots.get(p.index)?.length ?? 0) })),
    script ?? null,
    years
  )
  const cardItems = await renderCards(cards, dir, ctx)
  let short = 0
  for (const p of plan) {
    const list = mergeCards(shots.get(p.index) ?? [], cardItems.get(p.index) ?? [])
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
    notes.push(`${short} cena(s) com menos imagens que o ritmo pede, mesmo com cartões`)
    log(notes.at(-1) as string, 'warn')
  }
  setState(`review.notes.media.${videoId}`, notes)
  const missing = listScenes(videoId).filter((sc) => !isValidFile(sc.asset_path))
  if (missing.length)
    throw new Error(
      `${missing.length} cena(s) sem mídia real (cenas ${missing.map((m) => m.index + 1).join(', ')}): nenhum anúncio nem foto de época encontrados`
    )
  updateVideo(videoId, { synthetic_content: false, synthetic_reason: null })
  ctx.log(
    `Cenas: ${adItems.length} anúncio(s), ${photos.length} foto(s) de época aprovadas, banco de ${bank.length}, ${[...cardItems.values()].flat().length} cartão(ões), ${rejected.length} reprovada(s)`
  )
  ctx.progress(1)
}
