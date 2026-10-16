import type { RenderScene } from './render'
import { FIRST_MINUTE_SEC } from './shots'

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
}

/**
 * Every shot of the video in order, with its time. Shots carry their seconds (`sec`); a scene
 * without them is split equally, like the render does.
 */
export function shotSpans(scenes: RenderScene[]): ShotSpan[] {
  const out: ShotSpan[] = []
  for (const sc of scenes) {
    const shots = [sc, ...(sc.shots ?? [])]
    const equal = (sc.end - sc.start) / shots.length
    let at = sc.start
    for (const sh of shots) {
      const sec = Math.min(sh.sec ?? equal, Math.max(0, sc.end - at))
      out.push({ at, sec, src: sh.src, still: sh.type === 'image', filler: !!sh.filler })
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
  /** Out-of-rule items, pt-BR, shown in red in the final review */
  alerts: string[]
  contactSheet: string | null
}

const fileOf = (src: string): string => decodeURIComponent(src.split('/').pop() ?? src)
const mmss = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Alerts that stop an Ads on Trial render: the same image past 3 uses, stills past the cadence. */
export function pacingAlerts(alerts: string[]): string[] {
  return alerts.filter((a) => /^(Mesma imagem|Imagem parada)/.test(a))
}

/** The automatic review of a rendered video: media coverage, stills, repeats, announcer. */
export function buildReport(
  scenes: RenderScene[],
  until: number,
  announcer: AnnouncerSpan[],
  rejected: ReviewReport['rejected']
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
  for (const s of spans) if (!s.filler) counts.set(s.src, (counts.get(s.src) ?? 0) + 1)
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
  return {
    durationSec: until,
    noMedia: gaps,
    noMediaSec: gaps.reduce((t, g) => t + g.to - g.from, 0),
    longestStill,
    longStills,
    repeated,
    rejected,
    announcer,
    alerts
  }
}
