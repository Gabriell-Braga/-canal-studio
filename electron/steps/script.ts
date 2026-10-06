import { z } from 'zod'
import type { Script } from '../../shared/types'
import { getVideo, replaceScenes, updateVideo } from '../db/repo'
import { generateStructured, llmLabel, type LlmCall } from '../services/llm'
import type { Step, StepContext } from './types'

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
        quote: z.string().optional(),
        correction: z.string().optional(),
        source: z.string().optional()
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

const expandSchema = z.object({ narrations: z.array(z.string().min(1)) })

/**
 * Local models write far shorter scripts than asked (e.g. 377 words for an 8-minute target).
 * Rewrite scene narrations in batches until the script reaches ~90% of the target length.
 */
export async function expandScript(
  script: Script,
  targetWords: number,
  topic: string,
  call: LlmCall,
  ctx: Pick<StepContext, 'log' | 'signal'>
): Promise<void> {
  const BATCH = 6
  for (let round = 0; round < 3; round++) {
    const total = scriptWordCount(script)
    if (total >= targetWords * 0.85 || !script.scenes.length) return
    const fixed = scriptWordCount({ ...script, scenes: [] })
    const perScene = Math.min(
      60,
      Math.max(25, Math.round((targetWords - fixed) / script.scenes.length))
    )
    // The model writes ~60% of the words it is asked for, so ask for more and keep the longer text.
    const ask = Math.min(90, Math.round(perScene * 1.6))
    ctx.log(
      `Roteiro curto (${total}/${targetWords} palavras); expandindo cenas para ~${perScene} palavras`
    )
    const outline = script.scenes
      .map((sc, i) => `${i + 1}. ${sc.narration.slice(0, 120)}`)
      .join('\n')
    for (let start = 0; start < script.scenes.length; start += BATCH) {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      const batch = script.scenes.slice(start, start + BATCH)
      const numbered = batch.map((sc, i) => `SCENE ${start + i + 1}: ${sc.narration}`).join('\n')
      try {
        const { narrations } = await generateStructured(
          `You are expanding the narration of a YouTube documentary script about: ${topic}.
Full outline (for context, do not repeat other scenes):
${outline}

Rewrite EACH of the following scenes so its narration is about ${ask} words (at least ${perScene}). Keep the same facts, order and meaning; add concrete details, context and tension in short spoken sentences. Do not add greetings or "in this video". Do not invent precise numbers or quotes you are unsure about.
${numbered}

Return ONLY JSON: {"narrations": ["scene ${start + 1} text", ...]} with exactly ${batch.length} items.`,
          expandSchema,
          call
        )
        if (narrations.length === batch.length) {
          narrations.forEach((n, i) => {
            if (n.split(/\s+/).length > batch[i].narration.split(/\s+/).length) {
              batch[i].narration = n.trim()
            }
          })
        }
      } catch (error) {
        ctx.log(
          `Expansão das cenas ${start + 1}–${start + batch.length} falhou: ${(error as Error).message}`,
          'warn'
        )
      }
    }
  }
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
    const call: LlmCall = {
      settings,
      signal: ctx.signal,
      effort: 'high',
      // Ollama: ~1.4 tokens per word of output plus prompt and JSON overhead.
      numCtx: Math.min(32768, Math.max(8192, Math.round(words * 2.2) + 2048))
    }

    ctx.log(`Gerando roteiro com ${llmLabel(settings)} (~${words} palavras)`)
    const prompt = fillPrompt(settings.scriptPrompt, {
      topic,
      minutes,
      words,
      scenes: Math.max(3, Math.round((minutes * 60) / 15))
    })
    const script = await generateStructured(prompt, scriptSchema, call)
    ctx.log(`Primeira versão: ${script.scenes.length} cenas e ${scriptWordCount(script)} palavras`)
    ctx.progress(0.4)
    await expandScript(script, words, video.topic, call, ctx)
    ctx.progress(0.7)
    const count = scriptWordCount(script)
    ctx.log(`Roteiro com ${script.scenes.length} cenas e ${count} palavras`)

    // Claude can check the facts on the web; Ollama only flags what looks doubtful.
    const webCheck = settings.llmProvider !== 'ollama' && settings.factCheckWeb
    ctx.log(webCheck ? 'Checando fatos na web' : 'Rodando auto-revisão')
    let alerts: z.infer<typeof reviewSchema>['alerts'] = []
    try {
      const review = await generateStructured(
        fillPrompt(settings.reviewPrompt, { topic: video.topic, script: scriptAsText(script) }),
        reviewSchema,
        { ...call, temperature: 0.2, webSearch: webCheck, effort: 'medium' }
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
