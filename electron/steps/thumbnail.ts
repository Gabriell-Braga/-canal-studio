import { mkdirSync } from 'fs'
import { join, relative } from 'path'
import { z } from 'zod'
import type { TemplateId, ThumbnailProps } from '../../shared/render'
import { getVideo, listScenes, updateVideo } from '../db/repo'
import { freeComfy, generateImage } from '../services/comfy'
import { isValidFile, probeDuration, runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import { runRender } from '../services/remotion'
import { prepareComfy } from './scenes'
import type { Step } from './types'

const textsSchema = z.object({ texts: z.array(z.string().min(1)).min(3).max(5) })

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

export const thumbnailStep: Step = {
  type: 'thumbnail',
  status: 'THUMBNAIL',
  async run(videoId, ctx) {
    const video = getVideo(videoId)
    const s = ctx.settings
    const dir = join(ctx.projectDir, 'thumbs')
    mkdirSync(dir, { recursive: true })
    if (!isValidFile(video.video_path, 100_000)) throw new Error('Vídeo não renderizado')

    ctx.log('Gerando textos da thumbnail')
    const { texts } = await generateStructured(
      `Write 3 different YouTube thumbnail headlines for a documentary video titled "${video.title ?? video.topic}" about: ${video.topic}.
Each headline: 2 to 4 words, punchy, creates curiosity, no clickbait lies, no emojis, no quotes. Use different angles (mystery, number/fact, emotion).
Return ONLY JSON: {"texts": ["...", "...", "..."]}`,
      textsSchema,
      { settings: s, signal: ctx.signal, temperature: 0.9 }
    )
    ctx.progress(0.2)

    // Background 1: a dedicated AI image; 2 and 3: strong frames from the video.
    const backgrounds: string[] = []
    const scenes = listScenes(videoId)
    const prompt = scenes.find((sc) => sc.image_prompt)?.image_prompt ?? video.topic
    try {
      await prepareComfy(s, ctx.signal)
      const ai = join(dir, 'bg_ai.png')
      if (!isValidFile(ai)) {
        await generateImage(
          `${prompt}, dramatic close-up, high contrast, striking composition, empty space on one side`,
          ai,
          s,
          {
            signal: ctx.signal
          }
        )
      }
      backgrounds.push(ai)
    } catch (error) {
      ctx.log(
        `Imagem IA da thumbnail falhou (${(error as Error).message}); usando quadros do vídeo`,
        'warn'
      )
    } finally {
      await freeComfy(s.comfyUrl)
    }
    // Other backgrounds come from the scene media (never from the final video, which has captions).
    const candidates = scenes.filter((sc) => isValidFile(sc.asset_path)).slice(1)
    const picks = [0.3, 0.65, 0.9]
      .map((f) => candidates[Math.floor(f * (candidates.length - 1))])
      .filter(Boolean)
    for (const [i, scene] of picks.entries()) {
      if (backgrounds.length >= 3) break
      const asset = scene.asset_path as string
      if (scene.asset_type === 'stock_video' || scene.asset_type === 'ai_video') {
        const frame = join(dir, `bg_scene_${i}.jpg`)
        if (!isValidFile(frame)) {
          const at = Math.min(2, (await probeDuration(asset)) / 2)
          await runTool(
            'ffmpeg',
            ['-y', '-ss', at.toFixed(2), '-i', asset, '-frames:v', '1', '-q:v', '2', frame],
            ctx.signal
          )
        }
        backgrounds.push(frame)
      } else if (!backgrounds.includes(asset)) backgrounds.push(asset)
    }
    if (!backgrounds.length) throw new Error('Sem imagens para o fundo da thumbnail')
    ctx.progress(0.6)

    const template = (video.template as TemplateId) ?? 'documentary'
    const stills = [0, 1, 2].map((i) => ({
      out: join(dir, `thumb_${i + 1}.png`),
      props: {
        background: url(ctx.projectDir, backgrounds[i % backgrounds.length]),
        text: clampWords(texts[i]),
        template,
        brand: { primary: s.brandPrimary, secondary: s.brandSecondary, font: s.brandFont },
        variant: i
      } satisfies ThumbnailProps
    }))
    await runRender(
      { mode: 'stills', root: ctx.projectDir, out: '', stills },
      join(ctx.projectDir, 'thumb-job.json'),
      { progress: (p) => ctx.progress(0.6 + 0.4 * p), log: (m) => ctx.log(m), signal: ctx.signal }
    )
    updateVideo(videoId, { thumbnail_paths: stills.map((st) => st.out), chosen_thumbnail: 0 })
    ctx.log(`3 thumbnails: ${stills.map((st) => `"${st.props.text}"`).join(', ')}`)
  }
}
