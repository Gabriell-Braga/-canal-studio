/**
 * Ads on Trial thumbnails, starting from the idea: a briefing (the video's conflict, the
 * question the thumbnail plants, three concepts of different types), a blind two-second test,
 * the real pictures for each element (media bank, then Wikimedia Commons), upscaled and cut
 * out, drawn in a fixed template (T1 portrait + shock, T2 object + secret, T3 split mystery),
 * then checked on the PNG: empty space, occupancy, OCR at feed size, contrast, measured text
 * sizes and a vision score. A concept that fails is redone, three tries in all.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, extname, join, relative } from 'path'
import { z } from 'zod'
import type { ThumbnailProps } from '../../shared/render'
import {
  briefingProblems,
  CONCEPT_TYPES,
  conceptProblems,
  contrastRatio,
  coveredShare,
  DRAWN_ELEMENTS,
  emptyGrid,
  emptyProblems,
  meanLuminance,
  MEDIA_ELEMENTS,
  metricProblems,
  MIN_THUMB_MEDIA_PX,
  ocrConfidence,
  placeholderProblems,
  relLuminance,
  TEMPLATE_OF,
  testimonialOnly,
  textProblems,
  THUMB,
  THUMB_RULES,
  TPL,
  type ConceptType,
  type MeasuredText,
  type TemplateDraw,
  type TemplatePiece,
  type ThumbBriefReport,
  type ThumbConcept,
  type ThumbConceptReport,
  type ThumbMetrics
} from '../../shared/thumb'
import { readScan } from '../services/adscan'
import { hasUpscaler, upscaleImage } from '../services/comfy'
import { isValidFile, probeSize, runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import { pythonPost } from '../services/python'
import { runRender } from '../services/remotion'
import { fetchCandidate } from '../services/stock'
import { searchWikimedia } from '../services/wikimedia'
import { listScenes } from '../db/repo'
import { setState } from '../db/settings'
import { polishSettings } from './polish'
import type { StepContext } from './types'

/** Extra tries for a concept that fails any check: three tries in all. */
const REDOS = 2

const elementSchema = z.object({
  kind: z.enum([...MEDIA_ELEMENTS, ...DRAWN_ELEMENTS]),
  what: z.string().min(1),
  person: z.string().default(''),
  words: z.string().default(''),
  search: z.string().default('')
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
    'CONTRADICTION (template T1: a real portrait cut out big on the left, the text big on the right, a red stamp over the seam). Elements: 1) "portrait" of the real person of the story, 2) "stamp" with the fact that contradicts the text (e.g. "DIED 1883"). Text e.g. "STILL WRITING BACK"',
  secret:
    'SECRET (template T2: the real object cut out big in the center, a red stamp across it, 1-2 words in a column on the left). Elements: 1) "product" (the real bottle, box, label or device) or "ad", 2) "stamp" with what it hid (e.g. "20% ALCOHOL"). Text 1-2 words, e.g. "JUST HERBS?"',
  mystery:
    'MYSTERY (template T3: left half element A full-bleed, right half element B big and tilted, the text in a dark band across the top). Elements: 1) A: "tombstone" (inscription with real name and dates, e.g. "LYDIA E. PINKHAM / 1819–1883") or a real picture, 2) B: "letter" (at most 2 short lines, e.g. "Dear Mrs. Pinkham, / — Lynn, 1903") or a real picture. Text e.g. "WHO WROTE BACK?"'
}

export interface BankItem {
  file: string
  kind?: string
  year?: number
  source: string
  credit: string | null
  /** What the picture shows (Commons title and description) */
  label?: string
  /** Commons search that found it */
  query?: string
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
  `${b.kind ?? 'picture'}: ${(b.label ?? b.credit ?? basename(b.file)).replace(/\s+/g, ' ').slice(0, 140)}`

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
      `You design YouTube thumbnails for "Ads on Trial", a channel that investigates real old ads. The thumbnail must show the video's CONFLICT and plant a question in the viewer's head. Start from the idea, never from the materials. Each type has a fixed template: you only choose what goes in it.
Title (the thumbnail must not repeat its words): "${title}"
Script excerpt: ${story}
${fixed ? `The video's conflict: ${fixed.conflict}\nThe question: ${fixed.question}\n` : ''}
Real pictures in the video's media bank (more are searched on Wikimedia Commons by each element's "search"):
${bank.map((b) => `- ${describe(b)}`).join('\n') || '- none'}

Return JSON:
- "conflict": the conflict of the video in one sentence (e.g. "Women wrote to Lydia Pinkham for advice; she had been dead for 20 years").
- "question": the question the thumbnail must create (e.g. "Who was answering her letters?").
- "concepts": exactly ${types.length} concept(s), one per type, in this order: ${types.join(', ')}.
${types.map((t) => `  - ${TYPE_RULES[t]}${notes[t] ? `\n    The previous ${t} concept was rejected: ${notes[t]}. Make a clearly different one.` : ''}`).join('\n')}
Each concept:
  - "type": its type;
  - "idea": what the image shows, in one sentence;
  - "elements": the elements its template asks for, in that order. Each: {"kind": portrait|product|ad|place|letter|stamp|tombstone, "what": what it shows, "person": full name of the person shown (portraits only, a real person of the story named as such, never a customer from a testimonial), "words": words drawn on it (stamp: at most 12 characters; tombstone: name / dates; letter: at most 2 short lines split by " / "; "" for photos), "search": a short Wikimedia Commons search for the real picture (photos only, e.g. "Lydia Pinkham portrait", "Lydia Pinkham Vegetable Compound bottle"; "" for drawn parts)};
  - "text": at most 4 words (T2: 1-2 words), in English, that do NOT repeat the title's words and complete the question; every word true about whoever is pictured;
  - "accent_word": the one word of "text" that is the conflict point (painted red), or "";
  - "background": "dark";
  - "why_click": why someone would click.
Never: a concept that only works after reading the title; a price without context; a person not named as the face; invented facts or dates.
${problems.length ? `Your previous answer had these problems, fix them: ${problems.join('; ')}\n` : ''}Return ONLY JSON: {"conflict": "...", "question": "...", "concepts": [{"type": "...", "idea": "...", "elements": [{"kind": "...", "what": "...", "person": "", "words": "", "search": ""}], "text": "...", "accent_word": "", "background": "dark", "why_click": "..."}]}`,
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

/** Small JPEG of a picture for the vision model. */
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

const searchOf = (e: ThumbConcept['elements'][number]): string =>
  (e.search || `${e.person} ${e.what}`).trim().slice(0, 80)

const isMedia = (kind: string): boolean => (MEDIA_ELEMENTS as readonly string[]).includes(kind)

/**
 * Real pictures from Wikimedia Commons for the concepts' photo elements (the bank rarely has
 * the product itself or a clean portrait): the first 4 free or credited files per search.
 */
async function commonsMedia(
  concepts: ThumbConcept[],
  dir: string,
  ctx: StepContext
): Promise<BankItem[]> {
  const s = ctx.settings
  const out: BankItem[] = []
  const seen = new Set<string>()
  const searches = [
    ...new Set(concepts.flatMap((c) => c.elements.filter((e) => isMedia(e.kind)).map(searchOf)))
  ]
  for (const q of searches) {
    try {
      const found = await searchWikimedia(
        q,
        { allowCcBy: s.wikimediaAllowCcBy, allowCcBySa: s.wikimediaAllowCcBySa, portrait: true },
        seen,
        ctx.signal
      )
      for (const c of found.slice(0, 4)) {
        seen.add(c.source)
        const file = join(dir, `commons_${c.source.replace(/\W+/g, '_')}.jpg`)
        if (!isValidFile(file)) await fetchCandidate(c, file, ctx.signal)
        out.push({ file, source: c.source, credit: c.credit ?? null, label: c.label, query: q })
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error
      ctx.log(
        `Busca no Commons para a thumbnail ("${q}") falhou: ${(error as Error).message}`,
        'warn'
      )
    }
  }
  return out
}

/**
 * Which picture shows each photo element, checked by eye. A portrait is only the person named
 * in the picture's own record, never a customer from a testimonial. Returns element key
 * "concept.element" → picture.
 */
async function pickMedia(
  concepts: ThumbConcept[],
  pool: BankItem[],
  story: string,
  dir: string,
  ctx: StepContext
): Promise<Map<string, BankItem>> {
  const out = new Map<string, BankItem>()
  const wanted = concepts.flatMap((c, ci) =>
    c.elements.map((e, ei) => ({ key: `${ci}.${ei}`, e })).filter(({ e }) => isMedia(e.kind))
  )
  if (!wanted.length || !pool.length) return out
  // Previews in their own folder: a Commons file already sits in `dir` under the same name.
  const pdir = join(dir, 'preview')
  mkdirSync(pdir, { recursive: true })
  const previews = await Promise.all(pool.map((b) => preview(b.file, pdir, ctx.signal)))
  /** The vision model picks among `images` (pool indexes) for `elements` (wanted indexes). */
  const ask = async (
    elements: number[],
    images: number[]
  ): Promise<{ element: number; image: number }[]> => {
    try {
      const { picks } = await generateStructured(
        `Pick the picture for each thumbnail element. Look at each image (read each file).
${images.map((p, i) => `Image ${i}: ${previews[p]} (${describe(pool[p])})`).join('\n')}
Elements:
${elements.map((k, i) => `${i}: ${wanted[k].e.kind}: ${wanted[k].e.what}${wanted[k].e.person ? ` (must show ${wanted[k].e.person} himself or herself)` : ''}`).join('\n')}
For each element, the image that clearly shows it, big and sharp enough to fill half a thumbnail, or -1. A portrait must be that named person: a customer drawn in an ad testimonial is never them. A product must be the real object (bottle, box, label), not a drawing of a scene. Portraits and products are cut out of their background: prefer a picture on a plain background over one inside a frame, card or scene. Never pick an image whose main subject is something else.
Return ONLY JSON: {"picks": [{"element": 0, "image": 3}]}`,
        pickSchema,
        {
          settings: polishSettings(ctx.settings),
          signal: ctx.signal,
          temperature: 0,
          effort: 'low',
          images: images.map((p) => previews[p])
        }
      )
      return picks
        .filter((p) => elements[p.element] !== undefined && images[p.image] !== undefined)
        .map((p) => ({ element: elements[p.element], image: images[p.image] }))
    } catch (error) {
      if (ctx.signal.aborted) throw error
      ctx.log(`Escolha das imagens da thumbnail falhou: ${(error as Error).message}`, 'warn')
      return []
    }
  }
  const picks = await ask(
    wanted.map((_, i) => i),
    pool.map((_, i) => i)
  )
  // An element left without a picture gets a second look at its own search results alone.
  for (const [k, w] of wanted.entries()) {
    if (picks.some((p) => p.element === k)) continue
    const own = pool.flatMap((b, i) => (b.query === searchOf(w.e) ? [i] : []))
    if (own.length) picks.push(...(await ask([k], own)))
  }
  ctx.log(
    `Imagens da thumbnail: ${wanted
      .map((w, i) => {
        const p = picks.find((x) => x.element === i)
        return `${w.e.kind} → ${p && pool[p.image] ? basename(pool[p.image].file) : 'nenhuma'}`
      })
      .join('; ')}`
  )
  const scan = readScan(pool.find((b) => b.kind === 'ad')?.file ?? null)
  const adText = scan?.ocrText ?? scan?.words.map((w) => w.text).join(' ') ?? ''
  for (const p of picks) {
    const w = wanted[p.element]
    const item = pool[p.image]
    if (!w || !item) continue
    if (w.e.kind === 'portrait') {
      // The face is only someone the picture's own record names, and the story's person.
      const last = w.e.person.trim().split(/\s+/).pop()?.toLowerCase() ?? ''
      const record =
        `${item.credit ?? ''} ${item.label ?? ''} ${item.source} ${basename(item.file)}`.toLowerCase()
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

interface Prepared {
  file: string
  aspect: number
  /** Mean luminance of the subject, 0–1 */
  luminance: number
}

/**
 * A thumbnail picture made ready: Real-ESRGAN 4x when it is under 1600 px on its short side,
 * then cut out without background (cropped to the subject) when `cut`. Cached by file name.
 */
async function prepare(
  item: BankItem,
  cut: boolean,
  dir: string,
  ctx: StepContext
): Promise<Prepared> {
  const base = join(dir, basename(item.file, extname(item.file)))
  let src = item.file
  const size = await probeSize(src)
  if (Math.min(size.width, size.height) < 1600 && hasUpscaler(ctx.settings.comfyPath)) {
    const up = `${base}.x4.png`
    try {
      if (!isValidFile(up)) await upscaleImage(src, up, ctx.settings, ctx.signal)
      src = up
    } catch (error) {
      if (ctx.signal.aborted) throw error
      ctx.log(`Upscale de ${basename(item.file)} falhou: ${(error as Error).message}`, 'warn')
    }
  }
  if (!cut) {
    const { width, height } = await probeSize(src)
    return { file: src, aspect: width / height, luminance: 0.5 }
  }
  const out = `${base}.cut.png`
  const info = `${out}.json`
  if (!isValidFile(out) || !existsSync(info)) {
    const r = await pythonPost<{ luminance: number; width: number; height: number }>(
      '/cutout',
      { image_path: src, out_path: out, trim: true },
      ctx.signal
    )
    writeFileSync(info, JSON.stringify(r))
  }
  const r = JSON.parse(readFileSync(info, 'utf8')) as {
    luminance: number
    width: number
    height: number
  }
  return { file: out, aspect: r.width / r.height, luminance: r.luminance }
}

/** The pieces of a concept in its template; null + reason when an element is missing. */
async function draw(
  c: ThumbConcept,
  media: (ei: number) => BankItem | undefined,
  dir: string,
  ctx: StepContext
): Promise<{ draw: TemplateDraw; credits: string[] } | { problems: string[] }> {
  const problems = placeholderProblems(c, (i) => !!media(i))
  if (problems.length) return { problems }
  const t = TEMPLATE_OF[c.type]
  const visual = c.elements.map((e, i) => ({ e, i })).filter(({ e }) => e.kind !== 'stamp')
  const stamp = c.elements.find((e) => e.kind === 'stamp')?.words ?? ''
  const credits: string[] = []
  const piece = async (
    at: { e: ThumbConcept['elements'][number]; i: number } | undefined,
    cut: boolean
  ): Promise<{ p: TemplatePiece; luminance: number } | null> => {
    if (!at) return null
    const item = media(at.i)
    if (!item)
      return {
        p: { kind: at.e.kind, src: null, aspect: 1, cutout: false, words: at.e.words },
        luminance: 0.5
      }
    const prep = await prepare(item, cut, dir, ctx)
    if (item.credit) credits.push(item.credit)
    return {
      p: {
        kind: at.e.kind,
        src: url(ctx.projectDir, prep.file),
        aspect: prep.aspect,
        cutout: cut,
        words: at.e.words
      },
      luminance: prep.luminance
    }
  }
  const mainAt =
    t === 'T1'
      ? visual.find(({ e }) => e.kind === 'portrait')
      : t === 'T2'
        ? visual.find(({ e }) => e.kind === 'product' || e.kind === 'ad')
        : visual[0]
  const main = await piece(mainAt, t !== 'T3')
  const side = t === 'T3' ? await piece(visual[1], !!visual[1] && isMedia(visual[1].e.kind)) : null
  if (!main) return { problems: ['sem elemento principal'] }
  return {
    draw: {
      template: t,
      title: c.text,
      accentWord: c.accent_word,
      stamp: t === 'T3' ? '' : stamp,
      main: main.p,
      side: side?.p ?? null,
      // A light object goes on a dark board, a dark one on light paper.
      background: main.luminance > 0.5 ? 'dark' : 'light'
    },
    credits
  }
}

/** RGB pixels of an image at a size, through ffmpeg. */
async function rgbOf(
  file: string,
  width: number,
  height: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const raw = `${file}.${width}x${height}.rgb`
  await runTool(
    'ffmpeg',
    [
      '-y',
      '-i',
      file,
      '-vf',
      `scale=${width}:${height}:flags=area`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      raw
    ],
    signal
  )
  const data = new Uint8Array(readFileSync(raw))
  rmSync(raw, { force: true })
  return data
}

const LAYER_FILES = ['bare', 'subject', 'notitle'] as const
const layerFile = (out: string, layer: string): string => out.replace(/\.png$/, `.${layer}.png`)

/** The measured checks of one rendered thumbnail (all but the vision scores). */
async function measure(
  out: string,
  d: TemplateDraw,
  ctx: StepContext
): Promise<
  Omit<ThumbMetrics, 'understand' | 'click' | 'notEmpty' | 'problems'> & { problems: string[] }
> {
  const { width: W, height: H } = TPL
  const problems: string[] = []
  // a) empty space on the 16×9 grid
  const m = THUMB_RULES.measure
  const grid = emptyGrid(await rgbOf(out, m.width, m.height, ctx.signal), m.width, m.height)
  problems.push(...emptyProblems(grid))
  // b) occupancy: what differs from the bare background
  const final = await rgbOf(out, W, H, ctx.signal)
  const bare = await rgbOf(layerFile(out, 'bare'), W, H, ctx.signal)
  const subject = await rgbOf(layerFile(out, 'subject'), W, H, ctx.signal)
  // e) measured text sizes
  let texts: MeasuredText[] = []
  try {
    texts = JSON.parse(readFileSync(`${out}.measure.json`, 'utf8')) as MeasuredText[]
  } catch {
    problems.push('medição dos textos não veio do render')
  }
  const occupancy = coveredShare(
    final,
    bare,
    texts.map((t) => t.rect)
  )
  const subjectShare = coveredShare(subject, bare)
  problems.push(...textProblems(texts))
  // d) title against what is right behind it
  const behind = await rgbOf(layerFile(out, 'notitle'), W, H, ctx.signal)
  const titleLum =
    d.template === 'T2' && d.background === 'light' ? relLuminance(0x1b, 0x17, 0x12) : 1
  const titles = texts.filter((t) => t.role === 'title')
  const contrast = titles.length
    ? Math.min(...titles.map((t) => contrastRatio(titleLum, meanLuminance(behind, W, H, t.rect))))
    : 0
  // c) OCR at the mobile feed size
  const { width: fw, height: fh } = THUMB.preview
  const small = out.replace(/\.png$/, '.feed.png')
  await runTool(
    'ffmpeg',
    ['-y', '-i', out, '-vf', `scale=${fw}:${fh}:flags=lanczos`, small],
    ctx.signal
  )
  let ocr = { min: 0, missing: ['OCR indisponível'] }
  try {
    const r = await pythonPost<{ words: { text: string; conf: number }[] }>(
      '/ocr',
      { image_path: small },
      ctx.signal
    )
    ocr = ocrConfidence(`${d.title} ${d.stamp}`.split(/\s+/), r.words)
  } catch (error) {
    if (ctx.signal.aborted) throw error
  }
  const cap = (role: MeasuredText['role'][]): number | null => {
    const list = texts.filter((t) => role.includes(t.role)).map((t) => t.cap)
    return list.length ? Math.round(Math.min(...list)) : null
  }
  return {
    emptyPct: Math.round(grid.share * 1000) / 10,
    occupancyPct: Math.round(occupancy * 1000) / 10,
    subjectPct: Math.round(subjectShare * 1000) / 10,
    ocr: Math.round(ocr.min),
    ocrMissing: ocr.missing,
    contrast: Math.round(contrast * 10) / 10,
    caps: { title: cap(['title']) ?? 0, stamp: cap(['stamp']), other: cap(['other', 'letter']) },
    problems
  }
}

const scoreSchema = z.object({
  scores: z.array(
    z.object({
      image: z.number().int(),
      understand: z.number(),
      click: z.number(),
      not_empty: z.number(),
      note: z.string()
    })
  )
})

type Scores = { understand: number; click: number; notEmpty: number; note: string }

/** Vision scores of each thumbnail at feed size (246×138); null when the check cannot run. */
async function scoreThumbs(
  files: string[],
  conflict: string,
  ctx: StepContext
): Promise<(Scores | null)[]> {
  const { width, height } = THUMB.preview
  try {
    const { scores } = await generateStructured(
      `These are YouTube thumbnails at the real size of the mobile home feed (${width}×${height} px). Look at each image (read each file). The video's conflict: "${conflict}".
${files.map((f, i) => `Image ${i}: ${f}`).join('\n')}
Score each from 1 to 10, strictly, as a viewer scrolling past:
- understand: I get what the video is about in 2 seconds
- click: I want to click
- not_empty: nothing looks empty or too small
"note": the single biggest problem, in a few words.
Return ONLY JSON: {"scores": [{"image": 0, "understand": 0, "click": 0, "not_empty": 0, "note": "..."}]}`,
      scoreSchema,
      {
        settings: polishSettings(ctx.settings),
        signal: ctx.signal,
        temperature: 0,
        effort: 'low',
        images: files
      }
    )
    return files.map((_, i) => {
      const s = scores.find((x) => x.image === i)
      return s
        ? { understand: s.understand, click: s.click, notEmpty: s.not_empty, note: s.note }
        : null
    })
  } catch (error) {
    if (ctx.signal.aborted) throw error
    ctx.log(`Avaliação das thumbnails indisponível: ${(error as Error).message}`, 'warn')
    return files.map(() => null)
  }
}

/**
 * Text under the minimum size never wins over one that reads; then fewer problems; on a tie,
 * the higher lowest score.
 */
const rankOf = (r: ThumbConceptReport): number =>
  -(r.metrics?.problems.filter((p) => /altura de maiúscula|margem|relógio/.test(p)).length ?? 99) *
    10_000 -
  (r.metrics?.problems.length ?? 99) * 100 +
  Math.min(r.metrics?.understand ?? 0, r.metrics?.click ?? 0, r.metrics?.notEmpty ?? 0)

/** A concept given by hand (job args `concepts`): `texts` are the titles to try in order. */
type FixedConcept = ThumbConcept & { texts?: string[] }

/**
 * Three concept thumbnails (contradiction, secret, mystery) in `outDir`, with the briefing,
 * checks and scores kept for the final review (state `thumbBrief.video.<id>`).
 */
export async function conceptThumbs(
  videoId: number,
  ctx: StepContext,
  outDir: string,
  title: string,
  story: string
): Promise<{ approach: string; text: string; file: string }[]> {
  const dir = join(ctx.projectDir, 'thumbs', 'media')
  mkdirSync(dir, { recursive: true })
  const bank = await mediaBank(ctx.projectDir, videoId)
  ctx.log(`Thumbnail: banco com ${bank.length} imagem(ns) de pelo menos ${MIN_THUMB_MEDIA_PX} px`)

  const fixed = ctx.jobArgs?.concepts as FixedConcept[] | undefined
  const first = fixed?.length
    ? {
        conflict: String(ctx.jobArgs?.conflict ?? ''),
        question: String(ctx.jobArgs?.question ?? ''),
        concepts: fixed.map((c) => ({ ...c, text: c.texts?.[0] ?? c.text }))
      }
    : await briefing([...CONCEPT_TYPES], {}, title, story, bank, ctx)
  const base = { conflict: first.conflict, question: first.question }
  ctx.log(`Conflito: ${base.conflict} · Pergunta: ${base.question}`)
  const current = new Map<ConceptType, ThumbConcept>(first.concepts.map((c) => [c.type, c]))
  const best = new Map<ConceptType, ThumbConceptReport>()
  const credits = new Map<ConceptType, string[]>()
  let pending = first.concepts.map((c) => c.type)

  for (let round = 0; round <= REDOS && pending.length; round++) {
    const notes: Partial<Record<ConceptType, string>> = {}
    const concepts = pending.map((t) => current.get(t) as ThumbConcept)
    // 1. Two-second test: the concept alone has to say what the video is about.
    let blind: ({ about: string; question: string; ok: boolean } | null)[] = concepts.map(
      () => null
    )
    if (!fixed?.length)
      try {
        blind = await blindTest(concepts, base.conflict, ctx)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        ctx.log(`Teste dos 2 segundos indisponível: ${(error as Error).message}`, 'warn')
      }
    // 2. Real pictures: the bank, then Commons; picked by eye.
    // Commons first: searched for these very elements.
    const pool = [...(await commonsMedia(concepts, dir, ctx)), ...bank.slice(0, 14)]
    const media = await pickMedia(concepts, pool, story, dir, ctx)
    const stills: {
      type: ConceptType
      out: string
      draw: TemplateDraw
      blind: ThumbConceptReport['blind']
    }[] = []
    for (const [ci, c] of concepts.entries()) {
      if (blind[ci] && !blind[ci]?.ok) {
        notes[c.type] = `quem viu só a thumbnail achou que o vídeo era sobre "${blind[ci]?.about}"`
        ctx.log(`Thumbnail ${c.type} reprovada no teste dos 2 segundos: ${notes[c.type]}`, 'warn')
        if (round < REDOS) continue
      }
      const made = await draw(c, (ei) => media.get(`${ci}.${ei}`), dir, ctx)
      if ('problems' in made) {
        notes[c.type] = made.problems.join('; ')
        ctx.log(`Thumbnail ${c.type}: ${notes[c.type]} (troca de conceito)`, 'warn')
        continue
      }
      credits.set(c.type, made.credits)
      const out = join(outDir, `thumb_${CONCEPT_TYPES.indexOf(c.type) + 1}_r${round}_${c.type}.png`)
      stills.push({ type: c.type, out, draw: made.draw, blind: blind[ci] })
    }
    if (stills.length) {
      // 3. Render the thumbnail and its check layers.
      const props = (d: TemplateDraw): ThumbnailProps => ({
        approach: '',
        layout: 'template',
        format: 'vintage-ads',
        background: '',
        text: d.title,
        template: d
      })
      await runRender(
        {
          mode: 'stills',
          root: ctx.projectDir,
          out: '',
          stills: stills.flatMap((st) => [
            { out: st.out, props: { ...props(st.draw), approach: st.type } },
            ...LAYER_FILES.map((layer) => ({
              out: layerFile(st.out, layer),
              props: props({ ...st.draw, layers: layer })
            }))
          ])
        },
        join(ctx.projectDir, 'thumb-job.json'),
        { log: (m) => ctx.log(m), signal: ctx.signal }
      )
      // 4. Measured checks, then the vision score on the feed-size copies.
      const measured: Awaited<ReturnType<typeof measure>>[] = []
      for (const st of stills) measured.push(await measure(st.out, st.draw, ctx))
      const scores = await scoreThumbs(
        stills.map((st) => st.out.replace(/\.png$/, '.feed.png')),
        base.conflict,
        ctx
      )
      stills.forEach((st, i) => {
        const s = scores[i]
        const m = measured[i]
        const values = {
          ...m,
          understand: s?.understand ?? null,
          click: s?.click ?? null,
          notEmpty: s?.notEmpty ?? null
        }
        const metrics: ThumbMetrics = {
          ...values,
          problems: [...m.problems, ...metricProblems(values)]
        }
        const entry: ThumbConceptReport = {
          file: st.out,
          concept: current.get(st.type) as ThumbConcept,
          blind: st.blind,
          scores: s
            ? {
                understand: s.understand,
                click: s.click,
                readable: m.ocr / 10,
                stands_out: s.notEmpty,
                note: s.note
              }
            : null,
          attempts: round + 1,
          metrics,
          credits: credits.get(st.type) ?? []
        }
        const prev = best.get(st.type)
        if (!prev || rankOf(entry) > rankOf(prev)) best.set(st.type, entry)
        else best.set(st.type, { ...prev, attempts: round + 1 })
        ctx.log(
          `Thumbnail ${st.type} (tentativa ${round + 1}): vazio ${metrics.emptyPct}%, ocupação ${metrics.occupancyPct}%, sujeito ${metrics.subjectPct}%, OCR ${metrics.ocr}, contraste ${metrics.contrast}:1, notas ${s ? `${s.understand}/${s.click}/${s.notEmpty}` : '—'}`
        )
        if (metrics.problems.length) {
          notes[st.type] = metrics.problems.join('; ')
          ctx.log(`Thumbnail ${st.type} reprovada: ${notes[st.type]}`, 'warn')
        }
      })
    }
    pending = pending.filter((t) => notes[t])
    if (!pending.length || round === REDOS) break
    if (fixed?.length) {
      // Concepts given by hand: the next title of each, same pictures.
      for (const t of pending) {
        const f = fixed.find((c) => c.type === t)
        const next = f?.texts?.[round + 1]
        if (next) current.set(t, { ...(current.get(t) as ThumbConcept), text: next })
      }
      pending = pending.filter((t) => fixed.find((c) => c.type === t)?.texts?.[round + 1])
      continue
    }
    const redo = await briefing(pending, notes, title, story, bank, ctx, base)
    for (const c of redo.concepts) current.set(c.type, c)
  }

  const thumbs = CONCEPT_TYPES.map((t) => best.get(t)).filter(
    (r): r is ThumbConceptReport => !!r?.file && isValidFile(r.file)
  )
  if (!thumbs.length) throw new Error('Nenhuma thumbnail montada a partir dos conceitos')
  const report: ThumbBriefReport = {
    ...base,
    thumbs,
    credits: [...new Set(thumbs.flatMap((t) => t.credits ?? []))]
  }
  setState(`thumbBrief.video.${videoId}`, report)
  return thumbs.map((r) => ({ approach: r.concept.type, text: r.concept.text, file: r.file }))
}
