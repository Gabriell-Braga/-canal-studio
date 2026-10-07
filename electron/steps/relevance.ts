import { z } from 'zod'
import type { Scene, Settings } from '../../shared/types'
import type { StockCandidate } from '../services/pexels'
import { generateStructured } from '../services/llm'

const picksSchema = z.object({
  picks: z.array(z.object({ scene: z.number().int(), choice: z.number().int() }))
})

const BATCH = 8

const subjectsSchema = z.object({
  subjects: z.array(z.object({ scene: z.number().int(), real_subject: z.string() }))
})

/**
 * Scripts written before real_subject existed: ask for it once, scene by scene, so the
 * search can look for the real photo (Steve Jobs on stage in 2007) instead of generic stock.
 */
export async function fillRealSubjects(
  scenes: Scene[],
  topic: string,
  settings: Settings,
  signal?: AbortSignal
): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  for (let start = 0; start < scenes.length; start += BATCH * 2) {
    const batch = scenes.slice(start, start + BATCH * 2)
    const listing = batch.map((sc, i) => `SCENE ${i}: "${sc.narration}"`).join('\n')
    const { subjects } = await generateStructured(
      `These scenes come from a YouTube documentary about "${topic}". For each scene that is about a specific real person, product, place or event, give real_subject: the words that find a real photo of it on Wikimedia Commons, proper names first, plus the year or event when it helps (e.g. "Steve Jobs iPhone Macworld 2007", "Apple I computer", "Xerox Alto"). Use "" when the scene is generic.

${listing}

Return ONLY JSON: {"subjects": [{"scene": 0, "real_subject": "..."}, ...]} with one entry per scene.`,
      subjectsSchema,
      { settings, signal, temperature: 0.1, effort: 'low' }
    )
    for (const p of subjects) {
      const scene = batch[p.scene]
      if (scene && p.real_subject.trim()) result.set(scene.id, p.real_subject.trim())
    }
  }
  return result
}

/**
 * Let the model choose, for each scene, the candidate whose description best fits what the
 * narration says at that moment, or none (-1) so the scene gets an AI image instead.
 * Stock search alone often returns something only loosely related to the keywords.
 */
export async function pickRelevant(
  scenes: Scene[],
  candidates: Map<number, StockCandidate[]>,
  topic: string,
  settings: Settings,
  signal?: AbortSignal,
  log?: (m: string) => void
): Promise<Map<number, StockCandidate | null>> {
  const result = new Map<number, StockCandidate | null>()
  const withOptions = scenes.filter((sc) => (candidates.get(sc.id) ?? []).length)
  for (let start = 0; start < withOptions.length; start += BATCH) {
    const batch = withOptions.slice(start, start + BATCH)
    const listing = batch
      .map((sc, i) => {
        const options = (candidates.get(sc.id) ?? [])
          .map(
            (c, k) =>
              `   ${k}. [${c.real ? 'real photo' : c.kind === 'stock_video' ? 'video' : 'photo'}] ${c.label?.trim() || '(no description)'}`
          )
          .join('\n')
        const about = sc.real_subject ? `\n   (about: ${sc.real_subject})` : ''
        return `SCENE ${i}: "${sc.narration}"${about}\n${options}`
      })
      .join('\n\n')
    try {
      const { picks } = await generateStructured(
        `You pick B-roll for a YouTube documentary about "${topic}". For each scene, choose the option whose description best matches what the narration is talking about at that moment (place, era, object, action). Prefer video over photo when both fit. When a scene is about a real person, product or event, a [real photo] that actually shows it beats any stock clip; stock of a different situation does not fit (a concert or a random speaker for a product keynote, a random office for a famous company), so answer -1 rather than pick it. Answer -1 when no option clearly fits: a wrong image is worse than a generated one. Modern footage does not fit a scene about the distant past unless it shows a place or object that still looks the same.

${listing}

Return ONLY JSON: {"picks": [{"scene": 0, "choice": 2}, ...]} with one entry per scene.`,
        picksSchema,
        { settings, signal, temperature: 0.1, effort: 'low' }
      )
      for (const p of picks) {
        const scene = batch[p.scene]
        if (!scene) continue
        const options = candidates.get(scene.id) ?? []
        result.set(scene.id, p.choice >= 0 && p.choice < options.length ? options[p.choice] : null)
      }
    } catch (error) {
      log?.(
        `Escolha por relevância falhou (${(error as Error).message}); usando o primeiro resultado`
      )
      for (const sc of batch) result.set(sc.id, candidates.get(sc.id)?.[0] ?? null)
    }
  }
  return result
}
