/**
 * Ads on Trial thumbnails, starting from the idea: a briefing (the video's conflict, the
 * question the thumbnail plants, three concepts of different types), a blind two-second test,
 * assembly from the video's media bank (or the brand's drawn parts), and a vision score at
 * feed size. A concept that fails any stage is redone, at most twice.
 */
import { existsSync, readFileSync } from 'fs'
import { basename, join, relative } from 'path'
import { z } from 'zod'
import type { ThumbnailProps } from '../../shared/render'
import {
  briefingProblems,
  CONCEPT_TYPES,
  conceptLayout,
  conceptProblems,
  DRAWN_ELEMENTS,
  MEDIA_ELEMENTS,
  MIN_THUMB_MEDIA_PX,
  pieceAspect,
  scoreProblems,
  testimonialOnly,
  THUMB,
  type ConceptDraw,
  type ConceptPiece,
  type ConceptType,
  type ThumbBriefReport,
  type ThumbConcept,
  type ThumbConceptReport,
  type ThumbScores
} from '../../shared/thumb'
import { readScan } from '../services/adscan'
import { isValidFile, probeSize, runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import { runRender } from '../services/remotion'
import { listScenes } from '../db/repo'
import { setState } from '../db/settings'
import { polishSettings } from './polish'
import type { StepContext } from './types'

/** Extra tries for a concept that fails the blind test or scores under 7. */
const REDOS = 2

const elementSchema = z.object({
  kind: z.enum([...MEDIA_ELEMENTS, ...DRAWN_ELEMENTS]),
  what: z.string().min(1),
  person: z.string().default(''),
  words: z.string().default('')
})

const conceptSchema = z.object({
  type: z.enum(CONCEPT_TYPES),
  idea: z.string().min(1),
  elements: z.array(elementSchema).min(1),
  text: z.string(),
  accent_word: z.string().default(''),
  background: z.enum(['dark', 'paper']).default('dark'),
  why_click: z.string().min(1)
})

const briefingSchema = z.object({
  conflict: z.string(),
  question: z.string(),
  concepts: z.array(conceptSchema).min(1)
})

const TYPE_RULES: Record<ConceptType, string> = {
  contradiction:
    'CONTRADICTION: two elements that could not exist together (e.g. her real portrait + a letter signed "Mrs. Pinkham" stamped 1903 + text "SHE DIED IN 1883")',
  secret:
    'SECRET: the product and what it hid (e.g. the big bottle + a stamp "20% ALCOHOL" + text "FOR WOMEN")',
  mystery:
    'MYSTERY: the video\'s question as a picture (e.g. a gravestone on one side, a pile of answered letters on the other + "WHO WROTE BACK?")'
}

export interface BankItem {
  file: string
  kind?: string
  year?: number
  source: string
  credit: string | null
}

/**
 * The video's media bank: scenes/bank.json when the scenes step wrote one, else every picture
 * the scenes use. Only pictures at least MIN_THUMB_MEDIA_PX tall.
 */
export async function mediaBank(projectDir: string, videoId: number): Promise<BankItem[]> {
  let items: BankItem[] = []
  const file = join(projectDir, 'scenes', 'bank.json')
  if (existsSync(file)) {
    try {
      items = (JSON.parse(readFileSync(file, 'utf8')) as { items: BankItem[] }).items ?? []
    } catch {
      items = []
    }
  }
  if (!items.length)
    for (const sc of listScenes(videoId))
      for (const a of [
        {
          path: sc.asset_path,
          type: sc.asset_type,
          source: sc.asset_source,
          credit: sc.asset_credit
        },
        ...sc.extra_assets
      ])
        if (a.path && !/video/.test(a.type ?? ''))
          items.push({
            file: a.path,
            kind: basename(a.path).startsWith('ad_') ? 'ad' : undefined,
            source: a.source ?? '',
            credit: a.credit ?? null
          })
  const seen = new Set<string>()
  const out: BankItem[] = []
  for (const it of items) {
    if (seen.has(it.file) || !isValidFile(it.file)) continue
    seen.add(it.file)
    try {
      const { height } = await probeSize(it.file)
      if (height >= MIN_THUMB_MEDIA_PX) out.push(it)
    } catch {
      // unreadable picture: not in the bank
    }
  }
  return out
}

const describe = (b: BankItem): string =>
  `${b.kind ?? 'picture'}: ${(b.credit ?? basename(b.file)).replace(/\s+/g, ' ').slice(0, 140)}`

/** Briefing for `types`; `notes` says why an earlier concept of that type was redone. */
async function briefing(
  types: ConceptType[],
  notes: Partial<Record<ConceptType, string>>,
  title: string,
  story: string,
  bank: BankItem[],
  ctx: StepContext,
  fixed?: { conflict: string; question: string }
): Promise<{ conflict: string; question: string; concepts: ThumbConcept[] }> {
  let problems: string[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const b = await generateStructured(
      `You design YouTube thumbnails for "Ads on Trial", a channel that investigates real old ads. The thumbnail must show the video's CONFLICT and plant a question in the viewer's head. Start from the idea, never from the materials.
Title (the thumbnail must not repeat its words): "${title}"
Script excerpt: ${story}
${fixed ? `The video's conflict: ${fixed.conflict}\nThe question: ${fixed.question}\n` : ''}
Real pictures in the video's media bank (portraits, products, ads, places that exist; anything else is drawn with the channel's parts: letter, stamp, label, tombstone, document):
${bank.map((b) => `- ${describe(b)}`).join('\n') || '- none'}

Return JSON:
- "conflict": the conflict of the video in one sentence (e.g. "Women wrote to Lydia Pinkham for advice; she had been dead for 20 years").
- "question": the question the thumbnail must create (e.g. "Who was answering her letters?").
- "concepts": exactly ${types.length} concept(s), one per type, in this order: ${types.join(', ')}.
${types.map((t) => `  - ${TYPE_RULES[t]}${notes[t] ? `\n    The previous ${t} concept was rejected: ${notes[t]}. Make a clearly different one.` : ''}`).join('\n')}
Each concept:
  - "type": its type;
  - "idea": what the image shows, in one sentence;
  - "elements": at most 3 concrete visual elements: the FIRST is the dominant subject (left, 40–60% of the frame), the SECOND the conflict element (right), an optional THIRD only as a red rubber stamp. Each: {"kind": portrait|product|ad|place|letter|stamp|label|tombstone|document, "what": what it shows, "person": full name of the person shown (portraits only, a real person of the story named as such, never a customer from a testimonial), "words": the words drawn on it (letter line with a date, stamp word, label name, tombstone inscription with real dates; use " / " for line breaks; "" for photos)};
  - "text": at most 4 words, in English, that do NOT repeat the title's words and complete the question; every word true about whoever is pictured;
  - "accent_word": the one word of "text" that is the conflict point (painted red), or "" when a stamp carries it;
  - "background": "dark" (plain dark board) or "paper" (light old paper), whichever the subject contrasts with (paper scans and letters need "dark");
  - "why_click": why someone would click.
Never: a concept that only works after reading the title; a price without context; a person not named in the media bank as the face; invented facts or dates.
${problems.length ? `Your previous answer had these problems, fix them: ${problems.join('; ')}\n` : ''}Return ONLY JSON: {"conflict": "...", "question": "...", "concepts": [{"type": "...", "idea": "...", "elements": [{"kind": "...", "what": "...", "person": "", "words": ""}], "text": "...", "accent_word": "", "background": "dark", "why_click": "..."}]}`,
      briefingSchema,
      {
        settings: { ...polishSettings(ctx.settings), claudeModel: 'opus' },
        signal: ctx.signal,
        temperature: 0.9,
        effort: 'medium'
      }
    )
    const concepts = types.map((t) => b.concepts.find((c) => c.type === t))
    const full = {
      conflict: fixed?.conflict ?? b.conflict,
      question: fixed?.question ?? b.question,
      concepts: concepts.filter((c): c is ThumbConcept => !!c)
    }
    problems =
      types.length === 3
        ? briefingProblems(full, title)
        : [
            ...types.filter((_, i) => !concepts[i]).map((t) => `falta o conceito ${t}`),
            ...full.concepts.flatMap((c) => conceptProblems(c, title).map((p) => `${c.type}: ${p}`))
          ]
    if (!problems.length) return full
    ctx.log(`Briefing da thumbnail refeito: ${problems.join('; ')}`, 'warn')
  }
  throw new Error(`Briefing da thumbnail sem conceitos válidos: ${problems.join('; ')}`)
}

const blindSchema = z.object({
  answers: z.array(z.object({ index: z.number().int(), about: z.string(), question: z.string() }))
})
const judgeSchema = z.object({
  verdicts: z.array(z.object({ index: z.number().int(), ok: z.boolean() }))
})

/**
 * The two-second test: a reader who never saw the script gets only each concept's
 * description and says what the video is about and what they would wonder. A judge then
 * says whether that lands near the conflict.
 */
async function blindTest(
  concepts: ThumbConcept[],
  conflict: string,
  ctx: StepContext
): Promise<{ about: string; question: string; ok: boolean }[]> {
  const settings = polishSettings(ctx.settings)
  const { answers } = await generateStructured(
    `You scroll YouTube and see these thumbnails for one second each. You know nothing else about the videos.
${concepts
  .map(
    (c, i) =>
      `Thumbnail ${i}: ${c.idea} Visible: ${c.elements.map((e) => `${e.what}${e.words ? ` ("${e.words}")` : ''}`).join('; ')}. Big text: "${c.text}".`
  )
  .join('\n')}
For each: what is this video about, and what question would you have?
Return ONLY JSON: {"answers": [{"index": 0, "about": "...", "question": "..."}]}`,
    blindSchema,
    { settings, signal: ctx.signal, temperature: 0 }
  )
  const { verdicts } = await generateStructured(
    `A video's conflict: "${conflict}". Viewers who saw only its thumbnail guessed:
${answers.map((a) => `${a.index}: about "${a.about}", question "${a.question}"`).join('\n')}
For each guess: does it come close to the conflict (same story and same tension, not just the same product)?
Return ONLY JSON: {"verdicts": [{"index": 0, "ok": true}]}`,
    judgeSchema,
    { settings, signal: ctx.signal, temperature: 0 }
  )
  return concepts.map((_, i) => {
    const a = answers.find((x) => x.index === i)
    return {
      about: a?.about ?? '',
      question: a?.question ?? '',
      ok: !!verdicts.find((v) => v.index === i)?.ok
    }
  })
}

const pickSchema = z.object({
  picks: z.array(z.object({ element: z.number().int(), image: z.number().int() }))
})

/** Small JPEG of a bank picture for the vision model. */
async function preview(file: string, dir: string, signal?: AbortSignal): Promise<string> {
  const out = join(dir, `${basename(file).replace(/\.\w+$/, '')}.jpg`)
  if (!isValidFile(out))
    await runTool(
      'ffmpeg',
      ['-y', '-i', file, '-vf', "scale='min(512,iw)':-2", '-frames:v', '1', '-q:v', '4', out],
      signal
    )
  return out
}

/**
 * Which bank picture shows each media element (portrait, product, ad, place), checked by eye.
 * A portrait is only the person named in the picture's own record, never a customer from a
 * testimonial. Returns element key "concept.element" → bank item.
 */
async function pickMedia(
  concepts: ThumbConcept[],
  bank: BankItem[],
  story: string,
  dir: string,
  ctx: StepContext
): Promise<Map<string, BankItem>> {
  const out = new Map<string, BankItem>()
  const wanted = concepts.flatMap((c, ci) =>
    c.elements
      .map((e, ei) => ({ key: `${ci}.${ei}`, e }))
      .filter(({ e }) => (MEDIA_ELEMENTS as readonly string[]).includes(e.kind))
  )
  if (!wanted.length || !bank.length) return out
  const pool = bank.slice(0, 20)
  const previews = await Promise.all(pool.map((b) => preview(b.file, dir, ctx.signal)))
  let picks: { element: number; image: number }[] = []
  try {
    picks = (
      await generateStructured(
        `Pick the picture for each thumbnail element. Look at each image (read each file).
${previews.map((p, i) => `Image ${i}: ${p} (${describe(pool[i])})`).join('\n')}
Elements:
${wanted.map((w, i) => `${i}: ${w.e.kind}: ${w.e.what}${w.e.person ? ` (must show ${w.e.person} himself or herself)` : ''}`).join('\n')}
For each element, the image that clearly shows it, or -1. A portrait must be that named person: a customer drawn in an ad testimonial is never them. Never pick an image whose main subject is a different person.
Return ONLY JSON: {"picks": [{"element": 0, "image": 3}]}`,
        pickSchema,
        {
          settings: polishSettings(ctx.settings),
          signal: ctx.signal,
          temperature: 0,
          effort: 'low',
          images: previews
        }
      )
    ).picks
  } catch (error) {
    if (ctx.signal.aborted) throw error
    ctx.log(`Escolha das imagens da thumbnail falhou: ${(error as Error).message}`, 'warn')
  }
  const scan = readScan(bank.find((b) => b.kind === 'ad')?.file ?? null)
  const adText = scan?.ocrText ?? scan?.words.map((w) => w.text).join(' ') ?? ''
  for (const p of picks) {
    const w = wanted[p.element]
    const item = pool[p.image]
    if (!w || !item) continue
    if (w.e.kind === 'portrait') {
      // The face is only someone the picture's own record names, and the story's person.
      const last = w.e.person.trim().split(/\s+/).pop()?.toLowerCase() ?? ''
      const record = `${item.credit ?? ''} ${item.source} ${basename(item.file)}`.toLowerCase()
      if (last.length < 3 || !record.includes(last) || testimonialOnly(w.e.person, adText, story)) {
        ctx.log(`Retrato de ${w.e.person} recusado: a imagem não traz o nome dela(e)`, 'warn')
        continue
      }
    }
    out.set(w.key, item)
  }
  return out
}

function url(projectDir: string, file: string): string {
  return `{{root}}/${relative(projectDir, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

/**
 * The drawing of one concept: subject, support and stamp from its elements. A media element
 * without a bank picture becomes a drawn label (product, ad, place) or is dropped (a portrait:
 * a real person is never invented).
 */
export function assemble(
  c: ThumbConcept,
  media: (ei: number) => { src: string; aspect: number } | null
): ConceptDraw | null {
  const pieces: ConceptPiece[] = []
  let stamp = ''
  c.elements.slice(0, 3).forEach((e, ei) => {
    const m = (MEDIA_ELEMENTS as readonly string[]).includes(e.kind) ? media(ei) : null
    if (m) pieces.push({ kind: e.kind, src: m.src, words: e.words, aspect: m.aspect })
    else if (e.kind === 'portrait') return
    else if (e.kind === 'stamp' && pieces.length && !stamp) stamp = e.words || e.what
    else if ((MEDIA_ELEMENTS as readonly string[]).includes(e.kind))
      pieces.push({ kind: 'label', src: null, words: e.words || e.what })
    else pieces.push({ kind: e.kind, src: null, words: e.words || e.what })
  })
  if (!pieces.length) return null
  const [subject, support = null, extra] = pieces
  if (!stamp && extra?.kind === 'stamp') stamp = extra.words
  return { background: c.background, subject, support, stamp, accentWord: stamp ? '' : c.accent_word }
}

const scoreSchema = z.object({
  scores: z.array(
    z.object({
      image: z.number().int(),
      understand: z.number(),
      click: z.number(),
      readable: z.number(),
      stands_out: z.number(),
      note: z.string()
    })
  )
})

/** Vision scores of each thumbnail at feed size (246×138); null when the check cannot run. */
async function scoreThumbs(
  files: string[],
  conflict: string,
  dir: string,
  ctx: StepContext
): Promise<(ThumbScores | null)[]> {
  const { width, height } = THUMB.preview
  try {
    const small = await Promise.all(
      files.map(async (f) => {
        const out = join(dir, `feed_${basename(f).replace(/\.\w+$/, '')}.jpg`)
        await runTool(
          'ffmpeg',
          ['-y', '-i', f, '-vf', `scale=${width}:${height}:flags=lanczos`, '-q:v', '3', out],
          ctx.signal
        )
        return out
      })
    )
    const { scores } = await generateStructured(
      `These are YouTube thumbnails at the real size of the mobile home feed (${width}×${height} px). Look at each image (read each file). The video's conflict: "${conflict}".
${small.map((f, i) => `Image ${i}: ${f}`).join('\n')}
Score each from 1 to 10, strictly, as a viewer scrolling past:
- understand: I get what the video is about in 2 seconds
- click: I want to click
- readable: I can read the text at this size
- stands_out: the main subject pops out from the background
"note": the single biggest problem, in a few words.
Return ONLY JSON: {"scores": [{"image": 0, "understand": 0, "click": 0, "readable": 0, "stands_out": 0, "note": "..."}]}`,
      scoreSchema,
      {
        settings: polishSettings(ctx.settings),
        signal: ctx.signal,
        temperature: 0,
        effort: 'low',
        images: small
      }
    )
    return files.map((_, i) => {
      const s = scores.find((x) => x.image === i)
      return s ? { ...s, image: undefined } : null
    }) as (ThumbScores | null)[]
  } catch (error) {
    if (ctx.signal.aborted) throw error
    ctx.log(`Avaliação das thumbnails indisponível: ${(error as Error).message}`, 'warn')
    return files.map(() => null)
  }
}

const minScore = (s: ThumbScores | null): number =>
  s ? Math.min(s.understand, s.click, s.readable, s.stands_out) : -1

/**
 * Three concept thumbnails (contradiction, secret, mystery) in `outDir`, with the briefing,
 * blind test and scores kept for the final review (state `thumbBrief.video.<id>`).
 */
export async function conceptThumbs(
  videoId: number,
  ctx: StepContext,
  outDir: string,
  title: string,
  story: string
): Promise<{ approach: string; text: string; file: string }[]> {
  const dir = join(ctx.projectDir, 'thumbs')
  const bank = await mediaBank(ctx.projectDir, videoId)
  ctx.log(`Thumbnail: banco com ${bank.length} imagem(ns) de pelo menos ${MIN_THUMB_MEDIA_PX} px`)

  const first = await briefing([...CONCEPT_TYPES], {}, title, story, bank, ctx)
  const base = { conflict: first.conflict, question: first.question }
  ctx.log(`Conflito: ${base.conflict} · Pergunta: ${base.question}`)
  const current = new Map<ConceptType, ThumbConcept>(first.concepts.map((c) => [c.type, c]))
  const best = new Map<ConceptType, ThumbConceptReport>()
  const attempts = new Map<ConceptType, number>(CONCEPT_TYPES.map((t) => [t, 0]))
  let pending: ConceptType[] = [...CONCEPT_TYPES]

  for (let round = 0; round <= REDOS && pending.length; round++) {
    const notes: Partial<Record<ConceptType, string>> = {}
    const concepts = pending.map((t) => current.get(t) as ThumbConcept)
    // 1. Two-second test: the concept alone has to say what the video is about.
    let blind: ({ about: string; question: string; ok: boolean } | null)[] = concepts.map(() => null)
    try {
      blind = await blindTest(concepts, base.conflict, ctx)
    } catch (error) {
      if (ctx.signal.aborted) throw error
      ctx.log(`Teste dos 2 segundos indisponível: ${(error as Error).message}`, 'warn')
    }
    // 2. Assembly from the bank, 3. render, 4. score at feed size.
    const media = await pickMedia(concepts, bank, story, dir, ctx)
    const stills: {
      type: ConceptType
      out: string
      props: ThumbnailProps
      blind: ThumbConceptReport['blind']
    }[] = []
    for (const [ci, c] of concepts.entries()) {
      attempts.set(c.type, (attempts.get(c.type) ?? 0) + 1)
      if (blind[ci] && !blind[ci]?.ok) {
        notes[c.type] = `quem viu só a thumbnail achou que o vídeo era sobre "${blind[ci]?.about}"`
        ctx.log(`Thumbnail ${c.type} reprovada no teste dos 2 segundos: ${notes[c.type]}`, 'warn')
        if (round < REDOS) continue
      }
      const sizes = new Map<number, { src: string; aspect: number }>()
      for (const [ei] of c.elements.entries()) {
        const item = media.get(`${ci}.${ei}`)
        if (!item) continue
        const { width, height } = await probeSize(item.file)
        sizes.set(ei, { src: url(ctx.projectDir, item.file), aspect: width / height })
      }
      const draw = assemble(c, (ei) => sizes.get(ei) ?? null)
      if (!draw) {
        notes[c.type] = 'nenhum elemento pôde ser montado (retrato sem foto real com o nome)'
        ctx.log(`Thumbnail ${c.type}: ${notes[c.type]}`, 'warn')
        continue
      }
      const layout = conceptLayout(c.text, pieceAspect(draw.subject), draw.stamp)
      if (layout.problems.length) {
        notes[c.type] = layout.problems.join('; ')
        ctx.log(`Thumbnail ${c.type} reprovada na área segura: ${notes[c.type]}`, 'warn')
        continue
      }
      const out = join(outDir, `thumb_${CONCEPT_TYPES.indexOf(c.type) + 1}_r${round}_${c.type}.png`)
      stills.push({
        type: c.type,
        out,
        props: {
          approach: c.type,
          layout: 'concept',
          format: 'vintage-ads',
          background: draw.subject.src ?? '',
          text: c.text.toUpperCase(),
          concept: draw
        },
        blind: blind[ci]
      })
    }
    if (stills.length) {
      await runRender(
        { mode: 'stills', root: ctx.projectDir, out: '', stills: stills.map(({ out, props }) => ({ out, props })) },
        join(ctx.projectDir, 'thumb-job.json'),
        { log: (m) => ctx.log(m), signal: ctx.signal }
      )
      const scores = await scoreThumbs(
        stills.map((s) => s.out),
        base.conflict,
        dir,
        ctx
      )
      stills.forEach((st, i) => {
        const s = scores[i]
        const prev = best.get(st.type)
        const entry: ThumbConceptReport = {
          file: st.out,
          concept: current.get(st.type) as ThumbConcept,
          blind: st.blind,
          scores: s,
          attempts: attempts.get(st.type) ?? 1
        }
        if (!prev?.file || minScore(s) > minScore(prev.scores)) best.set(st.type, entry)
        else best.set(st.type, { ...prev, attempts: entry.attempts })
        const low = s ? scoreProblems(s) : []
        if (low.length) {
          notes[st.type] = `notas baixas na prévia (${low.join(', ')}; ${s?.note})`
          ctx.log(`Thumbnail ${st.type} reprovada na avaliação: ${notes[st.type]}`, 'warn')
        }
      })
    }
    pending = pending.filter((t) => notes[t])
    if (!pending.length || round === REDOS) break
    const redo = await briefing(pending, notes, title, story, bank, ctx, base)
    for (const c of redo.concepts) current.set(c.type, c)
  }

  const thumbs = CONCEPT_TYPES.map((t) => best.get(t)).filter(
    (r): r is ThumbConceptReport => !!r?.file && isValidFile(r.file)
  )
  if (!thumbs.length) throw new Error('Nenhuma thumbnail montada a partir dos conceitos')
  const report: ThumbBriefReport = { ...base, thumbs }
  setState(`thumbBrief.video.${videoId}`, report)
  return thumbs.map((r) => ({ approach: r.concept.type, text: r.concept.text, file: r.file }))
}
