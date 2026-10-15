import { mkdirSync, rmSync } from 'fs'
import { join, relative } from 'path'
import { z } from 'zod'
import { formatOf } from '../../shared/formats'
import type { RenderWord, ShortProps, TemplateId } from '../../shared/render'
import type { Video } from '../../shared/types'
import { createShort, listScenes, updateVideo } from '../db/repo'
import { freeComfy, generateImage } from '../services/comfy'
import { concatAndNormalize, isValidFile, probeDuration } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import { pythonPost } from '../services/python'
import { runRender } from '../services/remotion'
import { fetchCandidate, gatherCandidates, searchReal } from '../services/stock'
import { sceneFocus } from './focus'
import { prepareComfy } from './scenes'
import type { StepContext } from './types'

/** Seconds of a short: long enough to land one idea, short enough to be watched twice. */
export const SHORT_MIN_SEC = 20
export const SHORT_MAX_SEC = 35
/** Kokoro reads about 2.6 words per second at speed 1 */
const WORDS_PER_SEC = 2.6
const LINE_PAUSE = 0.15

const shortsSchema = z.object({
  shorts: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string(),
      headline: z.string().min(1),
      ending: z.enum(['loop', 'cliffhanger']),
      lines: z
        .array(
          z.object({
            text: z.string().min(1),
            visual_keywords: z.string(),
            real_subject: z.string()
          })
        )
        .min(3)
        .max(8)
    })
  )
})

export type ShortScript = z.infer<typeof shortsSchema>['shorts'][number]

/**
 * Word timings for lines read back to back: each line's words share its spoken length in
 * proportion to their letters. Good enough for word-by-word captions without Whisper.
 */
export function lineWords(lines: string[], durations: number[], pause: number): RenderWord[] {
  const out: RenderWord[] = []
  let t = 0
  lines.forEach((line, i) => {
    const words = line.split(/\s+/).filter(Boolean)
    const letters = words.reduce((n, w) => n + w.length + 1, 0)
    let at = t
    for (const w of words) {
      const len = (durations[i] * (w.length + 1)) / Math.max(1, letters)
      out.push({ word: w, start: at, end: at + len })
      at += len
    }
    t += durations[i] + pause
  })
  return out
}

function url(root: string, file: string): string {
  return `{{root}}/${relative(root, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

/** One line in the channel's voice. */
async function speakLine(text: string, out: string, ctx: StepContext): Promise<number> {
  const s = ctx.settings
  if (!isValidFile(out)) {
    await pythonPost(
      '/tts',
      { text, voice: s.voice, speed: s.voiceSpeed, out_path: out },
      ctx.signal
    )
  }
  return probeDuration(out)
}

/**
 * Media for one line: a real photo of what it names, then the banks, then a vertical AI
 * image of a generic subject. Never a crop of the long video.
 */
async function lineMedia(
  line: ShortScript['lines'][number],
  out: string,
  used: Set<string>,
  ctx: StepContext
): Promise<{ file: string; type: 'image' | 'video'; source: string } | null> {
  const s = ctx.settings
  try {
    const real = await searchReal(line.real_subject, s, used, undefined, ctx.signal)
    const stock = await gatherCandidates(line.visual_keywords, 4, s, used, 3, undefined, ctx.signal)
    const pick = [...real, ...stock].find((c) => !used.has(c.source))
    if (pick) {
      const file = `${out}${pick.kind === 'stock_video' ? '.mp4' : '.jpg'}`
      if (!isValidFile(file)) await fetchCandidate(pick, file, ctx.signal)
      used.add(pick.source)
      return { file, type: pick.kind === 'stock_video' ? 'video' : 'image', source: pick.source }
    }
  } catch (error) {
    if (ctx.signal.aborted) throw error
  }
  if (line.real_subject) return null
  const file = `${out}_ai.png`
  try {
    if (!isValidFile(file)) {
      await prepareComfy(s, ctx.signal)
      await generateImage(line.visual_keywords || line.text, file, s, {
        width: 768,
        height: 1344,
        signal: ctx.signal
      })
    }
    return { file, type: 'image', source: 'comfyui' }
  } catch (error) {
    if (ctx.signal.aborted) throw error
    return null
  }
}

/**
 * Original vertical shorts for a finished video: their own script, narration and media,
 * 20–35 s, the strongest line first with text on screen, ending either in a loop back to
 * the first line or in a cliffhanger that sends viewers to the full video, never both.
 */
export async function makeOwnShorts(
  video: Video,
  count: number,
  ctx: StepContext,
  cta: ShortProps['cta'],
  music: string | null
): Promise<number> {
  const s = ctx.settings
  const pack = formatOf(s.format)
  const rules = pack.shortsRules
  const script = video.script
  const story = [script?.hook, ...listScenes(video.id).map((sc) => sc.narration)]
    .filter(Boolean)
    .join(' ')
    .slice(0, 6000)
  const minWords = Math.round(SHORT_MIN_SEC * WORDS_PER_SEC)
  const maxWords = Math.round(SHORT_MAX_SEC * WORDS_PER_SEC * 0.92)
  ctx.log(`Escrevendo ${count} short(s) com roteiro próprio`)
  const { shorts } = await generateStructured(
    `Write ${count} original YouTube Shorts drawn from this documentary ("${video.title ?? video.topic}"). Each short is NOT a clip of the video: it is its own tiny script, read by the narrator over vertical images.
Story:
${story}

Rules for each short:
- ${minWords}–${maxWords} words in total (${SHORT_MIN_SEC}–${SHORT_MAX_SEC} seconds), in 3–6 lines; each line is one spoken sentence and gets its own image.
- Line 1 is the single strongest, most surprising claim, at most ${rules.hookMaxWords} words, with no build-up.
- headline: 2–6 words shown huge from the very first frame, naming the subject (a product, a person, a sum).
- ending: "loop" or "cliffhanger", never both. loop: the last line flows straight back into line 1 so the short replays seamlessly, no call to action. cliffhanger: the last line stops right before the answer, which only the full video gives.
- One idea per short, each short about a different moment of the story.
- For each line: visual_keywords (2–4 English words for a stock search) and real_subject (exact name of a real person, object or event shown, for Wikimedia; "" for generic images).
- title: max 60 characters, no hashtags; description: one sentence.
What works for this channel: ${rules.brief}
Return ONLY JSON: {"shorts": [{"title": "...", "description": "...", "headline": "...", "ending": "loop", "lines": [{"text": "...", "visual_keywords": "...", "real_subject": ""}]}]}`,
    shortsSchema,
    { settings: s, signal: ctx.signal, temperature: 0.7, effort: 'medium' }
  )

  const root = ctx.projectDir
  const used = new Set<string>()
  let made = 0
  try {
    for (const [k, sh] of shorts.slice(0, count).entries()) {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      const short = createShort(
        video,
        0,
        0,
        sh.title.replace(/#\w+/g, '').trim().slice(0, 90),
        sh.description
      )
      const dir = join(root, 'shorts', `own_${short.id}`)
      mkdirSync(dir, { recursive: true })
      const out = join(root, 'shorts', `short_${short.id}.mp4`)
      try {
        const files = sh.lines.map((_, i) => join(dir, `line_${i}.wav`))
        const durations: number[] = []
        for (const [i, line] of sh.lines.entries())
          durations.push(await speakLine(line.text, files[i], ctx))
        const narration = join(dir, 'narration.wav')
        await concatAndNormalize(files, LINE_PAUSE, narration, dir, ctx.signal)
        const total = await probeDuration(narration)
        const scenes: ShortProps['scenes'] = []
        let t = 0
        for (const [i, line] of sh.lines.entries()) {
          const media = await lineMedia(line, join(dir, `media_${i}`), used, ctx)
          const end = i === sh.lines.length - 1 ? total : t + durations[i] + LINE_PAUSE
          if (media) {
            scenes.push({
              src: url(root, media.file),
              type: media.type,
              start: t,
              end,
              motion: (i + k) % 4,
              clipDuration: media.type === 'video' ? await probeDuration(media.file) : undefined,
              focus: media.type === 'image' ? await sceneFocus(media.file, ctx) : undefined
            })
          } else if (scenes.length) {
            scenes[scenes.length - 1].end = end
          }
          t = end
        }
        if (!scenes.length) throw new Error('Nenhuma imagem para o short')
        scenes[0].start = 0
        const props: ShortProps = {
          fps: 30,
          segmentStart: 0,
          segmentDuration: total,
          narration: url(root, narration),
          cuts: [{ from: 0, to: total, at: 0 }],
          scenes,
          words: lineWords(
            sh.lines.map((l) => l.text),
            durations,
            LINE_PAUSE
          ),
          captions: true,
          music,
          musicVolume: s.musicVolume,
          template: (video.template as TemplateId) ?? 'bold',
          brand: {
            primary: s.brandPrimary,
            secondary: s.brandSecondary,
            font: s.brandFont,
            outline: s.brandOutline
          },
          headline: sh.headline.toUpperCase(),
          ending: sh.ending,
          cta
        }
        ctx.log(
          `Short ${k + 1}/${shorts.length}: "${short.title}" (${total.toFixed(0)} s, final ${sh.ending === 'loop' ? 'em loop' : 'em cliffhanger'})`
        )
        await runRender(
          { mode: 'short', root, out, short: props, framed: true, extended: true },
          join(root, 'shorts', `short_${short.id}.json`),
          {
            progress: (p) => ctx.progress(0.1 + (0.9 * (k + p)) / shorts.length),
            signal: ctx.signal
          }
        )
        updateVideo(short.id, { video_path: out, status: 'FINAL_REVIEW' })
        made++
      } catch (error) {
        rmSync(out, { force: true })
        updateVideo(short.id, {
          status: 'ERROR',
          error_message: (error as Error).message,
          error_step: 'short'
        })
        throw error
      }
    }
  } finally {
    await freeComfy(s.comfyUrl)
  }
  return made
}
