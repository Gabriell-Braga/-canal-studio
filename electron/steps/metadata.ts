import { z } from 'zod'
import type { Scene } from '../../shared/types'
import { getVideo, listScenes, listVideos, updateVideo } from '../db/repo'
import { formatOf } from '../../shared/formats'
import { generateStructured } from '../services/llm'
import type { Step } from './types'

const metaSchema = z.object({
  description: z.string().min(1),
  tags: z.array(z.string()).min(5).max(20),
  chapter_titles: z.array(z.string()).optional(),
  series: z.string().default('')
})

export interface Chapter {
  start: number
  scenes: Scene[]
}

/**
 * Group scenes into chapters of roughly equal length. YouTube needs at least 3 chapters,
 * the first at 0:00 and each at least 10 s long; otherwise we return none.
 */
export function buildChapters(scenes: Scene[]): Chapter[] {
  const total = scenes.at(-1)?.end_sec ?? 0
  if (total < 60 || scenes.length < 3) return []
  const target = Math.min(150, Math.max(45, total / 6))
  const chapters: Chapter[] = []
  for (const scene of scenes) {
    const current = chapters.at(-1)
    if (!current || (scene.start_sec ?? 0) - current.start >= target) {
      chapters.push({ start: chapters.length ? (scene.start_sec ?? 0) : 0, scenes: [scene] })
    } else current.scenes.push(scene)
  }
  // Merge a short last chapter into the previous one.
  const last = chapters.at(-1)
  if (chapters.length > 1 && last && total - last.start < 20) {
    chapters[chapters.length - 2].scenes.push(...last.scenes)
    chapters.pop()
  }
  return chapters.length >= 3 ? chapters : []
}

export function timestamp(sec: number): string {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const metadataStep: Step = {
  type: 'metadata',
  status: 'THUMBNAIL',
  async run(videoId, ctx) {
    const video = getVideo(videoId)
    const s = ctx.settings
    const chapters = buildChapters(listScenes(videoId))
    const chapterText = chapters
      .map(
        (c, i) =>
          `CHAPTER ${i + 1} (${timestamp(c.start)}): ${c.scenes
            .map((sc) => sc.narration)
            .join(' ')
            .slice(0, 600)}`
      )
      .join('\n')

    // The title comes from the thumbnail step, made together with the thumbnails.
    const title = (video.title ?? video.script?.title_options[0] ?? video.topic).slice(0, 100)
    const pack = formatOf(s.format)
    const seriesOptions = [
      ...new Set([
        ...pack.metadataRules.series,
        ...listVideos(video.channel_id)
          .map((v) => v.series)
          .filter((x): x is string => !!x)
      ])
    ]
    ctx.log('Gerando descrição e tags')
    const meta = await generateStructured(
      `You write YouTube metadata for a faceless documentary channel.
Topic: ${video.topic}
Title: ${title}
Hook: ${video.script?.hook ?? ''}
${chapters.length ? `Chapters:\n${chapterText}` : ''}

Return JSON with:
- description: ${pack.metadataRules.description} Do NOT include timestamps, hashtags or a sources list (added separately).
- tags: 10 to 15 search tags, lowercase, most specific first
${chapters.length ? `- chapter_titles: exactly ${chapters.length} short chapter titles (2–6 words), in order` : ''}
- series: the named series this video belongs to, one of: ${seriesOptions.join(' | ') || 'none yet'}. Use a new short name (2–4 words) only when none fits.`,
      metaSchema,
      { settings: s, signal: ctx.signal, temperature: 0.6 }
    )

    let description = meta.description.trim()
    if (chapters.length) {
      const names = meta.chapter_titles ?? []
      const lines = chapters.map(
        (c, i) => `${timestamp(c.start)} ${names[i]?.trim() || `Part ${i + 1}`}`
      )
      description += `\n\nChapters\n${lines.join('\n')}`
    }
    const claims = (Array.isArray(video.script?.claims) ? video.script.claims : []) as {
      quote: string
      verdict: string
      source: string
    }[]
    const checked = claims.filter((c) => c.source?.trim())
    if (checked.length)
      description += `\n\nClaim Check\n${checked.map((c) => `- "${c.quote}": ${c.verdict} (${c.source})`).join('\n')}`
    const sources = video.script?.sources ?? []
    if (sources.length)
      description += `\n\nSources\n${sources.map((x) => `- ${x.claim}: ${x.source}`).join('\n')}`
    // Licenses like CC BY require crediting the author where the work is used.
    const credits = [
      ...new Set(
        listScenes(videoId)
          .flatMap((sc) => [sc.asset_credit, ...sc.extra_assets.map((x) => x.credit)])
          .filter(Boolean)
      )
    ]
    if (credits.length)
      description += `\n\nImage credits\n${credits.map((c) => `- ${c}`).join('\n')}`
    const tags = [...new Set(meta.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(
      0,
      15
    )
    const series = video.series ?? (meta.series.trim().slice(0, 60) || null)
    updateVideo(videoId, { title, description, tags, series })
    ctx.log(`Metadados: "${title}" · ${tags.length} tags · ${chapters.length} capítulos`)
  }
}
