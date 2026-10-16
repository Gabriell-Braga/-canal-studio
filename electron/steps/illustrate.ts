/**
 * Ads on Trial filler for scenes with no real material: AI illustrations in the style of a
 * 19th-century newspaper engraving. Only anonymous, generic subjects; never a real person's
 * face, a document, ad, label or newspaper that could pass for real, readable text or a
 * photographic look. Every image is checked by eye and discarded when it breaks a rule.
 */
import { z } from 'zod'
import type { Settings } from '../../shared/types'
import { engravingImage } from '../services/comfy'
import { runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import { polishSettings } from './polish'
import type { StepContext } from './types'

/** What an illustration may show. */
export const ALLOWED_SUBJECTS =
  'hands writing, letters and envelopes, a stove with pots and herbs, generic bottles with blank labels, rooms and offices, crowds and anonymous people seen from behind or far away, streets, trains, printing presses'

const FORBIDDEN: [RegExp, string][] = [
  [
    /\b(portrait|face|faces|close-?up of (a|her|his)|headshot|likeness)\b/i,
    'pede rosto ou retrato'
  ],
  [
    /\b(newspaper|ad|ads|advert\w*|label\w*|letterhead|document|certificate|poster|handbill|pamphlet|almanac|page of)\b/i,
    'pede documento, anúncio, rótulo ou jornal que pode passar por real'
  ],
  [
    /\b(reading|that says|saying|with the (words|text)|inscribed|lettering|text|caption|headline|title)\b/i,
    'pede texto legível'
  ],
  [/\b(photo\w*|realistic|photoreal\w*|cinematic|35 ?mm|camera)\b/i, 'pede estilo fotográfico']
]

/**
 * Why an illustration prompt cannot be used (pt-BR); empty when it can. `realPeople`: names of
 * the story's real people (any of their names in the prompt is refused).
 */
export function promptProblems(prompt: string, realPeople: string[]): string[] {
  const out: string[] = []
  if (!prompt.trim()) return ['prompt vazio']
  const p = prompt.toLowerCase()
  const named = realPeople
    .flatMap((n) => n.split(/\s+/))
    .map((w) => w.replace(/[^a-z]/gi, '').toLowerCase())
    .filter((w) => w.length > 3 && !['mrs', 'miss', 'company'].includes(w))
  const who = named.find((w) => new RegExp(`\\b${w}\\b`).test(p))
  if (who) out.push(`cita pessoa real (${who})`)
  for (const [re, why] of FORBIDDEN) if (re.test(prompt)) out.push(why)
  return out
}

const briefSchema = z.object({ prompt: z.string() })

/**
 * A safe illustration prompt for a scene narration, or '' when none of the allowed subjects
 * fits it. Asks again once when the first answer breaks a rule.
 */
export async function illustrationBrief(
  narration: string,
  realPeople: string[],
  s: Settings,
  signal?: AbortSignal
): Promise<string> {
  let problems: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const { prompt } = await generateStructured(
      `A documentary scene has no real picture. Narration: "${narration}"
Describe ONE simple image for it, as an image-generation prompt in English (max 25 words), choosing only among these subjects: ${ALLOWED_SUBJECTS}.
Never: the face or portrait of anyone, any real person by name${realPeople.length ? ` (${realPeople.join(', ')})` : ''}, a document, ad, label, newspaper or page, any written words, a photographic look. People only from behind, in silhouette or far away. Describe objects and the scene, not the style.
Return "" when none of the allowed subjects fits the narration.
${problems.length ? `Your previous prompt was refused: ${problems.join('; ')}. Fix it.\n` : ''}Return ONLY JSON: {"prompt": "..."}`,
      briefSchema,
      { settings: polishSettings(s), signal, temperature: 0.4, effort: 'low' }
    )
    const clean = prompt.trim()
    if (!clean) return ''
    problems = promptProblems(clean, realPeople)
    if (!problems.length) return clean
  }
  return ''
}

export interface IllustrationVerdict {
  photoreal: boolean
  text: boolean
  face: boolean
  document: boolean
}

/** Why a generated illustration is discarded (pt-BR); empty = it may be used. */
export function checkProblems(v: IllustrationVerdict): string[] {
  const out: string[] = []
  if (v.photoreal) out.push('parece foto (fotorrealista)')
  if (v.text) out.push('tem texto legível')
  if (v.face) out.push('mostra rosto reconhecível')
  if (v.document) out.push('parece documento, anúncio, rótulo ou jornal real')
  return out
}

const verdictSchema = z.object({
  photoreal: z.boolean(),
  text: z.boolean(),
  face: z.boolean(),
  document: z.boolean()
})

/** The vision model looks at the illustration; any doubt counts as true (discard). */
export async function illustrationCheck(
  file: string,
  s: Settings,
  signal?: AbortSignal
): Promise<IllustrationVerdict> {
  return generateStructured(
    `Look at this image (read the file): ${file}
It must look like a hand-made 19th-century newspaper engraving. Answer true when in doubt:
- photoreal: it looks like a photograph or a realistic render
- text: it shows readable letters or words
- face: it shows a clear, recognizable human face (front or three-quarter view, big enough to identify)
- document: it looks like a real document, ad, product label, newspaper or printed page
Return ONLY JSON: {"photoreal": false, "text": false, "face": false, "document": false}`,
    verdictSchema,
    { settings: polishSettings(s), signal, temperature: 0, effort: 'low', images: [file] }
  )
}

/**
 * The brand's paper and ink: plate margins cut (SDXL draws fake captions there), grayscale, more contrast, light sepia, then multiplied over warm
 * paper with a fixed grain (deterministic: same input, same output).
 */
export async function paperInk(file: string, out: string, signal?: AbortSignal): Promise<void> {
  await runTool(
    'ffmpeg',
    [
      '-y',
      '-i',
      file,
      '-f',
      'lavfi',
      '-i',
      'color=c=0xEDE3CC:s=1344x768,noise=alls=10:allf=u:all_seed=7,format=rgb24',
      '-filter_complex',
      '[0:v]crop=iw*0.94:ih*0.9:iw*0.03:ih*0.03,scale=1344:768,format=gray,eq=contrast=1.35:brightness=0.03,format=rgb24,colorchannelmixer=rr=1:gg=0.93:bb=0.8[ink];[1:v][ink]blend=all_mode=multiply,format=rgb24',
      '-frames:v',
      '1',
      out
    ],
    signal
  )
}

/**
 * One illustration for a scene: safe prompt → engraving (IP-Adapter on the video's real
 * engravings when installed) → paper and ink → visual check. Null (reason logged) when the
 * scene has no allowed subject or the image breaks a rule.
 */
export async function makeIllustration(
  narration: string,
  refs: string[],
  out: string,
  ctx: StepContext,
  realPeople: string[]
): Promise<{ file: string; prompt: string } | null> {
  const s = ctx.settings
  const prompt = await illustrationBrief(narration, realPeople, s, ctx.signal)
  if (!prompt) {
    ctx.log('Ilustração: nenhum assunto permitido para esta cena', 'warn')
    return null
  }
  const raw = out.replace(/\.\w+$/, '.raw.png')
  const usedIp = await engravingImage(prompt, refs, raw, s, ctx.signal)
  if (!usedIp) ctx.log('Ilustração sem IP-Adapter (não instalado): estilo só pelo prompt', 'warn')
  await paperInk(raw, out, ctx.signal)
  const problems = checkProblems(await illustrationCheck(out, s, ctx.signal))
  if (problems.length) {
    ctx.log(`Ilustração descartada (${problems.join(', ')}): ${prompt}`, 'warn')
    return null
  }
  return { file: out, prompt }
}
