import { z } from 'zod'
import type { Script } from '../../shared/types'
import { getVideo, replaceScenes, updateVideo } from '../db/repo'
import { generateJson } from '../services/ollama'
import type { Step } from './types'

export const scriptSchema = z.object({
  title_options: z.array(z.string().min(1)).min(1).max(5),
  hook: z.string().min(1),
  scenes: z
    .array(
      z.object({
        narration: z.string().min(1),
        visual_keywords: z.string(),
        image_prompt: z.string()
      })
    )
    .min(2),
  outro: z.string()
})

export const reviewSchema = z.object({
  alerts: z
    .array(
      z.object({
        kind: z.enum(['hook', 'pacing', 'repetition', 'dubious_fact', 'other']),
        message: z.string(),
        quote: z.string().optional()
      })
    )
    .max(12)
})

export function fillPrompt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
}

export function scriptWordCount(script: Script): number {
  const text = [script.hook, ...script.scenes.map((s) => s.narration), script.outro].join(' ')
  return text.split(/\s+/).filter(Boolean).length
}

export function scriptAsText(script: Script): string {
  return [
    `HOOK: ${script.hook}`,
    ...script.scenes.map((s, i) => `SCENE ${i + 1}: ${s.narration}`),
    `OUTRO: ${script.outro}`
  ].join('\n')
}

export const scriptStep: Step = {
  type: 'script',
  status: 'SCRIPT_GENERATING',
  async run(videoId, ctx) {
    const video = getVideo(videoId)
    const { settings } = ctx
    const minutes = video.duration_target_min
    const words = Math.round(minutes * 150)
    const topic = video.niche ? `${video.topic} (channel niche: ${video.niche})` : video.topic
    const ollama = {
      url: settings.ollamaUrl,
      model: settings.ollamaModel,
      // ~1.4 tokens per word of output plus prompt and JSON overhead.
      numCtx: Math.min(32768, Math.max(8192, Math.round(words * 2.2) + 2048)),
      signal: ctx.signal
    }

    ctx.log(`Gerando roteiro com ${settings.ollamaModel} (~${words} palavras)`)
    const prompt = fillPrompt(settings.scriptPrompt, {
      topic,
      minutes,
      words,
      scenes: Math.max(3, Math.round((minutes * 60) / 15))
    })
    const script = await generateJson(prompt, scriptSchema, ollama)
    ctx.progress(0.7)
    const count = scriptWordCount(script)
    ctx.log(`Roteiro com ${script.scenes.length} cenas e ${count} palavras`)

    ctx.log('Rodando auto-revisão')
    let alerts: z.infer<typeof reviewSchema>['alerts'] = []
    try {
      const review = await generateJson(
        fillPrompt(settings.reviewPrompt, { topic: video.topic, script: scriptAsText(script) }),
        reviewSchema,
        { ...ollama, temperature: 0.2 }
      )
      alerts = review.alerts
    } catch (error) {
      ctx.log(`Auto-revisão falhou: ${(error as Error).message}`, 'warn')
      alerts = [{ kind: 'other', message: 'A auto-revisão falhou; revise o roteiro manualmente.' }]
    }
    if (count < words * 0.7) {
      alerts.unshift({
        kind: 'pacing',
        message: `Roteiro curto: ${count} palavras (~${(count / 150).toFixed(1)} min) para uma meta de ${minutes} min.`
      })
    }

    replaceScenes(videoId, script)
    updateVideo(videoId, {
      script,
      title: script.title_options[0].slice(0, 100),
      title_options: script.title_options,
      review_alerts: alerts
    })
  }
}
