import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join, relative } from 'path'
import { z } from 'zod'
import type { ShortProps, TemplateId } from '../../shared/render'
import type { Scene } from '../../shared/types'
import { createShort, deleteVideo, getVideo, listScenes, listShorts, updateVideo } from '../db/repo'
import { isValidFile, probeDuration } from '../services/ffmpeg'
import { generateJson } from '../services/ollama'
import { pythonPost } from '../services/python'
import { runRender } from '../services/remotion'
import { readWords } from './transcribe'
import type { Step } from './types'

/** Shorts above ~60 s lose reach; the end card adds ~4 s. */
export const MIN_SEGMENT = 18
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
 * Turn the model's picks into valid cuts: whole scenes, 18–52 s, no overlap. Too long → drop
 * scenes from the end; too short → add the following scenes.
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
  count: number
): Segment[] {
  const n = scenes.length
  const t = (i: number, key: 'start_sec' | 'end_sec'): number => scenes[i][key] ?? 0
  const out: Segment[] = []
  const used = new Set<number>()
  for (const p of picks) {
    const first = Math.max(0, Math.min(n - 1, p.first_scene))
    let last = Math.max(first, Math.min(n - 1, p.last_scene))
    while (last > first && t(last, 'end_sec') - t(first, 'start_sec') > MAX_SEGMENT) last--
    while (last < n - 1 && t(last, 'end_sec') - t(first, 'start_sec') < MIN_SEGMENT) last++
    // A single scene longer than the cap: keep its first MAX_SEGMENT seconds.
    const start = t(first, 'start_sec')
    const end = Math.min(t(last, 'end_sec'), start + MAX_SEGMENT)
    if (end - start < MIN_SEGMENT * 0.7) continue
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
export function evenSegments(scenes: Timed[], count: number, fallbackTitle: string): Segment[] {
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
  return normalizeSegments(scenes, picks, count)
}

function url(root: string, file: string): string {
  return `{{root}}/${relative(root, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
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
    if (!isValidFile(video.audio_path) || !isValidFile(video.video_path, 100_000)) {
      throw new Error('Gere e renderize o vídeo antes dos shorts')
    }
    const scenes = listScenes(videoId).filter(
      (sc) => sc.start_sec !== null && isValidFile(sc.asset_path)
    )
    if (scenes.length < 2) throw new Error('Cenas sem tempo ou mídia; refaça as etapas do vídeo')
    const count = Math.max(1, Math.min(5, Number(ctx.jobArgs?.count) || s.shortsCount))
    // A crash mid-render leaves shorts without a file; drop them before cutting again.
    for (const old of listShorts(videoId)) {
      if (old.status === 'RENDERING' && !old.video_path) deleteVideo(old.id)
    }
    const existing = listShorts(videoId)

    ctx.log(`Escolhendo ${count} trecho(s) para shorts`)
    const list = scenes
      .map(
        (sc, i) => `#${i} [${sc.start_sec?.toFixed(0)}–${sc.end_sec?.toFixed(0)} s] ${sc.narration}`
      )
      .join('\n')
    let segments: Segment[] = []
    try {
      const { segments: picks } = await generateJson(
        `You pick YouTube Shorts from a documentary narration about "${video.topic}" (video title: "${video.title}").
Scenes with their times:
${list}

Choose ${count} different segments of CONSECUTIVE scenes, each ${MIN_SEGMENT}–${MAX_SEGMENT} seconds long, that work on their own: they open with a strong, surprising line, keep tension and stop on a cliffhanger that makes people want the full video. Do not overlap segments. Avoid the final call to subscribe.
For each give: first_scene and last_scene (the # numbers), headline (2–6 words shown on screen, curiosity, no hashtags), title (YouTube Shorts title, max 70 characters, no hashtags) and description (one sentence).
Return ONLY JSON: {"segments": [...]}`,
        segmentsSchema,
        { url: s.ollamaUrl, model: s.ollamaModel, signal: ctx.signal, temperature: 0.5 }
      )
      segments = normalizeSegments(scenes, picks, count)
    } catch (error) {
      ctx.log(
        `Escolha automática falhou (${(error as Error).message}); usando trechos espaçados`,
        'warn'
      )
    }
    if (segments.length < count) {
      const extra = evenSegments(scenes, count, video.title ?? video.topic).filter(
        (e) => !segments.some((sg) => !(e.last < sg.first || e.first > sg.last))
      )
      segments.push(...extra.slice(0, count - segments.length))
    }
    if (!segments.length) throw new Error('Vídeo curto demais para shorts')
    ctx.progress(0.15)

    // The closing line, in the channel's voice, cached by text.
    const dir = join(ctx.projectDir, 'shorts')
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
    const ctaDuration = (await probeDuration(ctaAudio)) + 0.6
    const music = readdirSync(ctx.projectDir).find((f) => f.startsWith('music.'))
    const thumb = video.thumbnail_paths[video.chosen_thumbnail ?? 0]
    const words = readWords(ctx.projectDir)
    const root = ctx.projectDir

    for (const [k, seg] of segments.entries()) {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      const segScenes = scenes.slice(seg.first, seg.last + 1)
      const duration = seg.end - seg.start
      const props: ShortProps = {
        fps: 30,
        segmentStart: seg.start,
        segmentDuration: duration,
        narration: url(root, video.audio_path as string),
        scenes: await Promise.all(
          segScenes.map(async (sc, i) => {
            const isVideo = sc.asset_type === 'stock_video' || sc.asset_type === 'ai_video'
            return {
              src: url(root, sc.asset_path as string),
              type: isVideo ? ('video' as const) : ('image' as const),
              start: Math.max(0, (sc.start_sec as number) - seg.start),
              end: Math.min(duration, (sc.end_sec as number) - seg.start),
              motion: (i * 5 + k) % 4,
              clipDuration: isVideo ? await probeDuration(sc.asset_path as string) : undefined
            }
          })
        ),
        words: words
          .filter((w) => w.start >= seg.start && w.end <= seg.end)
          .map((w) => ({ ...w, start: w.start - seg.start, end: w.end - seg.start })),
        captions: true,
        music: music ? url(root, join(root, music)) : null,
        musicVolume: s.musicVolume,
        template: (video.template as TemplateId) ?? 'bold',
        headline: seg.headline.toUpperCase(),
        cta: {
          audio: url(root, ctaAudio),
          duration: ctaDuration,
          text: s.shortsCta,
          thumbnail: thumb && existsSync(thumb) ? url(root, thumb) : null,
          parentTitle: video.title ?? video.topic
        }
      }

      const short = createShort(
        video,
        seg.start,
        seg.end,
        seg.title.replace(/#\w+/g, '').trim().slice(0, 90),
        seg.description
      )
      const out = join(dir, `short_${short.id}.mp4`)
      ctx.log(
        `Short ${k + 1}/${segments.length}: "${short.title}" (${duration.toFixed(0)} s, cenas ${seg.first + 1}–${seg.last + 1})`
      )
      try {
        await runRender(
          { mode: 'short', root, out, short: props },
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
