import { pythonPost } from './python'
import { download } from './pexels'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import {
  cropAd,
  fetchOcrWords,
  locatePhrase,
  relativeTo,
  union,
  type AdPage,
  type Box,
  type OcrWord
} from './chroniclingamerica'

/** A cropped ad with where it came from and the boxes of the phrase to highlight. */
export interface ScanInfo {
  page: AdPage
  phrase: string
  /** Crop of the page, 0–1 of the page */
  crop: Box
  /** Phrase words, 0–1 of the crop */
  highlights: Box[]
  /** Every OCR word inside the crop, 0–1 of the crop: any quote can be highlighted later */
  words: OcrWord[]
  /** Local OCR (Commons crops): mean word confidence 0–100 and the text read */
  ocrConfidence?: number
  ocrText?: string
}

/** Below this mean OCR confidence the highlighter is skipped: the stamp alone shows the claim. */
export const OCR_MIN_CONFIDENCE = 60

export interface OcrResult {
  words: OcrWord[]
  confidence: number
  text: string
}

/** Sidecar OCR words (0–1 boxes, like ALTO) in reading order, joined into the ad's text. */
export function ocrToWords(r: {
  confidence: number
  words: { text: string; conf: number; x: number; y: number; w: number; h: number }[]
}): OcrResult {
  const words = r.words
    .filter((w) => w.text.trim())
    .map(({ text, x, y, w, h }) => ({ text: text.trim(), x, y, w, h }))
  return { words, confidence: r.confidence, text: words.map((w) => w.text).join(' ') }
}

/** Download an image, or copy it when the user picked a local file. */
export async function fetchImage(src: string, out: string, signal?: AbortSignal): Promise<void> {
  if (/^https?:\/\//i.test(src)) await download(src, out, signal)
  else copyFileSync(src, out)
}

/** OCR of a local scan through the Python sidecar (PaddleOCR models). */
export async function localOcr(file: string, signal?: AbortSignal): Promise<OcrResult> {
  try {
    return ocrToWords(
      await pythonPost<Parameters<typeof ocrToWords>[0]>('/ocr', { image_path: file }, signal)
    )
  } catch (error) {
    if (signal?.aborted) throw error
    return { words: [], confidence: 0, text: '' }
  }
}

/**
 * The ad around a phrase: the words of the same column within a band above and below it,
 * so the crop holds the whole ad, not one line. Capped so a page-long column stays legible.
 */
export function adRegion(words: OcrWord[], hit: Box): Box {
  const left = hit.x - 0.04
  const right = hit.x + hit.w + 0.04
  const near = words.filter((w) => {
    const cx = w.x + w.w / 2
    return cx >= left && cx <= right && Math.abs(w.y - hit.y) < 0.14
  })
  const r = union([hit, ...near])
  const w = Math.min(r.w, 0.35)
  const h = Math.min(r.h, 0.4)
  // Only a region larger than the cap is re-centered on the phrase.
  return {
    x: w < r.w ? Math.max(0, hit.x + hit.w / 2 - w / 2) : r.x,
    y: h < r.h ? Math.max(0, hit.y + hit.h / 2 - h / 2) : r.y,
    w,
    h
  }
}

/** Crop the ad holding `phrase` from a newspaper page; writes `<out>.scan.json` beside it. */
export async function scanAd(
  page: AdPage,
  phrase: string,
  out: string,
  signal?: AbortSignal
): Promise<ScanInfo> {
  // A Commons mirror is already the cropped ad, without OCR: read it locally.
  if (page.mirror) {
    await fetchImage(page.mirror, out, signal)
    const ocr = await localOcr(out, signal)
    const words = ocr.confidence >= OCR_MIN_CONFIDENCE ? ocr.words : []
    const hit = locatePhrase(words, phrase)
    const info: ScanInfo = {
      page,
      phrase,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      highlights: hit?.words ?? [],
      words,
      ocrConfidence: ocr.confidence,
      ocrText: ocr.text
    }
    writeFileSync(`${out}.scan.json`, JSON.stringify(info, null, 2))
    return info
  }
  const ocr = await fetchOcrWords(page, signal)
  const hit = locatePhrase(ocr.words, phrase)
  const region = hit ? adRegion(ocr.words, hit) : { x: 0.3, y: 0.3, w: 0.35, h: 0.4 }
  const { crop } = await cropAd(page, region, out, { pad: 0.01 }, signal)
  const info: ScanInfo = {
    page,
    phrase,
    crop,
    highlights: hit ? hit.words.map((b) => relativeTo(crop, b)) : [],
    words: ocr.words
      .filter(
        (w) =>
          w.x >= crop.x &&
          w.y >= crop.y &&
          w.x + w.w <= crop.x + crop.w &&
          w.y + w.h <= crop.y + crop.h
      )
      .map((w) => ({ ...relativeTo(crop, w), text: w.text }))
  }
  writeFileSync(`${out}.scan.json`, JSON.stringify(info, null, 2))
  return info
}

/** Scan data saved next to a scene file, or null for any other media. */
export function readScan(file: string | null): ScanInfo | null {
  if (!file || !existsSync(`${file}.scan.json`)) return null
  try {
    return JSON.parse(readFileSync(`${file}.scan.json`, 'utf8')) as ScanInfo
  } catch {
    return null
  }
}

/** Boxes (0–1 of the crop) of a quote inside a scan, for the highlighter; empty when not found. */
export function quoteBoxes(scan: ScanInfo, quote: string): Box[] {
  return locatePhrase(scan.words ?? [], quote)?.words ?? []
}
