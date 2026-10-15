import { z } from 'zod'
import { businessHistory } from './business-history'
import { vintageAds } from './vintage-ads'
import type { Script } from '../types'
import type { FormatPack } from './types'

export type { FormatPack, OverlayDef, ThumbModel } from './types'

export const FORMATS: FormatPack[] = [businessHistory, vintageAds]

export const DEFAULT_FORMAT = businessHistory.id

/** The channel's format; an unknown id (format removed) falls back to the default. */
export function formatOf(id: string | undefined | null): FormatPack {
  return FORMATS.find((f) => f.id === id) ?? businessHistory
}

export function hasOverlay(pack: FormatPack, id: string): boolean {
  return pack.overlays.some((o) => o.id === id)
}

/** Script JSON every format shares; overlays add their own fields on top. */
const baseScene = {
  narration: z.string().min(1),
  visual_keywords: z.string(),
  image_prompt: z.string(),
  real_subject: z.string()
}

const baseScript = {
  title_options: z.array(z.string().min(1)).min(1).max(5),
  hook: z.string().min(1),
  outro: z.string(),
  teaser: z.string().min(1),
  hook_visual_keywords: z.string(),
  outro_visual_keywords: z.string(),
  sources: z.array(z.object({ claim: z.string(), source: z.string() })).default([])
}

/** Zod schema of a script in this format: the base fields plus each overlay's fields. */
export function scriptSchemaFor(pack: FormatPack): z.ZodType<Script> {
  const sceneShape = Object.assign({}, baseScene, ...pack.overlays.map((o) => o.sceneFields ?? {}))
  const scriptShape = Object.assign(
    {},
    baseScript,
    ...pack.overlays.map((o) => o.scriptFields ?? {})
  )
  return z.object({
    ...scriptShape,
    scenes: z.array(z.object(sceneShape)).min(2)
  }) as unknown as z.ZodType<Script>
}

/** Generic openings and stock promises no format may use. */
export const BANNED_OPENINGS = [
  'This is the story of',
  'What if I told you',
  'In this video',
  'Have you ever wondered',
  "Today we're going to",
  'Let me tell you',
  'Stay until the end',
  "By the end of this video, you'll know"
]

/** Rules every format shares: the first 30 seconds, opening extras and real photos. */
const BASE_RULES = `- First 30 seconds: within the first 5–8 seconds the narration delivers the most specific image or fact the title promises (the object, the number, the quote), not a build-up. Between 15 and 30 seconds comes a re-hook: what is at stake, with a number or a consequence, and one concrete question that is only answered at the end. Any promise of what the viewer will learn is written fresh for this video, never a stock phrase.
- Length follows the content: the target length is a ceiling, never a goal. No filler, no restating, no padding to reach it; a tight 8-minute script beats a padded 12-minute one.
- sources: at least 2 facts beyond the obvious (things most viewers have never heard), each with a named source: a book (author, title, year), a newspaper or journal article (publication, date), an official report or a court case. Only sources you are confident exist.
- Never open with or use: ${BANNED_OPENINGS.map((b) => `"${b}…"`).join(', ')}.
- Opening extras: teaser: the hook's most surprising claim, shortened to at most 9 words, shown big on screen during the hook. hook_visual_keywords: 2–4 English words for a REAL, instantly recognizable photo of that subject, different from the first scene's visual_keywords. outro_visual_keywords: same idea for the ending, different from the last scene.
- Real photos: when a scene is about a specific real person, product, device, place or event, set real_subject to the words that find a real photo of it on Wikimedia Commons: proper names first, plus the year or event when it helps (e.g. "Steve Jobs iPhone Macworld 2007", "Apple I computer"). Devices and machines always count: whenever the narration mentions a specific computer, phone, console, camera, chip, car, plane or gadget, real_subject is its exact maker and model name (e.g. "IBM PC 5150", "Ford Model T"), so the viewer sees the real device and not a generic one. Otherwise real_subject is "". In those scenes visual_keywords must name the subject too, never a generic description (write "Steve Jobs keynote", not "man on stage").`

/**
 * Rules the render depends on, appended to the channel's own (editable) prompt so they
 * always apply. `structure` is the narrative structure picked for this video.
 */
export function structureRules(pack: FormatPack, structure?: string): string {
  const r = pack.scriptRules
  const picked = r.structures.find((s) => s.id === structure) ?? r.structures[0]
  return `
Extra rules:
- Hook: ${r.hook}
${r.rehook ? `- Re-hook: ${r.rehook}\n` : ''}- ${r.body.split('\n').join('\n- ')}
${picked ? `- Structure of this video ("${picked.name}"): ${picked.outline}\n` : ''}${r.banned.length ? `- Never use these openings or phrases: ${r.banned.map((b) => `"${b}"`).join(', ')}\n` : ''}- ${r.ending}
${BASE_RULES}
${pack.overlays.map((o) => `- ${o.rules}`).join('\n')}
`
}

/**
 * Narrative structure for the next video: the one after the channel's latest, so videos
 * alternate between the format's structures. `recent` is newest first.
 */
export function nextStructure(
  pack: FormatPack,
  recent: (string | undefined)[]
): FormatPack['scriptRules']['structures'][number] {
  const list = pack.scriptRules.structures
  const last = list.findIndex((st) => st.id === recent.find(Boolean))
  return list[(last + 1) % list.length]
}
