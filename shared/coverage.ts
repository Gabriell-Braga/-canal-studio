import type { RenderScene } from './render'
import { FIRST_MINUTE_SEC } from './shots'
import type { ShotCategory } from './visuals'

/** Longest stretch without real media the render accepts. */
export const MAX_NO_MEDIA_SEC = 2

/** Longest a still image may stay up in the review: 5 s in the first minute, 8 s after. */
export function stillLimit(at: number): number {
  return at < FIRST_MINUTE_SEC ? 5 : 8
}

/** One image or clip on screen: where it starts, how long, and whether it is real media. */
export interface ShotSpan {
  at: number
  sec: number
  src: string
  still: boolean
  /** Paper-texture filler (public-domain AI image): nothing real on screen */
  filler: boolean
  /** Real media, data animation, AI illustration or text card */
  category: ShotCategory
  /** Index of its scene in the props */
  scene: number
}

/**
 * Every shot of the video in order, with its time. Shots carry their seconds (`sec`); a scene
 * without them is split equally, like the render does.
 */
export function shotSpans(scenes: RenderScene[]): ShotSpan[] {
  const out: ShotSpan[] = []
  for (const [k, sc] of scenes.entries()) {
    const shots = [sc, ...(sc.shots ?? [])]
    const equal = (sc.end - sc.start) / shots.length
    let at = sc.start
    for (const sh of shots) {
      const sec = Math.min(sh.sec ?? equal, Math.max(0, sc.end - at))
      out.push({
        at,
        sec,
        src: sh.src,
        // Animations move by themselves: the still-image cadence does not apply.
        still: sh.type === 'image' && !sh.visual,
        filler: !!sh.filler,
        category: sh.category ?? (sh.filler ? 'ai' : 'real'),
        scene: k
      })
      at += sec
    }
  }
  return out
}

/** Stretches before `until` with nothing real on screen: filler shots and gaps between scenes. */
export function noMedia(scenes: RenderScene[], until: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  const add = (from: number, to: number): void => {
    if (to - from < 0.01) return
    const last = out.at(-1)
    if (last && from - last.to < 0.01) last.to = Math.max(last.to, to)
    else out.push({ from, to })
  }
  let t = 0
  for (const s of shotSpans(scenes)) {
    if (s.at >= until) break
    add(t, s.at)
    if (s.filler) add(s.at, Math.min(until, s.at + s.sec))
    t = Math.max(t, s.at + s.sec)
  }
  add(t, until)
  return out
}

/** Stretches without media longer than MAX_NO_MEDIA_SEC; empty when the video may render. */
export function mediaGaps(scenes: RenderScene[], until: number): { from: number; to: number }[] {
  return noMedia(scenes, until).filter((g) => g.to - g.from > MAX_NO_MEDIA_SEC)
}

export interface AnnouncerSpan {
  start: number
  end: number
  quote?: string
}

export interface ReviewReport {
  createdAt: string
  durationSec: number
  noMedia: { from: number; to: number }[]
  noMediaSec: number
  longestStill: { at: number; sec: number; file: string } | null
  longStills: { at: number; sec: number; file: string }[]
  repeated: { file: string; count: number }[]
  rejected: { scene: number; file: string; reason: string }[]
  announcer: AnnouncerSpan[]
  /** Share of the narrated time per kind of shot, 0–1 */
  split?: Record<ShotCategory, number>
  /** Distinct pictures the video's media bank holds */
  bank?: number
  /** Out-of-rule items, pt-BR, shown in red in the final review */
  alerts: string[]
  contactSheet: string | null
}

const fileOf = (src: string): string => decodeURIComponent(src.split('/').pop() ?? src)
const mmss = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Targets of the time split of an Ads on Trial video, 0–1. */
export const MIX = {
  minReal: 0.5,
  animation: [0.15, 0.25] as const,
  maxAi: 0.25,
  maxCards: 0.08,
  minBank: 25
}

const pct = (v: number): string => `${Math.round(v * 100)}%`

/** Share of the time until `until` per category. */
export function timeSplit(spans: ShotSpan[], until: number): Record<ShotCategory, number> {
  const out: Record<ShotCategory, number> = { real: 0, animation: 0, ai: 0, card: 0 }
  for (const s of spans) out[s.category] += Math.max(0, Math.min(s.sec, until - s.at))
  const total = Math.max(1e-6, until)
  for (const k of Object.keys(out) as ShotCategory[]) out[k] /= total
  return out
}

/**
 * The split and card rules (pt-BR alerts): real media at least 50%, animations 15–25%, AI at
 * most 25%, cards at most 8% and never two in a row, a bank of 25 pictures. Card alerts name
 * the scenes (1-based, as the script counts them) that need a visual instead.
 */
export function mixAlerts(spans: ShotSpan[], until: number, bank?: number): string[] {
  const split = timeSplit(spans, until)
  const out: string[] = []
  if (split.real < MIX.minReal) out.push(`Mídia real ${pct(split.real)} do vídeo (mínimo 50%)`)
  if (split.animation < MIX.animation[0] || split.animation > MIX.animation[1])
    out.push(`Animações e quadro de evidências ${pct(split.animation)} do vídeo (15–25%)`)
  if (split.ai > MIX.maxAi) out.push(`Ilustração de IA ${pct(split.ai)} do vídeo (máximo 25%)`)
  const cardScenes = [
    ...new Set(spans.filter((s) => s.category === 'card').map((s) => s.scene + 1))
  ]
  if (split.card > MIX.maxCards)
    out.push(
      `Cartões de texto ${pct(split.card)} do vídeo (máximo 8%): cenas ${cardScenes.join(', ')} precisam de visual`
    )
  const twice = spans
    .filter((s, i) => s.category === 'card' && spans[i - 1]?.category === 'card')
    .map((s) => `${mmss(s.at)} (cena ${s.scene + 1})`)
  if (twice.length) out.push(`Dois cartões seguidos em ${twice.join(', ')}`)
  if (bank !== undefined && bank < MIX.minBank)
    out.push(`Banco de mídia com ${bank} imagens distintas (mínimo ${MIX.minBank})`)
  return out
}

/**
 * Alerts that stop an Ads on Trial render: the same image past 3 uses, stills past the
 * cadence, and the time split and card rules.
 */
export function pacingAlerts(alerts: string[]): string[] {
  return alerts.filter((a) =>
    /^(Mesma imagem|Imagem parada|Mídia real|Animações e quadro|Ilustração de IA|Cartões de texto|Dois cartões|Banco de mídia)/.test(
      a
    )
  )
}

/** The automatic review of a rendered video: media coverage, stills, repeats, announcer. */
export function buildReport(
  scenes: RenderScene[],
  until: number,
  announcer: AnnouncerSpan[],
  rejected: ReviewReport['rejected'],
  /** Ads on Trial: check the time split and card rules (with the bank size when known) */
  mix?: { bank?: number }
): Omit<ReviewReport, 'createdAt' | 'contactSheet'> {
  const spans = shotSpans(scenes)
  const gaps = noMedia(scenes, until)
  const stills = spans
    .filter((s) => s.still && !s.filler)
    .map((s) => ({ at: s.at, sec: s.sec, file: fileOf(s.src) }))
  const longestStill = stills.reduce<(typeof stills)[number] | null>(
    (a, b) => (!a || b.sec > a.sec ? b : a),
    null
  )
  const longStills = stills.filter((s) => s.sec > stillLimit(s.at) + 0.05)
  const counts = new Map<string, number>()
  for (const s of spans)
    if (!s.filler && s.category !== 'animation') counts.set(s.src, (counts.get(s.src) ?? 0) + 1)
  const repeated = [...counts]
    .filter(([, n]) => n > 1)
    .map(([src, count]) => ({ file: fileOf(src), count }))
    .sort((a, b) => b.count - a.count)

  const alerts: string[] = []
  const big = gaps.filter((g) => g.to - g.from > MAX_NO_MEDIA_SEC)
  if (big.length)
    alerts.push(
      `Trechos sem mídia acima de ${MAX_NO_MEDIA_SEC} s: ${big.map((g) => `${mmss(g.from)}–${mmss(g.to)}`).join(', ')}`
    )
  for (const s of longStills)
    alerts.push(
      `Imagem parada ${s.sec.toFixed(1)} s em ${mmss(s.at)} (máximo ${stillLimit(s.at)} s): ${s.file}`
    )
  for (const r of repeated.filter((r) => r.count > 3))
    alerts.push(`Mesma imagem ${r.count} vezes (máximo 3): ${r.file}`)
  const early = announcer.filter((a) => a.start < 60)
  if (early.length)
    alerts.push(`Locutor antes de 60 s: ${early.map((a) => mmss(a.start)).join(', ')}`)
  if (announcer.length > 3) alerts.push(`${announcer.length} trechos de locutor (máximo 3)`)
  announcer.forEach((a, i) => {
    const prev = announcer[i - 1]
    if (prev && a.start - prev.start < 90)
      alerts.push(`Locutor em ${mmss(prev.start)} e ${mmss(a.start)} com menos de 90 s entre eles`)
  })
  if (mix) alerts.push(...mixAlerts(spans, until, mix.bank))
  return {
    durationSec: until,
    noMedia: gaps,
    noMediaSec: gaps.reduce((t, g) => t + g.to - g.from, 0),
    longestStill,
    longStills,
    repeated,
    rejected,
    announcer,
    ...(mix ? { split: timeSplit(spans, until), bank: mix.bank } : {}),
    alerts
  }
}
