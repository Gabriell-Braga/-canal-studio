import { z } from 'zod'
import type { Scene } from '../../shared/types'
import { getVideo, listScenes, updateVideo } from '../db/repo'
import { generateJson } from '../services/ollama'
import type { Step } from './types'

const metaSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).min(5).max(20),
  chapter_titles: z.array(z.string()).optional()
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

    ctx.log('Gerando título, descrição e tags')
    const meta = await generateJson(
      `You write YouTube metadata for a faceless documentary channel.
Topic: ${video.topic}
Title ideas from the script: ${(video.script?.title_options ?? [video.title]).join(' | ')}
Hook: ${video.script?.hook ?? ''}
${chapters.length ? `Chapters:\n${chapterText}` : ''}

Return JSON with:
- title: the best final title, max 70 characters, curiosity-driven, accurate, no clickbait lies, no emojis
- description: 2 short paragraphs (max 900 characters total) that summarize the story and make people want to watch; end with one line inviting viewers to subscribe. Do NOT include timestamps or hashtags.
- tags: 10 to 15 search tags, lowercase, most specific first
${chapters.length ? `- chapter_titles: exactly ${chapters.length} short chapter titles (2–6 words), in order` : ''}`,
      metaSchema,
      { url: s.ollamaUrl, model: s.ollamaModel, signal: ctx.signal, temperature: 0.6 }
    )

    let title = meta.title.replace(/^["']|["']$/g, '').trim()
    if (title.length > 70) title = title.slice(0, 70).replace(/\s+\S*$/, '')
    let description = meta.description.trim()
    if (chapters.length) {
      const names = meta.chapter_titles ?? []
      const lines = chapters.map(
        (c, i) => `${timestamp(c.start)} ${names[i]?.trim() || `Part ${i + 1}`}`
      )
      description += `\n\nChapters\n${lines.join('\n')}`
    }
    // Licenses like CC BY require crediting the author where the work is used.
    const credits = [
      ...new Set(
        listScenes(videoId)
          .map((sc) => sc.asset_credit)
          .filter(Boolean)
      )
    ]
    if (credits.length)
      description += `\n\nImage credits\n${credits.map((c) => `- ${c}`).join('\n')}`
    const tags = [...new Set(meta.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(
      0,
      15
    )
    updateVideo(videoId, { title, description, tags })
    ctx.log(`Metadados: "${title}" · ${tags.length} tags · ${chapters.length} capítulos`)
  }
}
