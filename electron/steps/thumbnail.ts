import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { z } from 'zod'
import { THUMB, TITLES, type ThumbApproach } from '../../shared/growth'
import { THUMB_KIND_LABELS, formatUsd } from '../../shared/render'
import type { ThumbnailProps } from '../../shared/render'
import type { Video } from '../../shared/types'
import { getVideo, listScenes, updateVideo } from '../db/repo'
import { freeComfy, generateImage } from '../services/comfy'
import { isValidFile, probeDuration, runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import { runRender } from '../services/remotion'
import { renderCompanies } from './overlays'
import { polishSettings } from './polish'
import { prepareComfy } from './scenes'
import type { Step, StepContext } from './types'

const APPROACHES = THUMB.approaches.map((a) => a.id) as [ThumbApproach, ...ThumbApproach[]]

const packSchema = z.object({
  titles: z.array(z.string().min(1)).min(3).max(8),
  thumbs: z
    .array(
      z.object({
        approach: z.enum(APPROACHES),
        text: z.string().min(1),
        image: z.string().min(1),
        image2: z.string().default('')
      })
    )
    .min(APPROACHES.length)
})

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
 * Title options as YouTube shows them: no quotes, at most TITLES.maxChars, never the worn-out
 * "X did Y. Then Z." formula, no duplicates. Falls back to the shortened originals when the
 * model ignored every rule.
 */
export function cleanTitles(titles: string[], max = TITLES.maxChars): string[] {
  const trim = (t: string): string => {
    const s = t.replace(/^["'“]|["'”]$/g, '').trim()
    return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, '')
  }
  const seen = new Set<string>()
  const ok = titles.map(trim).filter((t) => {
    const key = t.toLowerCase()
    if (!t || seen.has(key) || TITLES.banned.test(t)) return false
    seen.add(key)
    return true
  })
  return ok.length ? ok : titles.map(trim).slice(0, 3)
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

export interface Packaging {
  titles: string[]
  thumbs: { approach: ThumbApproach; text: string; file: string }[]
  preview: string | null
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

  ctx.log('Pensando em títulos e thumbnails')
  const pack = await generateStructured(
    `You package a YouTube business documentary for the mobile home feed: title + thumbnail. Topic: ${video.topic}.
Story excerpt: ${story}
${facts ? `\nFacts you may use for numbers:\n${facts}\n` : ''}
1) "titles": ${TITLES.count} title options, each at most ${TITLES.maxChars} characters, each with a DIFFERENT structure:
${TITLES.structures.map((t) => `- ${t}`).join('\n')}
Prefer specific curiosity (numbers, dates, names) over generic phrases. Accurate, no clickbait lies, no emojis. ONE sentence per title: never the formula "X did Y. Then Z happened." or any title with two sentences. Best option first.
${keepTitle ? `The video keeps its title: "${keepTitle}". The thumbnails must work with THAT title.\n` : ''}
2) "thumbs": exactly ${APPROACHES.length} thumbnails, one per approach, in this order:
${THUMB.approaches.map((a) => `- "${a.id}": ${a.brief}`).join('\n')}
For each:
- "text": 2 to ${THUMB.maxWords} words (a figure like "$250B → $0" counts as one idea). It must COMPLEMENT the ${keepTitle ? 'title' : 'first title'}, never repeat its words: if the title names the deal, the thumbnail shows the number; if the title asks why, the thumbnail shows the stakes. The company logo is shown next to it, so the text does not need the company name. No quotes, no emojis.
- "image": English prompt for an AI image generator: ONE big, instantly recognizable subject (the company's real iconic product as it looked then, its storefront, or a famous object of the story), filling most of the frame, subject on the right half. No readable text or logos.
- "image2": only for "contrast": the ruin version of the same subject (empty, broken, grey). "" otherwise.
Return ONLY JSON: {"titles": [...], "thumbs": [{"approach": "...", "text": "...", "image": "...", "image2": "..."}]}`,
    packSchema,
    {
      settings: { ...polishSettings(s), claudeModel: 'opus' },
      signal: ctx.signal,
      temperature: 0.9,
      effort: 'medium'
    }
  )
  const titles = cleanTitles(pack.titles)
  const concepts = APPROACHES.map(
    (id) => pack.thumbs.find((t) => t.approach === id) ?? { ...pack.thumbs[0], approach: id }
  )
  ctx.progress(0.15)

  // AI images: one per thumbnail, two for the before/after split.
  const images = new Map<string, string>()
  const wanted = concepts.flatMap((c) => [
    { key: c.approach, prompt: c.image },
    ...(c.approach === 'contrast'
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

  const logo = companies.find((c) => c.logo)?.logo ?? null
  const stills = concepts.map((c, i) => {
    const props: ThumbnailProps = {
      approach: c.approach,
      background: url(ctx.projectDir, imageFor(c.approach)),
      background2: c.approach === 'contrast' ? url(ctx.projectDir, imageFor('contrast_2')) : null,
      text: clampWords(c.text),
      logo
    }
    return { out: join(outDir, `thumb_${i + 1}_${c.approach}.png`), props }
  })
  await runRender(
    { mode: 'stills', root: ctx.projectDir, out: '', stills },
    join(ctx.projectDir, 'thumb-job.json'),
    { progress: (p) => ctx.progress(0.8 + 0.15 * p), log: (m) => ctx.log(m), signal: ctx.signal }
  )
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
    preview: isValidFile(preview) ? preview : null
  }
}

/** Plain-text summary of a packaging run, written next to exported thumbnails. */
export function packagingText(video: Video, pack: Packaging): string {
  return [
    `Vídeo: ${video.title ?? video.topic}`,
    video.youtube_id ? `YouTube: https://youtu.be/${video.youtube_id}` : '',
    '',
    `Títulos (até ${TITLES.maxChars} caracteres, melhor primeiro):`,
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
    updateVideo(videoId, {
      thumbnail_paths: pack.thumbs.map((t) => t.file),
      chosen_thumbnail: 0,
      title_options: pack.titles,
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
