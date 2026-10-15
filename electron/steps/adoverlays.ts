import { priceTag } from '../../shared/cpi'
import { adSceneData, VERDICTS } from '../../shared/formats/vintage-ads'
import type { AdOverlays, RenderScene } from '../../shared/render'
import type { Scene, Script } from '../../shared/types'
import { quoteBoxes, readScan, type ScanInfo } from '../services/adscan'
import { longDate, ORIGIN_LABELS } from '../services/chroniclingamerica'

const STAMP_DELAY = 1.6

/**
 * Overlays of the "Ads on Trial" format, all from real data: prices converted by the CPI
 * table, verdicts only with a named source, provenance from the Library of Congress record.
 * Also returns the highlights each scan scene draws (the quote read over it).
 */
export function adOverlays(
  script: Script | null,
  scenes: Scene[],
  /** false when no real ad is attached to the video: claims are not stamped over scans */
  hasEvidence = true
): { overlays: AdOverlays; scans: Map<number, NonNullable<RenderScene['scan']>> } {
  const overlays: AdOverlays = {
    priceTags: [],
    claims: [],
    paperTrail: null,
    ingredients: null,
    verdict: null
  }
  const scans = new Map<number, NonNullable<RenderScene['scan']>>()
  const scanOf = new Map<number, ScanInfo>()
  for (const sc of scenes) {
    const scan = readScan(sc.asset_path)
    if (scan) {
      scanOf.set(sc.index, scan)
      scans.set(sc.index, { highlights: [] })
    }
  }
  const timed = (i: number): { start: number; end: number } | null => {
    const sc = scenes.find((s) => s.index === i)
    return sc && sc.start_sec !== null && sc.end_sec !== null
      ? { start: sc.start_sec, end: sc.end_sec }
      : null
  }

  for (const sc of scenes) {
    const t = timed(sc.index)
    if (!t) continue
    const data = adSceneData(script, sc.index)
    const scan = scanOf.get(sc.index)
    // The ad line read in the period voice lights up on the scan as it is read.
    if (scan && data.adQuote) {
      const boxes = quoteBoxes(scan, data.adQuote)
      const fallback = sc.index === 0 ? scan.highlights : []
      if (boxes.length || fallback.length)
        scans.get(sc.index)?.highlights.push({ at: 0.3, boxes: boxes.length ? boxes : fallback })
    }
    if (data.price) {
      const tag = priceTag(data.price.usd, data.price.year)
      if (tag)
        overlays.priceTags.push({
          at: t.start + 0.6,
          until: Math.min(t.end, t.start + 6.5),
          then: tag.then,
          today: tag.today,
          estimate: tag.estimate,
          year: data.price.year
        })
    }
    if (scan && !overlays.paperTrail) {
      // A Commons or Internet Archive ad shows its publication, date and file link instead
      // of a newspaper page.
      const origin = scan.page.origin
      overlays.paperTrail = {
        at: t.start + 0.4,
        newspaper: scan.page.newspaper,
        place: origin
          ? ORIGIN_LABELS[origin]
          : [scan.page.city, scan.page.state].filter(Boolean).join(', '),
        date: longDate(scan.page.date),
        page: origin ? '' : String(scan.page.page),
        link: origin ? scan.page.mirrorPage?.replace(/^https?:\/\//, '') || undefined : undefined
      }
    }
  }

  const claims = Array.isArray(script?.claims) ? (script?.claims as Record<string, unknown>[]) : []
  for (const c of claims) {
    const source = String(c.source ?? '').trim()
    const verdict = String(c.verdict ?? '')
    // No source, no stamp.
    if (!source || !(VERDICTS as readonly string[]).includes(verdict)) continue
    const index = Number(c.scene)
    const t = timed(index)
    if (!t) continue
    const quote = String(c.quote ?? '')
    const scan = scanOf.get(index)
    if (scan && !hasEvidence) continue
    if (scan) {
      const boxes = quoteBoxes(scan, quote)
      if (boxes.length) scans.get(index)?.highlights.push({ at: 0.6, boxes })
    }
    overlays.claims.push({ at: t.start + 0.6 + STAMP_DELAY, verdict, quote, source })
  }

  const ing = script?.ingredients as { scene: number; items: string[]; source: string } | null
  const ti = ing ? timed(ing.scene) : null
  if (ing && ti && ing.source?.trim())
    overlays.ingredients = {
      at: ti.start + 0.8,
      until: ti.end,
      items: ing.items,
      source: ing.source
    }

  const v = script?.verdict as { law: string; text: string } | null
  const last = scenes[scenes.length - 1]
  if (v && last?.start_sec != null)
    overlays.verdict = { at: last.start_sec + 0.5, law: v.law, text: v.text }

  return { overlays, scans }
}
