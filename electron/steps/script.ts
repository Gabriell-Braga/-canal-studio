import { z } from 'zod'
import type { Script, Video } from '../../shared/types'
import { getVideo, listVideos, replaceScenes, updateVideo } from '../db/repo'
import {
  formatOf,
  hasOverlay,
  nextStructure,
  scriptSchemaFor,
  structureRules,
  type FormatPack
} from '../../shared/formats'
import { formatUsd } from '../../shared/render'
import { generateStructured, llmLabel, type LlmCall } from '../services/llm'
import { polishScript } from './polish'
import type { Step } from './types'

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
  const companies = (script.companies ?? []).map(
    (c) =>
      `COMPANY VALUE SHOWN ON SCREEN, ${c.name}: ${c.values.map((v) => `${v.year} $${formatUsd(v.usd)}`).join(', ')}`
  )
  return [
    `HOOK: ${script.hook}`,
    ...script.scenes.map((s, i) => `SCENE ${i + 1}${s.year ? ` (${s.year})` : ''}: ${s.narration}`),
    `OUTRO: ${script.outro}`,
    ...companies
  ].join('\n')
}

/** Scenes that jump to a new year without saying it: the year card would contradict the voice. */
export function unspokenYears(script: Script): { scene: number; year: number }[] {
  const out: { scene: number; year: number }[] = []
  let last: number | null = null
  script.scenes.forEach((s, i) => {
    if (!s.year) return
    if (s.year !== last && !s.narration.includes(String(s.year)))
      out.push({ scene: i + 1, year: s.year })
    last = s.year
  })
  return out
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

    const pack = formatOf(settings.format)
    const structure = pickStructure(pack, video)
    ctx.log(
      `Gerando roteiro com ${llmLabel(settings)} (até ~${words} palavras, formato ${pack.name}, estrutura "${structure.name}")`
    )
    const prompt =
      fillPrompt(settings.scriptPrompt, {
        topic,
        minutes,
        words,
        scenes: Math.max(3, Math.round((minutes * 60) / 15))
      }) + structureRules(pack, structure.id)
    const script = await generateStructured(prompt, scriptSchemaFor(pack), call)
    script.structure = structure.id
    ctx.log(`Primeira versão: ${script.scenes.length} cenas e ${scriptWordCount(script)} palavras`)
    ctx.progress(0.6)
    if (settings.scriptPolish) {
      try {
        ctx.log('Revisão final do roteiro com Claude Sonnet')
        const changed = await polishScript(script, video.topic, settings, ctx.signal)
        ctx.log(`Revisão final: ${changed} trecho(s) ajustado(s)`)
      } catch (error) {
        ctx.log(`Revisão final falhou: ${(error as Error).message}`, 'warn')
      }
    }
    const count = scriptWordCount(script)
    ctx.log(`Roteiro com ${script.scenes.length} cenas e ${count} palavras`)

    // Claude can check the facts on the web; Ollama only flags what looks doubtful.
    const webCheck = settings.llmProvider !== 'ollama' && settings.factCheckWeb
    ctx.log(webCheck ? 'Checando fatos na web' : 'Rodando auto-revisão')
    let alerts: z.infer<typeof reviewSchema>['alerts'] = []
    let reviewFailed = false
    try {
      const review = await generateStructured(
        fillPrompt(settings.reviewPrompt, { topic: video.topic, script: scriptAsText(script) }),
        reviewSchema,
        { ...call, temperature: 0.2, webSearch: webCheck, effort: 'medium' }
      )
      alerts = review.alerts
    } catch (error) {
      reviewFailed = true
      ctx.log(`Auto-revisão falhou: ${(error as Error).message}`, 'warn')
      alerts = [{ kind: 'other', message: 'A auto-revisão falhou; revise o roteiro manualmente.' }]
    }
    const silent = hasOverlay(pack, 'yearCard') ? unspokenYears(script) : []
    if (silent.length) {
      alerts.unshift({
        kind: 'other',
        message: `O narrador não diz o ano em ${silent.length} mudança(s) de ano (cenas ${silent.map((x) => `${x.scene}: ${x.year}`).join(', ')}). Cite o ano na narração ou corrija o ano da cena.`
      })
    }
    if ((script.sources?.length ?? 0) < 2) {
      alerts.unshift({
        kind: 'dubious_fact',
        message:
          'O roteiro precisa de pelo menos 2 fatos fora do óbvio com fonte nomeada (vão na descrição). Use "Corrigir com IA" ou adicione à mão.'
      })
    }
    script.verified = webCheck && !reviewFailed
    if (!script.verified) {
      alerts.unshift({
        kind: 'dubious_fact',
        message: webCheck
          ? 'A checagem na web falhou: roteiro NÃO verificado. Confira os fatos antes de aprovar.'
          : 'Roteiro NÃO verificado: nenhum provedor com busca na web (escolha Claude em Configurações para checar os fatos).'
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

/** The structure this video uses: the next one after the channel's latest script. */
function pickStructure(
  pack: FormatPack,
  video: Video
): FormatPack['scriptRules']['structures'][number] {
  const recent = listVideos(video.channel_id)
    .filter((v) => v.kind === 'long' && v.id !== video.id)
    .map((v) => v.script?.structure)
  return nextStructure(pack, recent)
}
