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
      `These scenes come from a YouTube documentary about "${topic}". For each scene that is about a specific real person, product, device, place or event, give real_subject: the words that find a real photo of it on Wikimedia Commons, proper names first, plus the year or event when it helps (e.g. "Steve Jobs iPhone Macworld 2007", "Apple I computer", "Xerox Alto"). A scene that mentions a specific computer, phone, console, chip, car or gadget always gets its exact maker and model (e.g. "IBM PC 5150", "Nokia 3310"). Use "" when the scene is generic.

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
        `You pick B-roll for a YouTube documentary about "${topic}". For each scene, choose the option whose description best matches what the narration is talking about at that moment (place, era, object, action). Prefer video over photo when both fit. When a scene is about a real person, product, device or event, a [real photo] that actually shows it beats any stock clip; stock of a different situation does not fit (a concert or a random speaker for a product keynote, a random office for a famous company), so answer -1 rather than pick it. Answer -1 when no option clearly fits: a wrong image is worse than a generated one. Modern footage does not fit a scene about the distant past unless it shows a place or object that still looks the same.

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

/** What an image shows, by the format's media priority (vintage-ads). */
export const MEDIA_KINDS = ['ad', 'product', 'portrait', 'place', 'event', 'other'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/**
 * How a picture relates to a narration line: LITERAL shows what the line says, CONTEXT shows
 * the scene's place, era, product or kind of object (a Lynn street of the 1880s, an office of
 * 1900), NONE has nothing to do with it (a random museum object, another country or era).
 */
export const RELEVANCE = ['literal', 'context', 'none'] as const
export type Relevance = (typeof RELEVANCE)[number]

export interface VisualVerdict {
  ok: boolean
  what: string
  kind: MediaKind
  /** Missing in checks cached before the two levels existed: ok then means literal */
  level?: Relevance
}

const visionSchema = z.object({
  images: z.array(
    z.object({
      image: z.number().int(),
      level: z.enum(RELEVANCE),
      what: z.string(),
      kind: z.enum(MEDIA_KINDS)
    })
  )
})

/** The verdict of one answer: LITERAL and CONTEXT may be used, NONE never. */
export function verdictOf(a: { level: Relevance; what: string; kind: MediaKind }): VisualVerdict {
  return { ok: a.level !== 'none', what: a.what, kind: a.kind, level: a.level }
}

/** Literal pictures first, then context ones; NONE never. */
export function byRelevance<T extends { level?: Relevance }>(items: T[]): T[] {
  const rank = (l?: Relevance): number => (l === 'context' ? 1 : l === 'none' ? 2 : 0)
  return items.filter((i) => i.level !== 'none').sort((a, b) => rank(a.level) - rank(b.level))
}

/**
 * The model looks at each image and says how it relates to the narration line (LITERAL,
 * CONTEXT or NONE, and what it shows), and what kind of picture it is. `files` are small local
 * previews; the answer is keyed by their index.
 */
export async function visualCheck(
  narration: string,
  files: string[],
  topic: string,
  settings: Settings,
  signal?: AbortSignal
): Promise<VisualVerdict[]> {
  if (!files.length) return []
  const { images } = await generateStructured(
    `You check pictures for a YouTube documentary about "${topic}". Narration line: "${narration}"
Look at each image below (read each file). For each one give its level:
- "literal": it shows something this narration line mentions, or the story's own product, its real ads, or the real people and places of this story;
- "context": it does not show the line itself but shows its place, era, product type or kind of object, in the right country and decades (e.g. a street of the story's town at that time, an office of 1900 for clerks answering letters, a patent medicine bottle of the period);
- "none": nothing to do with it: a random museum object, another country, another era, an unrelated person.
"what": what it shows in a few words.
kind: "ad" (a printed advertisement of the product), "product" (the real bottle, label, package), "portrait" (a real person of the story), "place" (factory, town, building of the story), "event" (a period engraving or photo of an event mentioned), "other".
${files.map((f, i) => `Image ${i}: ${f}`).join('\n')}
Return ONLY JSON: {"images": [{"image": 0, "level": "literal", "what": "...", "kind": "product"}, ...]} with one entry per image.`,
    visionSchema,
    { settings, signal, temperature: 0, effort: 'low', images: files }
  )
  return files.map((_, i) => {
    const a = images.find((x) => x.image === i)
    return a ? verdictOf(a) : { ok: false, what: '', kind: 'other', level: 'none' }
  })
}
