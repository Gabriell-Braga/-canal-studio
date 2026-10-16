import { z } from 'zod'
import type { ReviewAlert, Script, Video } from '../../shared/types'
import { ORIGIN_LABELS, type AdPage } from '../services/chroniclingamerica'
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
import { findVideoEvidence, videoEvidence, type Evidence } from './evidence'
import {
  adQuotes,
  quoteInText,
  scriptProblems,
  unsourcedFacts
} from '../../shared/formats/vintage-ads'
import { isEnglishWord } from '../services/words'

export const NO_AD_ALERT: ReviewAlert = {
  kind: 'other',
  action: 'attachAd',
  message:
    'Sem anúncio real anexado: nada encontrado no loc.gov, no Commons nem no Internet Archive (detalhes em Tarefas e logs). Anexe o anúncio para gerar o roteiro.'
}

const FACT_ALERT = 'Nomes, lugares ou datas sem fonte'

/**
 * Places, years and people the ad scenes name that neither the ad's OCR nor the Claim Check
 * sources hold, so the reviewer checks where they came from. Null when everything is sourced.
 */
export function adFactAlert(script: Script, ev: Evidence): ReviewAlert | null {
  const facts = unsourcedFacts(script, ev.excerpt, ev.page, isEnglishWord)
  if (!facts.length) return null
  const meta = [ev.page.newspaper, ev.page.city, ev.page.state, ev.page.date]
    .filter(Boolean)
    .join(', ')
  const own = facts.filter((f) => !f.fromMeta).map((f) => f.term)
  const fromMeta = facts.filter((f) => f.fromMeta).map((f) => f.term)
  return {
    kind: 'dubious_fact',
    message: [
      `${FACT_ALERT} no Claim Check nem no OCR do anúncio.`,
      own.length ? `Sem origem: ${own.join(', ')}.` : '',
      fromMeta.length
        ? `Vêm só dos metadados da página onde o anúncio foi achado (${meta}), não do anúncio: ${fromMeta.join(', ')}. O jornal vai no cartão de procedência, não na narração.`
        : '',
      'Confira de onde vieram antes de aprovar.'
    ]
      .filter(Boolean)
      .join(' ')
  }
}

/** Recompute the unsourced-facts alert of a video (scripts written before it existed). */
export function refreshAdFactAlert(videoId: number): void {
  const video = getVideo(videoId)
  const ev = videoEvidence(videoId)
  if (!video.script || !ev) return
  const alert = adFactAlert(video.script, ev)
  const others = video.review_alerts.filter((a) => !a.message.startsWith(FACT_ALERT))
  updateVideo(videoId, { review_alerts: alert ? [alert, ...others] : others })
}

/** Where the ad ran, for the script prompt. */
function adSource(page: AdPage): string {
  if (page.origin)
    return `${page.newspaper} (${ORIGIN_LABELS[page.origin]}), ${page.date || 'undated'}`
  const place = [page.city, page.state].filter(Boolean).join(', ')
  return `${page.newspaper}${place ? ` (${place})` : ''}, ${page.date}, page ${page.page}`
}

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
    const pack = formatOf(settings.format)
    // Ads on Trial: a topic typed by hand gets its real ad looked up before the script.
    const adsFormat = hasOverlay(pack, 'claimCheck')
    let ev: Evidence | null = null
    if (adsFormat) {
      try {
        ev = await findVideoEvidence(video, settings, ctx.signal, ctx.log)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        ctx.log(`Busca do anúncio real falhou: ${(error as Error).message}`, 'warn')
      }
      // No real ad, no script: the video waits in review for an ad attached by hand.
      if (!ev) {
        ctx.log('Nenhum anúncio real encontrado: roteiro não gerado', 'warn')
        updateVideo(videoId, { review_alerts: [NO_AD_ALERT] })
        return
      }
    }
    const topic =
      (video.niche ? `${video.topic} (channel niche: ${video.niche})` : video.topic) +
      (ev
        ? `

THE REAL AD this video investigates: ${adSource(ev.page)}. Its striking line: "${ev.phrase}". OCR text of the page around it (noisy; quote only words that are really there):
${ev.excerpt}
`
        : '')
    const call: LlmCall = {
      settings,
      signal: ctx.signal,
      effort: 'high',
      // Ollama: ~1.4 tokens per word of output plus prompt and JSON overhead.
      numCtx: Math.min(32768, Math.max(8192, Math.round(words * 2.2) + 2048))
    }

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
    let script = await generateStructured(prompt, scriptSchemaFor(pack), call)
    // Ads on Trial: a late first Claim Check or a hook about the newspaper gets one more try.
    let pacing = ev ? scriptProblems(script, ev.page) : []
    if (ev && pacing.length) {
      ctx.log(`Roteiro refeito: ${pacing.join('; ')}`, 'warn')
      const retry = await generateStructured(
        `${prompt}

The previous draft broke these rules; fix them: the first Claim Check within 2:30 (about 375 words from the start of the hook), the biography told between the tests, and a hook whose first sentence is the story's conflict, never the newspaper, town or date where the ad was found.`,
        scriptSchemaFor(pack),
        call
      ).catch((error) => {
        if (ctx.signal.aborted) throw error
        return null
      })
      const again = retry ? scriptProblems(retry, ev.page) : pacing
      if (retry && again.length < pacing.length) [script, pacing] = [retry, again]
    }
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
    // Ad lines must be the ad's real words (its OCR), checked by the user in the review.
    if (ev?.excerpt && hasOverlay(pack, 'adVoice')) {
      for (const quote of adQuotes(script)) {
        if (!quoteInText(quote, ev.excerpt))
          alerts.unshift({
            kind: 'dubious_fact',
            message:
              'Citação do anúncio que não confere com o OCR do scan. Confira no texto do anúncio (aba Roteiro) e corrija.',
            quote
          })
      }
    }
    for (const message of pacing) alerts.unshift({ kind: 'pacing', message })
    if (ev && hasOverlay(pack, 'adVoice')) {
      const alert = adFactAlert(script, ev)
      if (alert) alerts.unshift(alert)
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
