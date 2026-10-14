import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { extname, join, relative } from 'path'
import { z } from 'zod'
import { formatOf, type FormatPack } from '../../shared/formats'
import { THUMB, THUMB_CHECK, thumbProblems, thumbText, type ThumbReading } from '../../shared/thumb'
import { pythonPost } from '../services/python'
import { getState } from '../db/settings'
import { THUMB_KIND_LABELS, formatUsd } from '../../shared/render'
import type { ThumbnailProps } from '../../shared/render'
import type { FaceCheck, Video } from '../../shared/types'
import {
  checkIdentity,
  editExpression,
  expressionAvailable,
  findFacePhoto,
  PRESETS,
  type ExpressionPreset
} from '../services/faces'
import { getVideo, listScenes, listVideos, updateVideo } from '../db/repo'
import { perfPromptBlock } from '../services/youtube'
import { RECENT_TITLES, passingTitles } from '../../shared/titles'
import { freeComfy, generateImage } from '../services/comfy'
import { isValidFile, probeDuration, runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import { runRender } from '../services/remotion'
import { renderCompanies } from './overlays'
import { polishSettings } from './polish'
import { prepareComfy } from './scenes'
import type { Step, StepContext } from './types'

/** Model ids of the format, as a Zod enum. */
function modelIds(pack: FormatPack): [string, ...string[]] {
  return pack.thumbModels.map((m) => m.id) as [string, ...string[]]
}

interface ScoredTitle {
  title: string
  curiosity: number
  clarity: number
  distinct: number
}

interface PackAnswer {
  titles: ScoredTitle[]
  thumbs: {
    approach: string
    text: string
    image: string
    image2: string
    person: string
    emotion: string
  }[]
}

function packSchema(pack: FormatPack): z.ZodType<PackAnswer> {
  return z.object({
    titles: z
      .array(
        z.object({
          title: z.string().min(1),
          curiosity: z.number(),
          clarity: z.number(),
          distinct: z.number()
        })
      )
      .min(3)
      .max(10),
    thumbs: z
      .array(
        z.object({
          approach: z.enum(modelIds(pack)),
          text: z.string().min(1),
          image: z.string().min(1),
          image2: z.string().default(''),
          person: z.string().default(''),
          emotion: z.string().default('')
        })
      )
      .min(pack.thumbModels.length)
  }) as z.ZodType<PackAnswer>
}

/** Worn-out formula "X did Y. Then Z.": two sentences in one title */
const TWO_SENTENCES = /[.!?]\s+\S/

function url(projectDir: string, file: string): string {
  return `{{root}}/${relative(projectDir, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

const DANGLING = new Set(
  'of the a an in to and for on at with by or from into their his her its our your my this that is was are were still'.split(
    ' '
  )
)

/** Keep the headline at 2–4 words without ending on "of", "the"… */
export function clampWords(text: string, max = THUMB.maxWords): string {
  const words = text.replace(/["“”]/g, '').split(/\s+/).filter(Boolean).slice(0, max)
  while (
    words.length > 2 &&
    DANGLING.has(words[words.length - 1].toLowerCase().replace(/\W/g, ''))
  ) {
    words.pop()
  }
  return words.join(' ')
}

/**
 * Title options as YouTube shows them: no quotes, at most `max` characters, never the worn-out
 * "X did Y. Then Z." formula, no duplicates. Falls back to the shortened originals when the
 * model ignored every rule.
 */
export function cleanTitles(titles: string[], max = 60): string[] {
  const trim = (t: string): string => {
    const s = t.replace(/^["'“]|["'”]$/g, '').trim()
    return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, '')
  }
  const seen = new Set<string>()
  const ok = titles.map(trim).filter((t) => {
    const key = t.toLowerCase()
    if (!t || seen.has(key) || TWO_SENTENCES.test(t)) return false
    seen.add(key)
    return true
  })
  return ok.length ? ok : titles.map(trim).slice(0, 3)
}

/** The channel's last RECENT_TITLES long-video titles, newest first, without this video. */
export function recentTitles(video: Video): string[] {
  return listVideos(video.channel_id)
    .filter((v) => v.kind === 'long' && v.id !== video.id && v.title)
    .slice(0, RECENT_TITLES)
    .map((v) => v.title as string)
}

/**
 * Best titles first: cleaned, checked against the recent ones (same opening, same shape,
 * too similar, nothing concrete) and sorted by the model's curiosity + clarity + distinct
 * scores. Failing titles only come back when none passes.
 */
export function rankTitles(
  scored: ScoredTitle[],
  max: number,
  recent: string[],
  entities: string[]
): string[] {
  const total = (t: ScoredTitle): number => t.curiosity + t.clarity + t.distinct
  const clean = cleanTitles(
    [...scored].sort((a, b) => total(b) - total(a)).map((t) => t.title),
    max
  )
  return passingTitles(clean, recent, entities)
}

/** Frame from a video file (scene media), for when AI images are not available. */
async function grabFrame(src: string, at: number, out: string, signal: AbortSignal): Promise<void> {
  await runTool(
    'ffmpeg',
    ['-y', '-ss', at.toFixed(2), '-i', src, '-frames:v', '1', '-q:v', '2', out],
    signal
  )
  if (!isValidFile(out)) throw new Error('quadro vazio')
}

/** Scene images to fall back on, spread over the video; video scenes give one frame each. */
async function sceneBackgrounds(video: Video, dir: string, ctx: StepContext): Promise<string[]> {
  const scenes = listScenes(video.id).filter((sc) => isValidFile(sc.asset_path))
  const picks = [0.25, 0.5, 0.75, 0.9]
    .map((f) => scenes[Math.floor(f * (scenes.length - 1))])
    .filter((sc, i, all) => sc && all.indexOf(sc) === i)
  const out: string[] = []
  for (const [i, sc] of picks.entries()) {
    const asset = sc.asset_path as string
    if (sc.asset_type !== 'stock_video' && sc.asset_type !== 'ai_video') {
      out.push(asset)
      continue
    }
    const frame = join(dir, `bg_scene_${i}.jpg`)
    try {
      if (!isValidFile(frame)) {
        await grabFrame(asset, Math.min(2, (await probeDuration(asset)) / 2), frame, ctx.signal)
      }
      out.push(frame)
    } catch (error) {
      if (ctx.signal.aborted) throw error
    }
  }
  return out
}

/** The three thumbnails side by side at mobile feed size, to check they still read. */
export async function mobilePreview(
  files: string[],
  out: string,
  signal: AbortSignal
): Promise<void> {
  const { width, height } = THUMB.preview
  const scaled = files.map(
    (_, i) => `[${i}]scale=${width}:${height}:flags=lanczos,pad=iw+16:ih+16:8:8:white[s${i}]`
  )
  await runTool(
    'ffmpeg',
    [
      '-y',
      ...files.flatMap((f) => ['-i', f]),
      '-filter_complex',
      `${scaled.join(';')};${files.map((_, i) => `[s${i}]`).join('')}hstack=${files.length}`,
      '-frames:v',
      '1',
      out
    ],
    signal
  )
}

/** Problems of a thumbnail at feed size; none when the check cannot run (sidecar down). */
async function previewProblems(file: string, ctx: StepContext): Promise<string[]> {
  try {
    const r = await pythonPost<ThumbReading>(
      '/thumb_check',
      { image_path: file, width: THUMB.preview.width, height: THUMB.preview.height },
      ctx.signal
    )
    return thumbProblems(r)
  } catch (error) {
    if (ctx.signal.aborted) throw error
    ctx.log(`Checagem da prévia indisponível: ${(error as Error).message}`, 'warn')
    return []
  }
}

/**
 * A real, freely licensed photo of a public figure, its expression changed by editing that
 * photo (never a generated face), kept only when it is still recognizably the same person,
 * then cut out of its background. Null when no usable photo exists: the model goes faceless.
 */
async function realFace(
  person: string,
  emotion: ExpressionPreset,
  dir: string,
  ctx: StepContext
): Promise<{ cutout: string; check: FaceCheck } | null> {
  const s = ctx.settings
  const photo = await findFacePhoto(person, s, ctx.signal)
  if (!photo) {
    ctx.log(`Sem foto real utilizável de ${person}; thumbnail sem rosto`, 'warn')
    return null
  }
  const slug = person.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const original = join(dir, `face_${slug}${extname(photo.file) || '.jpg'}`)
  copyFileSync(photo.file, original)
  const check: FaceCheck = {
    person,
    original,
    edited: null,
    preset: emotion,
    similarity: null,
    ok: false,
    credit: photo.credit ?? null
  }
  let chosen = original
  if (await expressionAvailable(s)) {
    const edited = join(dir, `face_${slug}_${emotion}.png`)
    try {
      await prepareComfy(s, ctx.signal)
      await editExpression(original, emotion, edited, s, ctx.signal)
      const id = await checkIdentity(original, edited, ctx.signal)
      Object.assign(check, { edited, similarity: id.similarity, ok: id.ok })
      if (id.ok) chosen = edited
      else
        ctx.log(
          `Expressão editada de ${person} não parece a mesma pessoa (${id.similarity.toFixed(2)}); usando a foto original`,
          'warn'
        )
    } catch (error) {
      if (ctx.signal.aborted) throw error
      ctx.log(`Edição de expressão falhou (${(error as Error).message}); foto original`, 'warn')
    } finally {
      await freeComfy(s.comfyUrl)
    }
  } else {
    ctx.log('Editor de expressão não instalado (LivePortrait/InsightFace); foto original', 'warn')
  }
  const cutout = join(dir, `face_${slug}_cutout.png`)
  await pythonPost('/cutout', { image_path: chosen, out_path: cutout }, ctx.signal)
  return { cutout, check }
}

const EXPRESSIONS = Object.keys(PRESETS) as ExpressionPreset[]

/** Test & compare results needed before the winning model goes first. */
export const WINNER_AFTER_TESTS = 6

/**
 * The format's thumbnail models, the most frequent test winner first once the channel has
 * WINNER_AFTER_TESTS results. Every model is still made.
 */
export function orderModels(ids: string[], wins: Record<string, string>): string[] {
  const results = Object.values(wins).filter((m) => ids.includes(m))
  if (results.length < WINNER_AFTER_TESTS) return ids
  const count = (id: string): number => results.filter((m) => m === id).length
  const best = [...ids].sort((a, b) => count(b) - count(a))[0]
  return [best, ...ids.filter((id) => id !== best)]
}

export interface Packaging {
  titles: string[]
  thumbs: { approach: string; text: string; file: string }[]
  preview: string | null
  /** Real face used on a thumbnail, for the side-by-side check in the review */
  faceCheck: FaceCheck | null
}

/**
 * Title options and one thumbnail per approach, designed together so the thumbnail text adds
 * to the title instead of repeating it. Images go in the project's thumbs folder; the final
 * PNGs in `outDir`.
 */
export async function makePackaging(
  video: Video,
  ctx: StepContext,
  outDir: string,
  keepTitle?: string
): Promise<Packaging> {
  const dir = join(ctx.projectDir, 'thumbs')
  mkdirSync(dir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  const s = ctx.settings

  const companies = await renderCompanies(video, ctx)
  const facts = companies
    .filter((c) => c.values.length)
    .map(
      (c) =>
        `${c.name} value by year (checked): ${c.values.map((v) => `${v.year} $${formatUsd(v.usd)}`).join(', ')}`
    )
    .join('\n')
  const script = video.script
  const story = [script?.hook, ...listScenes(video.id).map((sc) => sc.narration)]
    .filter(Boolean)
    .join(' ')
    .slice(0, 3000)

  const format = formatOf(s.format)
  const tr = format.titleRules
  const recent = recentTitles(video)
  const entities = [
    video.topic,
    ...companies.map((c) => c.name),
    ...listScenes(video.id).map((sc) => sc.real_subject)
  ].filter(Boolean)
  const perf = perfPromptBlock(video.channel_id)
  ctx.log('Pensando em títulos e thumbnails')
  const pack = await generateStructured(
    `You package a YouTube documentary for the mobile home feed: title + thumbnail. Topic: ${video.topic}.
Story excerpt: ${story}
${facts ? `\nFacts you may use for numbers:\n${facts}\n` : ''}
1) "titles": ${tr.count} title options, each at most ${tr.maxChars} characters.
${tr.rules}
${tr.good.length ? `Tone examples (never copy their shape): ${tr.good.map((g) => `"${g}"`).join('; ')}\n` : ''}${tr.banned.length ? `Never use these shapes: ${tr.banned.map((b) => `"${b}"`).join('; ')}\n` : ''}Every title needs one concrete element: a name, a sum, an object or a quoted phrase.
Accurate, no clickbait lies, no emojis. ONE sentence per title: never the formula "X did Y. Then Z happened." or any title with two sentences.
Recent titles of this channel (never reuse their first words or their sentence shape): ${recent.join(' | ') || 'none'}
${perf ? `${perf}\n` : ''}Score each title from 1 to 10 on: curiosity (how much it makes you need to click), clarity (understood in one second on a phone), distinct (unlike the usual titles of this niche).
${keepTitle ? `The video keeps its title: "${keepTitle}". The thumbnails must work with THAT title.\n` : ''}
2) "thumbs": exactly ${format.thumbModels.length} thumbnails, one per approach, in this order:
${format.thumbModels.map((a) => `- "${a.id}": ${a.brief}`).join('\n')}
For each:
- "text": 0 to ${THUMB_CHECK.maxWords} words (a figure like "$250B → $0" counts as one idea; "" is fine when the image says it all). It must COMPLEMENT the ${keepTitle ? 'title' : 'first title'}, never repeat its words: if the title names the deal, the thumbnail shows the number; if the title asks why, the thumbnail shows the stakes. No quotes, no emojis.
- "image": English prompt for an AI image generator: ONE big, instantly recognizable subject (the real iconic object of the story as it looked then, or a famous place of the story), filling at least a third of the frame, subject on the right half. At most 2 main elements and 1 accent color. No sepia or vintage filter, no readable text or logos.
- "image2": only for "contrast": the ruin version of the same subject (empty, broken, grey). "" otherwise.
- "person": only for models that show a face (${
      format.thumbModels
        .filter((m) => m.face)
        .map((m) => `"${m.id}"`)
        .join(', ') || 'none'
    }): the full name of the real public historical figure at the center of the story (founder, CEO, maker), whose real photo will be used. "" otherwise or when there is none.
- "emotion": for those models, the expression that fits the story: laugh, shock, smug or worried. "" otherwise.
Return ONLY JSON: {"titles": [{"title": "...", "curiosity": 0, "clarity": 0, "distinct": 0}, ...], "thumbs": [{"approach": "...", "text": "...", "image": "...", "image2": "...", "person": "", "emotion": ""}]}`,
    packSchema(format),
    {
      settings: { ...polishSettings(s), claudeModel: 'opus' },
      signal: ctx.signal,
      temperature: 0.9,
      effort: 'medium'
    }
  )
  const titles = rankTitles(pack.titles, tr.maxChars, recent, entities).slice(0, 3)
  const layoutOf = (id: string): string => format.thumbModels.find((m) => m.id === id)?.layout ?? id
  const wins = getState<Record<string, string>>(`thumbWins.ch.${video.channel_id}`, {})
  const concepts = orderModels(modelIds(format), wins).map(
    (id) => pack.thumbs.find((t) => t.approach === id) ?? { ...pack.thumbs[0], approach: id }
  )
  ctx.progress(0.15)

  // AI images: one per thumbnail, two for the before/after split.
  const images = new Map<string, string>()
  const wanted = concepts.flatMap((c) => [
    { key: c.approach, prompt: c.image },
    ...(layoutOf(c.approach) === 'contrast'
      ? [{ key: 'contrast_2', prompt: c.image2 || `${c.image}, abandoned, ruined, grey` }]
      : [])
  ])
  try {
    await prepareComfy(s, ctx.signal)
    for (const [i, w] of wanted.entries()) {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      const out = join(dir, `bg_${w.key}.png`)
      try {
        await generateImage(`${w.prompt}, ${THUMB.imageStyle}`, out, s, { signal: ctx.signal })
        images.set(w.key, out)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        ctx.log(`Imagem IA "${w.key}" da thumbnail falhou (${(error as Error).message})`, 'warn')
      }
      ctx.progress(0.15 + (0.6 * (i + 1)) / wanted.length)
    }
  } catch (error) {
    if (ctx.signal.aborted) throw error
    ctx.log(`Imagens IA da thumbnail indisponíveis (${(error as Error).message})`, 'warn')
  } finally {
    await freeComfy(s.comfyUrl)
  }
  const fallback = images.size < wanted.length ? await sceneBackgrounds(video, dir, ctx) : []
  let next = 0
  const imageFor = (key: string): string => {
    const file = images.get(key) ?? fallback[next++ % Math.max(1, fallback.length)]
    if (!file) throw new Error('Sem imagens para o fundo da thumbnail')
    return file
  }

  // Real faces with an edited expression, only on the thumbnail (never inside the video).
  const faces = new Map<string, string>()
  let faceCheck: FaceCheck | null = null
  for (const c of concepts) {
    const model = format.thumbModels.find((m) => m.id === c.approach)
    if (!model?.face || !c.person.trim()) continue
    const emotion = (EXPRESSIONS as string[]).includes(c.emotion)
      ? (c.emotion as ExpressionPreset)
      : 'shock'
    try {
      const face = await realFace(c.person.trim(), emotion, dir, ctx)
      if (face) {
        faces.set(c.approach, face.cutout)
        faceCheck = face.check
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error
      ctx.log(`Rosto real indisponível (${(error as Error).message})`, 'warn')
    }
  }

  const headTitle = keepTitle ?? titles[0] ?? ''
  const stills = concepts.map((c, i) => {
    const props: ThumbnailProps = {
      approach: c.approach,
      layout: layoutOf(c.approach),
      format: format.id,
      background: url(ctx.projectDir, imageFor(c.approach)),
      background2:
        layoutOf(c.approach) === 'contrast' ? url(ctx.projectDir, imageFor('contrast_2')) : null,
      text: thumbText(c.text, headTitle),
      // No white logo plate: it shrinks the subject and reads as an ad.
      logo: null,
      face: faces.has(c.approach) ? url(ctx.projectDir, faces.get(c.approach) as string) : null
    }
    return { out: join(outDir, `thumb_${i + 1}_${c.approach}.png`), props }
  })
  await runRender(
    { mode: 'stills', root: ctx.projectDir, out: '', stills },
    join(ctx.projectDir, 'thumb-job.json'),
    { progress: (p) => ctx.progress(0.8 + 0.15 * p), log: (m) => ctx.log(m), signal: ctx.signal }
  )
  // Mobile-size check: a small subject or flat contrast gets a new, closer AI image.
  for (let round = 0; round < 2; round++) {
    const failing: typeof stills = []
    for (const st of stills) {
      const problems = await previewProblems(st.out, ctx)
      if (!problems.length) continue
      ctx.log(`Thumbnail ${st.props.approach} reprovada na prévia: ${problems.join('; ')}`, 'warn')
      const concept = concepts.find((c) => c.approach === st.props.approach)
      if (!concept) continue
      const out = join(dir, `bg_${concept.approach}_r${round + 1}.png`)
      try {
        await prepareComfy(s, ctx.signal)
        await generateImage(
          `${concept.image}, extreme close-up, the subject fills the frame, strong contrast against a plain contrasting background, ${THUMB.imageStyle}`,
          out,
          s,
          { signal: ctx.signal }
        )
        st.props = { ...st.props, background: url(ctx.projectDir, out) }
        failing.push(st)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        ctx.log(`Nova imagem da thumbnail falhou (${(error as Error).message})`, 'warn')
      }
    }
    await freeComfy(s.comfyUrl)
    if (!failing.length) break
    await runRender(
      { mode: 'stills', root: ctx.projectDir, out: '', stills: failing },
      join(ctx.projectDir, 'thumb-job.json'),
      { log: (m) => ctx.log(m), signal: ctx.signal }
    )
  }
  const preview = join(outDir, 'preview_mobile.png')
  try {
    await mobilePreview(
      stills.map((st) => st.out),
      preview,
      ctx.signal
    )
  } catch (error) {
    if (ctx.signal.aborted) throw error
    ctx.log(`Prévia mobile falhou (${(error as Error).message})`, 'warn')
  }
  return {
    titles,
    thumbs: stills.map((st) => ({
      approach: st.props.approach,
      text: st.props.text,
      file: st.out
    })),
    preview: isValidFile(preview) ? preview : null,
    faceCheck
  }
}

/** Plain-text summary of a packaging run, written next to exported thumbnails. */
export function packagingText(video: Video, pack: Packaging): string {
  return [
    `Vídeo: ${video.title ?? video.topic}`,
    video.youtube_id ? `YouTube: https://youtu.be/${video.youtube_id}` : '',
    '',
    'Títulos (melhor primeiro):',
    ...pack.titles.map((t, i) => `${i + 1}. ${t} (${t.length})`),
    '',
    'Thumbnails (para "Testar e comparar"):',
    ...pack.thumbs.map(
      (t) => `- ${t.file.split(/[\\/]/).pop()}: ${THUMB_KIND_LABELS[t.approach]} — "${t.text}"`
    )
  ]
    .filter((l, i, all) => l || all[i - 1])
    .join('\n')
}

/**
 * Title options and three thumbnails (shocking number, product, before/after). With
 * `exportDir` in the job args, writes them there with a titles file and leaves the video alone.
 */
export const thumbnailStep: Step = {
  type: 'thumbnail',
  status: 'THUMBNAIL',
  async run(videoId, ctx) {
    const video = getVideo(videoId)
    if (!isValidFile(video.video_path, 100_000) && !video.youtube_id) {
      throw new Error('Vídeo não renderizado')
    }
    const exportDir = ctx.jobArgs?.exportDir as string | undefined
    if (exportDir) {
      const pack = await makePackaging(video, ctx, exportDir)
      writeFileSync(join(exportDir, 'titulos.txt'), packagingText(video, pack), 'utf8')
      ctx.log(
        `Exportado para ${exportDir}: ${pack.titles.length} títulos, ${pack.thumbs.length} thumbnails`
      )
      return
    }
    // A video already on YouTube keeps its title: the thumbnails are made for it.
    const keepTitle = video.youtube_id ? (video.title ?? undefined) : undefined
    const dir = join(ctx.projectDir, 'thumbs')
    const pack = await makePackaging(video, ctx, dir, keepTitle)
    // The 3 best titles and the 3 thumbnails, ready for YouTube Studio's "Test & compare".
    writeFileSync(join(dir, 'titulos.txt'), packagingText(video, pack), 'utf8')
    updateVideo(videoId, {
      thumbnail_paths: pack.thumbs.map((t) => t.file),
      chosen_thumbnail: 0,
      title_options: pack.titles,
      face_check: pack.faceCheck,
      ...(keepTitle ? {} : { title: pack.titles[0] })
    })
    // Thumbnails from an earlier run are no longer listed anywhere.
    const keep = new Set(pack.thumbs.map((t) => t.file))
    for (const f of readdirSync(dir)) {
      if (f.startsWith('thumb_') && !keep.has(join(dir, f))) rmSync(join(dir, f), { force: true })
    }
    ctx.log(
      `Títulos: ${pack.titles.join(' | ')} · Thumbnails: ${pack.thumbs.map((t) => `${THUMB_KIND_LABELS[t.approach]} "${t.text}"`).join(', ')}`
    )
  }
}
