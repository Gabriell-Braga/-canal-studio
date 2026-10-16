/**
 * Ads on Trial visual planning: what each scene shows (search plans and the suggested
 * visual), the data animations built from the script (map, timeline, family tree, label,
 * letter, price counter), the evidence board, and the extra framings of real pictures
 * (detail close-ups and 2.5D parallax), each written as a scenes/shot_<hash>.json file.
 */
import { createHash } from 'crypto'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { priceTag } from '../../shared/cpi'
import type { Box } from '../../shared/render'
import type { Script, Settings } from '../../shared/types'
import {
  projectUs,
  SCENE_VISUALS,
  type SceneVisual,
  type ShotFile,
  type VisualSpec
} from '../../shared/visuals'
import { localOcr } from '../services/adscan'
import { generateStructured } from '../services/llm'
import { pythonPost } from '../services/python'
import { getState, setState } from '../db/settings'
import type { Evidence } from './evidence'
import { polishSettings } from './polish'

/** Visuals drawn from the script's data (they replace text cards). */
export const DATA_VISUALS = ['map', 'timeline', 'tree', 'label', 'letter'] as const

// ---------------------------------------------------------------- search plans

const plansSchema = z.object({
  scenes: z.array(
    z.object({
      scene: z.number().int(),
      shots: z.array(z.string()).min(1).max(6),
      visual: z.enum(SCENE_VISUALS)
    })
  )
})

export interface ScenePlan {
  /** Concrete shots to search for, most literal first */
  terms: string[]
  visual: SceneVisual
}

/** A search term and its short variants ("Pinkham almanac page 1890s" → "Pinkham almanac"). */
export function shortVariants(term: string): string[] {
  const words = term.trim().split(/\s+/).filter(Boolean)
  const out = [words.join(' ')]
  if (words.length > 3) out.push(words.slice(0, 3).join(' '))
  if (words.length > 2) out.push(words.slice(0, 2).join(' '))
  return [...new Set(out)]
}

/**
 * For each scene, 3–5 concrete shots to search for ("Pinkham trade card", "Lynn
 * Massachusetts 1880s street") and the visual that tells it best. The script's own `visual`
 * wins when it has one.
 */
export async function scenePlans(
  scenes: { index: number; narration: string; visual?: string }[],
  topic: string,
  s: Settings,
  signal?: AbortSignal
): Promise<Map<number, ScenePlan>> {
  const out = new Map<number, ScenePlan>()
  for (let i = 0; i < scenes.length; i += 10) {
    const batch = scenes.slice(i, i + 10)
    const { scenes: got } = await generateStructured(
      `A documentary investigates an old ad: "${topic}". For each scene below give:
- "shots": 3 to 5 concrete pictures to search for in museum and library archives (Wikimedia Commons, Wellcome Collection, Smithsonian, Internet Archive), each 2–5 words, period-specific and literal, proper names first (e.g. "Pinkham trade card", "Pinkham almanac page", "Lynn Massachusetts 1880s street", "patent medicine bottle 1890s", "women clerks office 1900"). The first ones show exactly what the narration says, the last ones its place, era, product or kind of object.
- "visual": the visual that tells the scene best: "scan" (the ad itself), "photo" (a real period photo or engraving), "detail" (a close-up of a real picture), "evidence" (proof or a twist: real clippings pinned on a board), "map" (where the ad ran), "timeline" (several key dates), "tree" (family: who died, who took over), "label" (what was inside the product), "letter" (letters written to or answered by someone), "illustration" (an everyday moment no real picture shows: hands writing, a kitchen, a street), "quote" (only for the ad's literal words, a verdict or a key number). Vary them across the video.
${batch.map((sc, k) => `SCENE ${k}: "${sc.narration}"`).join('\n')}
Return ONLY JSON: {"scenes": [{"scene": 0, "shots": ["...", "..."], "visual": "photo"}]} with one entry per scene.`,
      plansSchema,
      { settings: polishSettings(s), signal, temperature: 0.2, effort: 'low' }
    )
    for (const g of got) {
      const sc = batch[g.scene]
      if (!sc) continue
      const own = (SCENE_VISUALS as readonly string[]).includes(sc.visual ?? '')
      out.set(sc.index, {
        terms: g.shots.map((t) => t.trim()).filter(Boolean),
        visual: own ? (sc.visual as SceneVisual) : g.visual
      })
    }
  }
  return out
}

// ---------------------------------------------------------------- shot files

/** Writes a shot file once per content and returns its path. */
export function writeShot(dir: string, shot: ShotFile): string {
  const json = JSON.stringify(shot)
  const file = join(dir, `shot_${createHash('sha1').update(json).digest('hex').slice(0, 12)}.json`)
  if (!existsSync(file)) writeFileSync(file, json)
  return file
}

// ---------------------------------------------------------------- detail and parallax

const iou = (a: Box, b: Box): number => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (w * h) / (a.w * a.h + b.w * b.h - w * h)
}

/**
 * 16:9 close-ups of a picture (0–1 boxes) around its regions of interest (faces, salient
 * objects, headline lines), biggest first: padded, inside the picture, at least `minPx`
 * wide in real pixels, never almost the whole picture, never two alike.
 */
export function pickCrops(
  regions: Box[],
  size: { width: number; height: number },
  max = 3,
  minPx = 640
): Box[] {
  const aspect = size.width / size.height
  const out: Box[] = []
  for (const r of regions) {
    // Region padded by 35%, then grown to 16:9 (in pixels) around its center.
    let w = r.w * 1.35
    let h = r.h * 1.35
    if ((w * aspect) / h < 16 / 9) w = (h * 16) / 9 / aspect
    else h = (w * aspect * 9) / 16
    w = Math.max(w, minPx / size.width)
    h = Math.max(h, (w * aspect * 9) / 16)
    if (w > 0.8 || h > 0.8 || w > 1 || h > 1) continue
    const x = Math.min(Math.max(r.x + r.w / 2 - w / 2, 0), 1 - w)
    const y = Math.min(Math.max(r.y + r.h / 2 - h / 2, 0), 1 - h)
    const crop = { x, y, w, h }
    if (out.some((c) => iou(c, crop) > 0.35)) continue
    out.push(crop)
    if (out.length >= max) break
  }
  return out
}

/** Regions of interest of a picture: faces, then salient objects, then the biggest text lines. */
async function regionsOf(
  file: string,
  signal?: AbortSignal
): Promise<{ regions: Box[]; size: { width: number; height: number } } | null> {
  try {
    const sal = await pythonPost<{ boxes: Box[]; width: number; height: number }>(
      '/salient_regions',
      { image_path: file, count: 4 },
      signal
    )
    const regions: Box[] = []
    const faces = await pythonPost<{ faces: { box: number[] }[]; width: number; height: number }>(
      '/face_info',
      { path: file },
      signal
    ).catch(() => null)
    for (const f of faces?.faces ?? [])
      regions.push({
        x: f.box[0] / faces!.width,
        y: f.box[1] / faces!.height,
        w: f.box[2] / faces!.width,
        h: f.box[3] / faces!.height
      })
    regions.push(...sal.boxes)
    const ocr = await localOcr(file, signal)
    // Headline: the tallest words, grouped by line.
    const tall = [...ocr.words].sort((a, b) => b.h - a.h).slice(0, 6)
    if (tall.length >= 2) {
      const x0 = Math.min(...tall.map((w) => w.x))
      const y0 = Math.min(...tall.map((w) => w.y))
      const x1 = Math.max(...tall.map((w) => w.x + w.w))
      const y1 = Math.max(...tall.map((w) => w.y + w.h))
      if (y1 - y0 < 0.3) regions.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    }
    return { regions, size: { width: sal.width, height: sal.height } }
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

/** Up to 3 detail shot files of a high-resolution picture (none when it is too small). */
export async function detailViews(
  file: string,
  dir: string,
  signal?: AbortSignal
): Promise<string[]> {
  const found = await regionsOf(file, signal)
  if (!found || found.size.width < 1400) return []
  return pickCrops(found.regions, found.size).map((crop) =>
    writeShot(dir, { shot: 'detail', src: file, crop })
  )
}

/** A parallax shot file of a picture with a clear subject, or null. */
export async function parallaxView(
  file: string,
  dir: string,
  signal?: AbortSignal
): Promise<string | null> {
  const depth = file.replace(/\.\w+$/, '.depth.png')
  try {
    if (!existsSync(depth))
      await pythonPost('/depth', { image_path: file, out_path: depth }, signal)
    return writeShot(dir, { shot: 'parallax', src: file, depth })
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

// ---------------------------------------------------------------- data animations

/** "Taos, New Mexico" → map point, through OpenStreetMap's geocoder (cached, 1 per second). */
async function geocode(
  place: string,
  signal?: AbortSignal
): Promise<{ lon: number; lat: number } | null> {
  const key = `geocode.${place.toLowerCase()}`
  const cached = getState<{ lon: number; lat: number } | null | undefined>(key, undefined)
  if (cached !== undefined) return cached
  await new Promise((r) => setTimeout(r, 1100))
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(place)}`,
      { headers: { 'User-Agent': 'CanalStudio/1.0 (documentary maps)' }, signal }
    )
    const [hit] = (await res.json()) as { lon: string; lat: string }[]
    const point = hit ? { lon: Number(hit.lon), lat: Number(hit.lat) } : null
    setState(key, point)
    return point
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

/** Where the video's ads ran: one point per town, in date order. Null under 2 towns. */
export async function mapSpec(
  ads: Evidence[],
  product: string,
  signal?: AbortSignal
): Promise<VisualSpec | null> {
  const towns = new Map<string, { label: string; year?: number }>()
  for (const a of [...ads].sort((x, y) => x.page.date.localeCompare(y.page.date))) {
    if (!a.page.city || !a.page.state) continue
    const place = `${a.page.city}, ${a.page.state}`
    if (!towns.has(place))
      towns.set(place, { label: a.page.city, year: Number(a.page.date.slice(0, 4)) || undefined })
  }
  const points: { label: string; x: number; y: number; year?: number }[] = []
  for (const [place, t] of towns) {
    const g = await geocode(place, signal)
    if (g) points.push({ ...t, ...projectUs(g.lon, g.lat) })
  }
  return points.length >= 2 ? { kind: 'map', title: `Where ${product} was sold`, points } : null
}

const timelineSchema = z.object({
  events: z.array(z.object({ year: z.number().int(), label: z.string() })).max(8)
})
const treeSchema = z.object({
  people: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        born: z.number().int().nullable().default(null),
        died: z.number().int().nullable().default(null),
        role: z.string().default(''),
        parent: z.string().default('')
      })
    )
    .max(8),
  highlight: z.string().default('')
})
const labelSchema = z.object({
  product: z.string(),
  ingredients: z.array(z.string()).max(7),
  stamp: z.string()
})
const letterSchema = z.object({
  lines: z.array(z.string()).max(4),
  signature: z.string(),
  date: z.string().default('')
})

const FACTS_ONLY =
  'Use ONLY facts written in the text below (names, years, numbers, words); never add one. Leave a field empty or the list short rather than guess.'

/**
 * The data of one animation from the script's own facts. Returns null when the text does
 * not hold enough for it (a timeline needs 3 dates, a tree 3 people, a label 3 ingredients).
 */
export async function dataSpec(
  kind: (typeof DATA_VISUALS)[number] | 'counter',
  ctx: {
    narration: string
    story: string
    script: Script | null
    ads: Evidence[]
    product: string
    pictures: { file: string; year?: number }[]
    s: Settings
    signal?: AbortSignal
  }
): Promise<VisualSpec | null> {
  const settings = {
    settings: polishSettings(ctx.s),
    signal: ctx.signal,
    temperature: 0,
    effort: 'low' as const
  }
  const text = `${ctx.narration}\nWhole story: ${ctx.story.slice(0, 5000)}`
  if (kind === 'map') return mapSpec(ctx.ads, ctx.product, ctx.signal)
  if (kind === 'counter') {
    const price = ctx.script?.scenes
      .map((sc) => sc.price as { usd: number; year: number } | null | undefined)
      .find(Boolean)
    const tag = price ? priceTag(price.usd, price.year) : null
    return tag && price
      ? { kind: 'counter', then: tag.then, today: tag.today, year: price.year }
      : null
  }
  if (kind === 'timeline') {
    const { events } = await generateStructured(
      `Key dates of this story for an animated timeline (3 to 7, in order, each label at most 5 words, e.g. {"year": 1875, "label": "First bottles sold"}). ${FACTS_ONLY}\n${text}\nReturn ONLY JSON: {"events": [{"year": 1875, "label": "..."}]}`,
      timelineSchema,
      settings
    )
    const ok = events.filter((e) => text.includes(String(e.year)))
    if (ok.length < 3) return null
    const near = (y: number): string | undefined =>
      ctx.pictures.find((p) => p.year && Math.abs(p.year - y) <= 3)?.file
    return {
      kind: 'timeline',
      events: ok.map((e) => ({ ...e, src: near(e.year) })),
      current: ok.find((e) => ctx.narration.includes(String(e.year)))?.year
    }
  }
  if (kind === 'tree') {
    const t = await generateStructured(
      `The family of this story for an animated family tree: who was who, born and died (years), role (e.g. "founder", "took over 1883"), parent (id of the parent; "" for the oldest). 3 to 8 people, ids short and unique. highlight: id of the person the scene is about. ${FACTS_ONLY}\n${text}\nReturn ONLY JSON: {"people": [{"id": "lydia", "name": "Lydia E. Pinkham", "born": 1819, "died": 1883, "role": "founder", "parent": ""}], "highlight": "lydia"}`,
      treeSchema,
      settings
    )
    if (t.people.length < 3) return null
    return {
      kind: 'tree',
      people: t.people.map((p) => ({
        id: p.id,
        name: p.name,
        born: p.born ?? undefined,
        died: p.died ?? undefined,
        role: p.role || undefined,
        parent: p.parent || undefined
      })),
      highlight: t.highlight || undefined
    }
  }
  if (kind === 'label') {
    const known = ctx.script?.ingredients as { items: string[] } | null | undefined
    const l = await generateStructured(
      `What was inside the product, for an animated label: "product" (its name as printed), "ingredients" (3 to 7, as the text names them), "stamp" (the most surprising one with its amount, e.g. "18–20% ALCOHOL", or ""). ${FACTS_ONLY}\n${known ? `Lab analysis: ${known.items.join(', ')}\n` : ''}${text}\nReturn ONLY JSON: {"product": "...", "ingredients": ["..."], "stamp": "..."}`,
      labelSchema,
      settings
    )
    if (l.ingredients.length < 3) return null
    return {
      kind: 'label',
      product: l.product || ctx.product,
      ingredients: l.ingredients,
      stamp: l.stamp
    }
  }
  const l = await generateStructured(
    `A letter for an animated handwritten letter: 2 to 4 short lines (at most 8 words each) a woman of the time could have written to the company, quoting or closely following the text, the signature of whoever answered ("Lydia E. Pinkham" when the text says the replies were signed in her name) and a date or place line. ${FACTS_ONLY}\n${text}\nReturn ONLY JSON: {"lines": ["Dear Mrs. Pinkham,", "..."], "signature": "...", "date": "Lynn, 1903"}`,
    letterSchema,
    settings
  )
  if (l.lines.length < 2) return null
  return { kind: 'letter', lines: l.lines, signature: l.signature, date: l.date || undefined }
}

/** The evidence board of a scene: 2–5 real clippings (ads first), each with a short caption. */
export function evidenceSpec(items: { file: string; caption?: string }[]): VisualSpec | null {
  const list = items.slice(0, 5)
  return list.length >= 2
    ? { kind: 'evidence', items: list.map((i) => ({ src: i.file, caption: i.caption })) }
    : null
}
