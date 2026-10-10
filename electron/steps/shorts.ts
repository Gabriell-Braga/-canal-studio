import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import { z } from 'zod'
import type {
  RenderCompany,
  RenderJob,
  ShortProps,
  TemplateId,
  YearCard
} from '../../shared/render'
import type { Scene, Video } from '../../shared/types'
import { createShort, deleteVideo, getVideo, listScenes, listShorts, updateVideo } from '../db/repo'
import { isValidFile, probeDuration } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import { pythonPost } from '../services/python'
import { runRender } from '../services/remotion'
import { readWords, type Word } from './transcribe'
import { renderCompanies, yearCardsFor } from './overlays'
import { sceneFocus } from './focus'
import type { Step, StepContext } from './types'

/**
 * Seconds of narration in a short, pauses already shrunk (see tightCuts). Shorts above ~60 s
 * lose reach; the end card adds ~4 s.
 */
export const MIN_SEGMENT = 25
export const MAX_SEGMENT = 52

const segmentsSchema = z.object({
  segments: z.array(
    z.object({
      first_scene: z.number().int(),
      last_scene: z.number().int(),
      headline: z.string().min(1),
      title: z.string().min(1),
      description: z.string()
    })
  )
})

export interface Segment {
  first: number
  last: number
  start: number
  end: number
  headline: string
  title: string
  description: string
}

type Timed = Pick<Scene, 'index' | 'start_sec' | 'end_sec'>

/**
 * Turn the model's picks into valid cuts: whole scenes, MIN–MAX_SEGMENT long, no overlap. Too
 * long → drop scenes from the end; too short → add the following scenes. `length` measures a
 * cut in seconds of the short (by default its plain duration).
 */
export function normalizeSegments(
  scenes: Timed[],
  picks: {
    first_scene: number
    last_scene: number
    headline: string
    title: string
    description: string
  }[],
  count: number,
  length: (start: number, end: number) => number = (start, end) => end - start
): Segment[] {
  const n = scenes.length
  const t = (i: number, key: 'start_sec' | 'end_sec'): number => scenes[i][key] ?? 0
  const out: Segment[] = []
  const used = new Set<number>()
  for (const p of picks) {
    const first = Math.max(0, Math.min(n - 1, p.first_scene))
    let last = Math.max(first, Math.min(n - 1, p.last_scene))
    const len = (l: number): number => length(t(first, 'start_sec'), t(l, 'end_sec'))
    while (last > first && len(last) > MAX_SEGMENT) last--
    while (last < n - 1 && len(last) < MIN_SEGMENT && len(last + 1) <= MAX_SEGMENT) last++
    // A single scene longer than the cap: keep its first MAX_SEGMENT seconds.
    const start = t(first, 'start_sec')
    const end = Math.min(t(last, 'end_sec'), start + MAX_SEGMENT)
    if (length(start, end) < MIN_SEGMENT * 0.7) continue
    const range = Array.from({ length: last - first + 1 }, (_, k) => first + k)
    if (range.some((i) => used.has(i))) continue
    range.forEach((i) => used.add(i))
    out.push({
      first,
      last,
      start,
      end,
      headline: p.headline,
      title: p.title,
      description: p.description
    })
    if (out.length >= count) break
  }
  return out
}

/** Fallback when the model fails: evenly spaced windows, the first one on the hook. */
export function evenSegments(
  scenes: Timed[],
  count: number,
  fallbackTitle: string,
  length?: (start: number, end: number) => number
): Segment[] {
  const picks = Array.from({ length: count }, (_, k) => {
    const first = Math.floor((k * scenes.length) / count)
    return {
      first_scene: first,
      last_scene: first + 2,
      headline: fallbackTitle,
      title: fallbackTitle,
      description: ''
    }
  })
  return normalizeSegments(scenes, picks, count, length)
}

/** Silence kept on each side of a pause between words: shorts move faster than the full video. */
export const SHORT_PAUSE = 0.12

type Cut = NonNullable<ShortProps['cuts']>[number]

/** Narration pieces of a cut with every pause between words shrunk to 2 × SHORT_PAUSE. */
export function tightCuts(words: { start: number; end: number }[], duration: number): Cut[] {
  if (!words.length) return [{ from: 0, to: duration, at: 0 }]
  const cuts: Cut[] = []
  let from = Math.max(0, words[0].start - SHORT_PAUSE)
  let at = 0
  for (let i = 0; i + 1 < words.length; i++) {
    const to = words[i].end + SHORT_PAUSE
    const next = words[i + 1].start - SHORT_PAUSE
    if (next <= to) continue
    cuts.push({ from, to, at })
    at += to - from
    from = next
  }
  cuts.push({ from, to: Math.min(duration, words[words.length - 1].end + 0.3), at })
  return cuts
}

/** Seconds a stretch of the narration lasts in a short, pauses shrunk. */
export function spokenLength(
  words: { start: number; end: number }[],
  start: number,
  end: number
): number {
  const inside = words
    .filter((w) => w.start >= start && w.end <= end)
    .map((w) => ({ start: w.start - start, end: w.end - start }))
  const cuts = tightCuts(inside, end - start)
  const last = cuts[cuts.length - 1]
  return last.at + last.to - last.from
}

/**
 * Longer cut for a short whose pauses were taken out: add the following scenes until it lasts
 * `target` seconds again, never past MAX_SEGMENT or into scenes another short uses.
 * Null when no scene fits.
 */
export function extendSegment(
  scenes: Timed[],
  start: number,
  end: number,
  target: number,
  taken: [number, number][],
  length: (start: number, end: number) => number
): { last: number; end: number } | null {
  const last = scenes.findIndex((sc) => Math.abs((sc.end_sec ?? 0) - end) < 0.05)
  if (last < 0) return null
  let k = last
  while (k + 1 < scenes.length && length(start, end) < target) {
    const next = scenes[k + 1]
    const [a, b] = [next.start_sec ?? 0, next.end_sec ?? 0]
    if (taken.some(([s, e]) => a < e && b > s) || length(start, b) > MAX_SEGMENT) break
    k++
    end = b
  }
  return k > last ? { last: k, end } : null
}

/** Where a second of the cut lands in the short; a second inside a removed pause snaps forward. */
export function remapTime(cuts: Cut[], t: number): number {
  for (const c of cuts) if (t < c.to) return c.at + Math.max(0, t - c.from)
  const last = cuts[cuts.length - 1]
  return last.at + last.to - last.from
}

/** Drop the pauses of a short and move scenes, captions and year cards with the narration. */
export function tighten(short: ShortProps): ShortProps {
  if (short.cuts) return short
  const cuts = tightCuts(short.words, short.segmentDuration)
  const m = (t: number): number => remapTime(cuts, t)
  const scenes = short.scenes
    .map((sc) => ({ ...sc, start: m(sc.start), end: m(sc.end) }))
    .filter((sc, i) => i === 0 || sc.end - sc.start > 0.05)
  scenes[0].start = 0
  return {
    ...short,
    cuts,
    segmentDuration: m(short.segmentDuration),
    scenes,
    words: short.words.map((w) => ({ ...w, start: m(w.start), end: m(w.end) })),
    yearCards: short.yearCards?.map((c) => ({ ...c, at: m(c.at) }))
  }
}

function url(root: string, file: string): string {
  return `{{root}}/${relative(root, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

/** The thumbnail picked for the full video, which the end card of its shorts shows. */
function chosenThumb(video: Video): string | null {
  const thumb = video.thumbnail_paths[video.chosen_thumbnail ?? 0]
  return thumb && existsSync(thumb) ? thumb : null
}

function readShortJob(short: Video): (RenderJob & { short: ShortProps }) | null {
  if (!short.video_path) return null
  const file = join(dirname(short.video_path), `short_${short.id}.json`)
  if (!existsSync(file)) return null
  const job = JSON.parse(readFileSync(file, 'utf8')) as RenderJob
  return job.short ? (job as RenderJob & { short: ShortProps }) : null
}

/**
 * Finished shorts whose end card shows another thumbnail than the one picked, or an older
 * version of it, or that were cut before framing, tight pauses or the longer cuts existed.
 * Shorts already on YouTube are left alone: their video can't be replaced.
 */
export function staleShorts(parent: Video): Video[] {
  const thumb = chosenThumb(parent)
  if (!thumb) return []
  return listShorts(parent.id).filter((short) => {
    if (short.youtube_id || !isValidFile(short.video_path, 100_000)) return false
    const job = readShortJob(short)
    if (!job) return false
    if (!job.framed || !job.short.cuts || !job.extended) return true
    if (job.short.cta.thumbnail !== url(job.root, thumb)) return true
    return statSync(thumb).mtimeMs > statSync(short.video_path as string).mtimeMs
  })
}

/** Image scenes of a short job with their crop focus (see focus.ts). */
async function framedScenes(
  job: RenderJob & { short: ShortProps },
  ctx: StepContext
): Promise<ShortProps['scenes']> {
  return Promise.all(
    job.short.scenes.map(async (sc) => {
      if (sc.type !== 'image' || sc.focus) return sc
      const file = join(
        job.root,
        ...sc.src.replace('{{root}}/', '').split('/').map(decodeURIComponent)
      )
      return { ...sc, focus: await sceneFocus(file, ctx) }
    })
  )
}

/** What every short of a video shares: words, logos, year cards, music and the closing line. */
interface ShortKit {
  video: Video
  root: string
  words: Word[]
  companies: RenderCompany[]
  cards: YearCard[]
  music: string | null
  cta: ShortProps['cta']
}

async function shortKit(video: Video, ctx: StepContext): Promise<ShortKit> {
  const s = ctx.settings
  const root = ctx.projectDir
  // The closing line, in the channel's voice, cached by text.
  const dir = join(root, 'shorts')
  mkdirSync(dir, { recursive: true })
  const ctaHash = createHash('sha1')
    .update(`${s.voice}|${s.voiceSpeed}|${s.shortsCta}`)
    .digest('hex')
    .slice(0, 10)
  const ctaAudio = join(dir, `cta_${ctaHash}.wav`)
  if (!isValidFile(ctaAudio)) {
    await pythonPost(
      '/tts',
      { text: s.shortsCta, voice: s.voice, speed: s.voiceSpeed, out_path: ctaAudio },
      ctx.signal
    )
  }
  const music = readdirSync(root).find((f) => f.startsWith('music.'))
  const thumb = chosenThumb(video)
  return {
    video,
    root,
    words: readWords(root),
    companies: await renderCompanies(video, ctx),
    cards: yearCardsFor(listScenes(video.id), root),
    music: music ? url(root, join(root, music)) : null,
    cta: {
      audio: url(root, ctaAudio),
      duration: (await probeDuration(ctaAudio)) + 0.6,
      text: s.shortsCta,
      thumbnail: thumb ? url(root, thumb) : null,
      parentTitle: video.title ?? video.topic
    }
  }
}

/** Render props of one short: scenes `first`–`last` of the video, pauses shrunk. */
async function shortProps(
  kit: ShortKit,
  scenes: Scene[],
  seg: Pick<Segment, 'first' | 'last' | 'start' | 'end' | 'headline'>,
  k: number,
  ctx: StepContext
): Promise<ShortProps> {
  const s = ctx.settings
  const { root, video } = kit
  const duration = seg.end - seg.start
  return tighten({
    fps: 30,
    segmentStart: seg.start,
    segmentDuration: duration,
    narration: url(root, video.audio_path as string),
    scenes: await Promise.all(
      scenes.slice(seg.first, seg.last + 1).map(async (sc, i) => {
        const isVideo = sc.asset_type === 'stock_video' || sc.asset_type === 'ai_video'
        return {
          src: url(root, sc.asset_path as string),
          type: isVideo ? ('video' as const) : ('image' as const),
          start: Math.max(0, (sc.start_sec as number) - seg.start),
          end: Math.min(duration, (sc.end_sec as number) - seg.start),
          motion: (i * 5 + k) % 4,
          clipDuration: isVideo ? await probeDuration(sc.asset_path as string) : undefined,
          focus: isVideo ? undefined : await sceneFocus(sc.asset_path as string, ctx)
        }
      })
    ),
    words: kit.words
      .filter((w) => w.start >= seg.start && w.end <= seg.end)
      .map((w) => ({ ...w, start: w.start - seg.start, end: w.end - seg.start })),
    captions: true,
    music: kit.music,
    musicVolume: s.musicVolume,
    template: (video.template as TemplateId) ?? 'bold',
    brand: {
      primary: s.brandPrimary,
      secondary: s.brandSecondary,
      font: s.brandFont,
      outline: s.brandOutline
    },
    headline: seg.headline.toUpperCase(),
    companies: kit.companies,
    yearCards: kit.cards
      .filter((c) => c.at > seg.start && c.at < seg.end)
      .map((c) => ({ ...c, at: c.at - seg.start })),
    cta: kit.cta
  })
}

/** Scenes of a video with times and media, the ones shorts are cut from. */
function timedScenes(videoId: number): Scene[] {
  return listScenes(videoId).filter((sc) => sc.start_sec !== null && isValidFile(sc.asset_path))
}

/**
 * Render the stale shorts again with the picked thumbnail, framing and tight pauses. The cut
 * keeps its start; a short cut before the pauses were shrunk gets the following scenes back
 * up to its old length.
 */
async function refreshEndCards(parent: Video, ctx: StepContext, share: number): Promise<number> {
  const stale = staleShorts(parent)
  const thumb = chosenThumb(parent)
  if (!thumb || !stale.length) return 0
  const scenes = timedScenes(parent.id)
  const kit = await shortKit(parent, ctx)
  const length = (a: number, b: number): number => spokenLength(kit.words, a, b)
  for (const [k, short] of stale.entries()) {
    if (ctx.signal.aborted) throw new Error('Cancelado')
    const job = readShortJob(short)
    if (!job) continue
    const out = short.video_path as string
    const { short_start: start, short_end: end } = short
    const taken = listShorts(parent.id)
      .filter((o) => o.id !== short.id && o.short_start !== null && o.short_end !== null)
      .map((o): [number, number] => [o.short_start as number, o.short_end as number])
    const longer =
      !job.extended && start !== null && end !== null
        ? extendSegment(scenes, start, end, end - start, taken, length)
        : null
    let props: ShortProps
    if (longer && start !== null) {
      const first = scenes.findIndex((sc) => Math.abs((sc.start_sec ?? 0) - start) < 0.05)
      props = await shortProps(
        kit,
        scenes,
        { first, last: longer.last, start, end: longer.end, headline: job.short.headline },
        k,
        ctx
      )
    } else {
      props = tighten({
        ...job.short,
        scenes: await framedScenes(job, ctx),
        cta: { ...job.short.cta, thumbnail: url(job.root, thumb) }
      })
    }
    // Render beside the old file and swap at the end, so a pending upload never sees half a file.
    const tmp = out.replace(/\.mp4$/, '.new.mp4')
    ctx.log(
      `Atualizando o short "${short.title}" (${props.segmentDuration.toFixed(0)} s${longer ? ', com mais cenas' : ''})`
    )
    try {
      await runRender(
        { ...job, out: tmp, framed: true, extended: true, short: props },
        join(dirname(out), `short_${short.id}.json`),
        { progress: (p) => ctx.progress((share * (k + p)) / stale.length), signal: ctx.signal }
      )
      renameSync(tmp, out)
    } finally {
      rmSync(tmp, { force: true })
    }
    if (longer) updateVideo(short.id, { short_end: longer.end })
  }
  return stale.length
}

/**
 * Cut vertical shorts out of a finished video. Each short ends with a card and a narrated
 * line that send viewers to the full video; the upload links it in the description.
 */
export const shortsStep: Step = {
  type: 'short',
  async run(videoId, ctx) {
    const video = getVideo(videoId)
    const s = ctx.settings
    if (video.kind !== 'long') throw new Error('Shorts são gerados a partir de um vídeo longo')
    // Shorts already cut show the thumbnail picked now; a refresh job stops there.
    if (ctx.jobArgs?.refresh) {
      const n = await refreshEndCards(video, ctx, 1)
      ctx.log(n ? `${n} short(s) atualizados` : 'Shorts já estão atualizados')
      return
    }
    await refreshEndCards(video, ctx, 0)
    if (!isValidFile(video.audio_path) || !isValidFile(video.video_path, 100_000)) {
      throw new Error('Gere e renderize o vídeo antes dos shorts')
    }
    const scenes = timedScenes(videoId)
    if (scenes.length < 2) throw new Error('Cenas sem tempo ou mídia; refaça as etapas do vídeo')
    const count = Math.max(1, Math.min(5, Number(ctx.jobArgs?.count) || s.shortsCount))
    // A crash mid-render leaves shorts without a file; drop them before cutting again.
    // A failed short is replaced by the new cut too.
    for (const old of listShorts(videoId)) {
      if (['RENDERING', 'ERROR'].includes(old.status) && !old.video_path) deleteVideo(old.id)
    }
    const existing = listShorts(videoId)
    const kit = await shortKit(video, ctx)
    const length = (a: number, b: number): number => spokenLength(kit.words, a, b)

    ctx.log(`Escolhendo ${count} trecho(s) para shorts`)
    const list = scenes
      .map(
        (sc, i) => `#${i} [${sc.start_sec?.toFixed(0)}–${sc.end_sec?.toFixed(0)} s] ${sc.narration}`
      )
      .join('\n')
    let segments: Segment[] = []
    try {
      // The times listed still hold the pauses the short drops, hence the longer range asked.
      const { segments: picks } = await generateStructured(
        `You pick YouTube Shorts from a documentary narration about "${video.topic}" (video title: "${video.title}").
Scenes with their times:
${list}

Choose ${count} different segments of CONSECUTIVE scenes, each ${MIN_SEGMENT + 5}–${MAX_SEGMENT + 8} seconds long, that work on their own: they open with a strong, surprising line, keep tension and stop on a cliffhanger that makes people want the full video. Do not overlap segments. Avoid the final call to subscribe.
For each give: first_scene and last_scene (the # numbers), headline (2–6 words shown on screen that NAME the company or subject and spark curiosity, e.g. "XEROX GAVE APPLE ITS FUTURE", no hashtags), title (YouTube Shorts title, max 70 characters, no hashtags) and description (one sentence).
Return ONLY JSON: {"segments": [...]}`,
        segmentsSchema,
        { settings: s, signal: ctx.signal, temperature: 0.5 }
      )
      segments = normalizeSegments(scenes, picks, count, length)
    } catch (error) {
      ctx.log(
        `Escolha automática falhou (${(error as Error).message}); usando trechos espaçados`,
        'warn'
      )
    }
    if (segments.length < count) {
      const extra = evenSegments(scenes, count, video.title ?? video.topic, length).filter(
        (e) => !segments.some((sg) => !(e.last < sg.first || e.first > sg.last))
      )
      segments.push(...extra.slice(0, count - segments.length))
    }
    if (!segments.length) throw new Error('Vídeo curto demais para shorts')
    ctx.progress(0.15)

    const dir = join(ctx.projectDir, 'shorts')
    for (const [k, seg] of segments.entries()) {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      const props = await shortProps(kit, scenes, seg, k, ctx)
      const short = createShort(
        video,
        seg.start,
        seg.end,
        seg.title.replace(/#\w+/g, '').trim().slice(0, 90),
        seg.description
      )
      const out = join(dir, `short_${short.id}.mp4`)
      ctx.log(
        `Short ${k + 1}/${segments.length}: "${short.title}" (${props.segmentDuration.toFixed(0)} s, cenas ${seg.first + 1}–${seg.last + 1})`
      )
      try {
        await runRender(
          { mode: 'short', root: ctx.projectDir, out, short: props, framed: true, extended: true },
          join(dir, `short_${short.id}.json`),
          {
            progress: (p) => ctx.progress(0.15 + (0.85 * (k + p)) / segments.length),
            signal: ctx.signal
          }
        )
      } catch (error) {
        rmSync(out, { force: true })
        updateVideo(short.id, {
          status: 'ERROR',
          error_message: (error as Error).message,
          error_step: 'short'
        })
        throw error
      }
      updateVideo(short.id, { video_path: out, status: 'FINAL_REVIEW' })
    }
    ctx.log(`${segments.length} short(s) prontos para revisão (já existiam ${existing.length})`)
  }
}
