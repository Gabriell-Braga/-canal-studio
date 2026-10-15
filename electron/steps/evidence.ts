import { z } from 'zod'
import type { Settings, Video } from '../../shared/types'
import { getState, setState } from '../db/settings'
import type { AdPage } from '../services/chroniclingamerica'
import { findAdPages, withOcr } from '../services/commonsads'
import { generateStructured } from '../services/llm'

/** The real ad a topic was born from: the page and the phrase that locates it. */
export interface Evidence {
  page: AdPage
  phrase: string
  /** OCR text around the ad, given to the script writer */
  excerpt: string
}

const topicKey = (channelId: number, topic: string): string =>
  `evidence.topic.${channelId}.${topic.trim().toLowerCase().slice(0, 120)}`

/** Remember the evidence of a suggested topic until the user adds it. */
export function rememberTopicEvidence(channelId: number, topic: string, ev: Evidence): void {
  setState(topicKey(channelId, topic), ev)
}

/** Attach a suggested topic's evidence to the video created from it. */
export function attachEvidence(channelId: number, topic: string, videoId: number): void {
  const ev = getState<Evidence | null>(topicKey(channelId, topic), null)
  if (ev) setState(`evidence.video.${videoId}`, ev)
}

export function videoEvidence(videoId: number): Evidence | null {
  return getState<Evidence | null>(`evidence.video.${videoId}`, null)
}

/**
 * The best ad among searched pages: the one whose OCR names the product most often. The phrase
 * is the OCR words starting at the first mention, so the scan crop can locate it on the page.
 */
export function bestAd(pages: AdPage[], product: string): Evidence | null {
  const name = product.trim()
  if (!name) return null
  const re = new RegExp(
    name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+'),
    'gi'
  )
  let best: { page: AdPage; hits: number; at: number } | null = null
  for (const page of pages) {
    const text = page.ocrText ?? ''
    const hits = [...text.matchAll(re)]
    if (hits.length && (!best || hits.length > best.hits))
      best = { page, hits: hits.length, at: hits[0].index ?? 0 }
  }
  if (!best) return null
  const text = best.page.ocrText ?? ''
  const words = text.slice(best.at).split(/\s+/).filter(Boolean)
  const phrase = words.slice(0, Math.max(name.split(/\s+/).length, 6)).join(' ')
  const from = Math.max(0, best.at - 600)
  return { page: best.page, phrase, excerpt: text.slice(from, from + 1500) }
}

/**
 * A topic typed by hand has no ad behind it: find one before the script is written. The
 * product name comes from the topic; loc.gov is searched first (within its block gate),
 * then the public-domain Commons mirrors (≤ 1930). Found evidence is attached to the video.
 */
export async function findVideoEvidence(
  video: Video,
  settings: Settings,
  signal?: AbortSignal
): Promise<Evidence | null> {
  const known = videoEvidence(video.id)
  if (known) return known
  const { product } = await generateStructured(
    `Name the advertised product (brand and product, as printed in old newspaper ads, max 5 words) this YouTube documentary topic is about: "${video.topic}"
Return ONLY JSON: {"product": "..."}`,
    z.object({ product: z.string() }),
    { settings, signal, temperature: 0, effort: 'low' }
  )
  if (!product.trim()) return null
  const pages: AdPage[] = []
  for (const p of await findAdPages(product, 6, signal)) pages.push(await withOcr(p, signal))
  const ev = bestAd(pages, product)
  if (!ev) return null
  rememberTopicEvidence(video.channel_id, video.topic, ev)
  attachEvidence(video.channel_id, video.topic, video.id)
  return ev
}
