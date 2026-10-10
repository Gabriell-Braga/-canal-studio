import { mkdirSync, readdirSync, rmSync } from 'fs'
import { join, relative } from 'path'
import { z } from 'zod'
import { THUMB_KIND_LABELS } from '../../shared/render'
import type { TemplateId, ThumbKind, ThumbnailProps } from '../../shared/render'
import { getVideo, listScenes, updateVideo } from '../db/repo'
import { freeComfy, generateImage } from '../services/comfy'
import { isValidFile, probeDuration, runTool } from '../services/ffmpeg'
import { download } from '../services/pexels'
import { pythonPost } from '../services/python'
import { searchAll, usableProviders } from '../services/stock'
import { generateStructured } from '../services/llm'
import { runRender } from '../services/remotion'
import { prepareComfy } from './scenes'
import type { Step, StepContext } from './types'

const conceptsSchema = z.object({
  company: z.string().default(''),
  concepts: z
    .array(
      z.object({ text: z.string().min(1), image: z.string().min(1), search: z.string().min(1) })
    )
    .min(3)
    .max(6)
})

/** AI concept images per run (each takes a while on the GPU) and stock photos to look for */
const AI_CONCEPTS = 3
const STOCK_PICKS = 2

function url(projectDir: string, file: string): string {
  return `{{root}}/${relative(projectDir, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

const DANGLING = new Set([
  'of',
  'the',
  'a',
  'an',
  'in',
  'to',
  'and',
  'for',
  'on',
  'at',
  'with',
  'by',
  'or',
  'from',
  'into',
  'their',
  'his',
  'her',
  'its',
  'our',
  'your',
  'my',
  'this',
  'that',
  'is',
  'was',
  'are',
  'were',
  'still'
])

/** Keep the headline at 2–4 words without ending on "of", "the"… */
export function clampWords(text: string): string {
  const words = text.replace(/["“”]/g, '').split(/\s+/).filter(Boolean).slice(0, 4)
  while (
    words.length > 2 &&
    DANGLING.has(words[words.length - 1].toLowerCase().replace(/\W/g, ''))
  ) {
    words.pop()
  }
  return words.join(' ')
}

/** Headline that names the company: a known name sells the click. Prepended when the LLM left it out. */
export function withCompany(text: string, company: string): string {
  const clamped = clampWords(text)
  if (!company || clamped.toLowerCase().includes(company.toLowerCase())) return clamped
  return clampWords(`${company} ${text}`)
}

/**
 * Cut the main subject out of a background. Returns null (the thumbnail falls back to text)
 * when the cut fails or finds no clear subject: too small to read, or most of the frame.
 */
async function cutoutFor(
  background: string,
  i: number,
  dir: string,
  ctx: StepContext
): Promise<{ file: string; textSide: 'left' | 'right' } | null> {
  try {
    const out = join(dir, `cutout_${i + 1}.png`)
    const { coverage, center_x } = await pythonPost<{ coverage: number; center_x?: number }>(
      '/cutout',
      { image_path: background, out_path: out },
      ctx.signal
    )
    // Text on the side away from the subject; AI images put the subject on the right.
    const textSide = (center_x ?? 1) < 0.5 ? 'right' : 'left'
    if (coverage >= 0.03 && coverage <= 0.75) return { file: out, textSide }
    ctx.log(`Thumbnail ${i + 1}: sem objeto claro para destacar`, 'warn')
  } catch (error) {
    ctx.log(
      `Recorte da thumbnail ${i + 1} falhou (${(error as Error).message}); sem versão destaque`,
      'warn'
    )
  }
  return null
}

/** Frame from a video file or URL (ffmpeg reads HTTP directly, so stock clips need no download). */
async function grabFrame(src: string, at: number, out: string, signal: AbortSignal): Promise<void> {
  await runTool(
    'ffmpeg',
    ['-y', '-ss', at.toFixed(2), '-i', src, '-frames:v', '1', '-q:v', '2', out],
    signal
  )
  if (!isValidFile(out)) throw new Error('quadro vazio')
}

/** One thumbnail background and where it came from. */
interface Background {
  file: string
  kind: ThumbKind
  /** Headline written for this image */
  text: string
}

/**
 * Layout per thumbnail, so neighbours in the grid never look alike:
 * 0 text left, 1 text right, 2 text top, 3 text in a color block, 4 split screen.
 */
export function layoutFor(kind: ThumbKind, n: number): number {
  const byKind: Record<ThumbKind, number[]> = {
    ai: [0, 3, 2],
    stock: [1, 3, 0],
    scene: [0, 2, 1],
    split: [4],
    highlight: [0],
    glow: [0]
  }
  const options = byKind[kind]
  return options[n % options.length]
}

export const thumbnailStep: Step = {
  type: 'thumbnail',
  status: 'THUMBNAIL',
  async run(videoId, ctx) {
    const video = getVideo(videoId)
    const s = ctx.settings
    const dir = join(ctx.projectDir, 'thumbs')
    mkdirSync(dir, { recursive: true })
    if (!isValidFile(video.video_path, 100_000)) throw new Error('Vídeo não renderizado')

    ctx.log('Pensando em ideias de thumbnail')
    const scenes = listScenes(videoId)
    const story = scenes
      .map((sc) => sc.narration)
      .join(' ')
      .slice(0, 1500)
    const { company, concepts } = await generateStructured(
      `You design YouTube thumbnails for a documentary video titled "${video.title ?? video.topic}" about: ${video.topic}.
Story excerpt: ${story}

First pick "company": the best-known company or brand at the heart of this story (e.g. "Amazon", "Nokia", "Blockbuster"), the one name viewers already recognize. Empty string only if no company is involved at all.

Give 4 different thumbnail concepts. Each concept is ONE quick message plus ONE image that sells it.
The FIRST concept's image is the company's iconic product, weathered to tell the story (Blockbuster: a dusty VHS tape; Nokia: a cracked old brick phone; Kodak: a faded film roll). One product, close up, no readable logos. Skip this only when there is no company.
For the others the image does NOT have to appear in the video: prefer a strong symbol or metaphor (an empty chair, a cracked crown, a sinking ship at night, a burning map) over a literal scene.
- "text": 2 to 4 words, punchy, creates curiosity, no clickbait lies, no emojis, no quotes. Use different angles (mystery, number/fact, emotion, consequence). EVERY text must contain the company name: a familiar name gets the click (our best video: "Amazon Before Amazon").
- "image": English prompt for an AI image generator: one clear subject, dramatic lighting, high contrast, subject on the right third with dark empty space on the left for text. No text or letters in the image.
- "search": 1 to 3 plain English words to find a matching photo in a stock photo library (e.g. "abandoned throne", "storm ocean").
Return ONLY JSON: {"company": "...", "concepts": [{"text": "...", "image": "...", "search": "..."}, ...]}`,
      conceptsSchema,
      { settings: s, signal: ctx.signal, temperature: 0.9 }
    )
    const texts = concepts.map((c) => withCompany(c.text, company.trim()))
    ctx.progress(0.1)

    const backgrounds: Background[] = []

    // 1) Concept images made by AI: they do not need to exist in the video.
    try {
      await prepareComfy(s, ctx.signal)
      for (const [i, c] of concepts.slice(0, AI_CONCEPTS).entries()) {
        if (ctx.signal.aborted) throw new Error('Cancelado')
        const out = join(dir, `bg_concept_${i + 1}.png`)
        try {
          await generateImage(`${c.image}, striking composition, empty space for text`, out, s, {
            signal: ctx.signal
          })
          backgrounds.push({ file: out, kind: 'ai', text: texts[i] })
        } catch (error) {
          if (ctx.signal.aborted) throw error
          ctx.log(`Imagem IA ${i + 1} da thumbnail falhou (${(error as Error).message})`, 'warn')
        }
        ctx.progress(0.1 + (0.4 * (i + 1)) / AI_CONCEPTS)
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error
      ctx.log(`Imagens IA da thumbnail indisponíveis (${(error as Error).message})`, 'warn')
    } finally {
      await freeComfy(s.comfyUrl)
    }

    // 2) Stock photos for the concept searches, never media already used in the video.
    const used = new Set(scenes.map((sc) => sc.asset_source).filter(Boolean) as string[])
    let stockFound = 0
    for (const [i, c] of concepts.entries()) {
      if (stockFound >= STOCK_PICKS || !usableProviders(s).length) break
      try {
        const found = await searchAll(c.search, 0, s, used, undefined, ctx.signal)
        // Images whose license asks for credit are skipped: a thumbnail has nowhere to put it.
        const pick =
          found.find((f) => f.kind === 'stock_photo' && !f.credit) ??
          found.find((f) => f.kind === 'stock_video' && !f.credit)
        if (!pick) continue
        used.add(pick.source)
        const out = join(dir, `bg_stock_${i + 1}.jpg`)
        if (pick.kind === 'stock_photo') await download(pick.url, out, ctx.signal)
        else await grabFrame(pick.url, Math.min(2, (pick.duration ?? 4) / 2), out, ctx.signal)
        backgrounds.push({ file: out, kind: 'stock', text: texts[i] })
        stockFound++
      } catch (error) {
        if (ctx.signal.aborted) throw error
        ctx.log(`Busca "${c.search}" para a thumbnail falhou (${(error as Error).message})`, 'warn')
      }
    }
    ctx.progress(0.6)

    // 3) Strong frames from the scene media (never from the final video, which has captions).
    const candidates = scenes.filter((sc) => isValidFile(sc.asset_path)).slice(1)
    const picks = [0.3, 0.65]
      .map((f) => candidates[Math.floor(f * (candidates.length - 1))])
      .filter((sc, i, all) => sc && all.indexOf(sc) === i)
    for (const [i, scene] of picks.entries()) {
      const asset = scene.asset_path as string
      const text = texts[(i + 1) % texts.length]
      if (scene.asset_type === 'stock_video' || scene.asset_type === 'ai_video') {
        const frame = join(dir, `bg_scene_${i}.jpg`)
        try {
          if (!isValidFile(frame)) {
            await grabFrame(asset, Math.min(2, (await probeDuration(asset)) / 2), frame, ctx.signal)
          }
          backgrounds.push({ file: frame, kind: 'scene', text })
        } catch (error) {
          if (ctx.signal.aborted) throw error
          ctx.log(`Quadro da cena para a thumbnail falhou (${(error as Error).message})`, 'warn')
        }
      } else backgrounds.push({ file: asset, kind: 'scene', text })
    }
    if (!backgrounds.length) throw new Error('Sem imagens para o fundo da thumbnail')
    ctx.progress(0.65)

    const template = (video.template as TemplateId) ?? 'documentary'
    const brand = {
      primary: s.brandPrimary,
      secondary: s.brandSecondary,
      font: s.brandFont,
      outline: s.brandOutline
    }
    const counts: Partial<Record<ThumbKind, number>> = {}
    const plan: { kind: ThumbKind; props: ThumbnailProps }[] = []
    const add = (
      kind: ThumbKind,
      props: {
        background: string
        background2?: string
        text: string
        cutout?: string
        textSide?: 'left' | 'right'
      }
    ): void => {
      const n = counts[kind] ?? 0
      counts[kind] = n + 1
      plan.push({ kind, props: { ...props, template, brand, variant: layoutFor(kind, n) } })
    }

    // "highlight" turns every image into the highlight style; "mixed" adds two of them.
    // Each highlight comes twice: without text and with the headline.
    const highlightAll = s.thumbStyle === 'highlight'
    const highlightOf = new Set<Background>()
    if (s.thumbStyle !== 'text') {
      const wanted = highlightAll
        ? backgrounds
        : [backgrounds.find((b) => b.kind === 'ai'), backgrounds.find((b) => b.kind !== 'ai')]
      for (const [i, b] of wanted.entries()) {
        if (!b) continue
        // No-text style: cut the subject out so only it gets the channel color.
        const cut = await cutoutFor(b.file, i, dir, ctx)
        if (cut) {
          highlightOf.add(b)
          const props = {
            background: url(ctx.projectDir, b.file),
            cutout: url(ctx.projectDir, cut.file),
            textSide: cut.textSide
          }
          add('highlight', { ...props, text: '' })
          add('glow', { ...props, text: b.text })
        }
      }
    }
    for (const b of backgrounds) {
      if (highlightAll && highlightOf.has(b)) continue
      add(b.kind, { background: url(ctx.projectDir, b.file), text: b.text })
    }
    // Split screen: a concept image against a real one, with the message in the middle.
    const left =
      backgrounds.find((b) => b.kind === 'scene') ?? backgrounds.find((b) => b.kind === 'stock')
    const right = backgrounds.find((b) => b.kind === 'ai' && b !== left)
    if (!highlightAll && left && right) {
      add('split', {
        background: url(ctx.projectDir, right.file),
        background2: url(ctx.projectDir, left.file),
        text: texts[3] ?? right.text
      })
    }
    ctx.progress(0.7)

    const stills = plan.map((p, i) => ({
      out: join(dir, `thumb_${i + 1}_${p.kind}.png`),
      props: p.props
    }))
    await runRender(
      { mode: 'stills', root: ctx.projectDir, out: '', stills },
      join(ctx.projectDir, 'thumb-job.json'),
      { progress: (p) => ctx.progress(0.7 + 0.3 * p), log: (m) => ctx.log(m), signal: ctx.signal }
    )
    updateVideo(videoId, { thumbnail_paths: stills.map((st) => st.out), chosen_thumbnail: 0 })
    // Thumbnails from an earlier run are no longer listed anywhere.
    const keep = new Set(stills.map((st) => st.out))
    for (const f of readdirSync(dir)) {
      if (f.startsWith('thumb_') && !keep.has(join(dir, f))) rmSync(join(dir, f), { force: true })
    }
    ctx.log(
      `${stills.length} thumbnails: ${plan.map((p) => `${THUMB_KIND_LABELS[p.kind]}${p.props.text ? ` "${p.props.text}"` : ''}`).join(', ')}`
    )
  }
}
