import { z } from 'zod'
import type { Scene, Settings } from '../../shared/types'
import type { StockCandidate } from '../services/pexels'
import { generateStructured } from '../services/llm'

const picksSchema = z.object({
  picks: z.array(z.object({ scene: z.number().int(), choice: z.number().int() }))
})

const BATCH = 8

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
              `   ${k}. [${c.kind === 'stock_video' ? 'video' : 'photo'}] ${c.label?.trim() || '(no description)'}`
          )
          .join('\n')
        return `SCENE ${i}: "${sc.narration}"\n${options}`
      })
      .join('\n\n')
    try {
      const { picks } = await generateStructured(
        `You pick B-roll for a YouTube documentary about "${topic}". For each scene, choose the option whose description best matches what the narration is talking about at that moment (place, era, object, action). Prefer video over photo when both fit. Answer -1 when no option clearly fits: a wrong image is worse than a generated one. Modern footage does not fit a scene about the distant past unless it shows a place or object that still looks the same.

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
