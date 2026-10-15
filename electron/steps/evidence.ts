import { z } from 'zod'
import type { Settings, Video } from '../../shared/types'
import { getState, setState } from '../db/settings'
import { PUBLIC_DOMAIN_UNTIL } from '../../shared/formats/vintage-ads'
import { archiveItem, searchArchiveAds } from '../services/archives'
import { searchAdPages, similarity, type AdPage } from '../services/chroniclingamerica'
import {
  commonsFile,
  parseCommonsAd,
  parseCommonsFile,
  searchCommonsAds,
  searchCommonsGeneral,
  withOcr,
  type Reject
} from '../services/commonsads'
import { LocBlockedError } from '../services/locgate'
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

export function setVideoEvidence(videoId: number, ev: Evidence): void {
  setState(`evidence.video.${videoId}`, ev)
}

// ---------------------------------------------------------------- matching the product in OCR

/** Lowercase letters and digits only: apostrophes, punctuation and inner hyphens are dropped. */
const clean = (w: string): string => w.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * OCR words as comparable tokens. A word ending in a hyphen is joined to the next one
 * ("VEGE-" + "TABLE" → "vegetable"), since old ads hyphenate at line breaks.
 */
export function adTokens(text: string): {
  words: string[]
  tokens: { norm: string; at: number }[]
} {
  const words = text.split(/\s+/).filter(Boolean)
  const tokens: { norm: string; at: number }[] = []
  for (let i = 0; i < words.length; i++) {
    const at = i
    let norm = clean(words[i])
    while (/-$/.test(words[i]) && i + 1 < words.length) norm += clean(words[++i])
    if (norm) tokens.push({ norm, at })
  }
  return { words, tokens }
}

/** Words every patent-medicine name shares; they say nothing about which product it is. */
const GENERIC = new Set(
  'the and of for a an dr drs mrs mr co company inc medicine medicines medical compound vegetable remedy remedies tonic cure cures pills pill oil oils syrup bitters powder powders salve soap tablets elixir balm brand new improved great famous original genuine'.split(
    ' '
  )
)

/** The most distinctive word of a product name: the longest one that is not generic. */
export function productKeyword(product: string): string {
  const words = product.split(/\s+/).map(clean).filter(Boolean)
  const pick = (ws: string[]): string => ws.reduce((a, b) => (b.length > a.length ? b : a), '')
  return pick(words.filter((w) => !GENERIC.has(w) && w.length >= 4)) || pick(words)
}

/**
 * How often an ad's OCR names the product, tolerating OCR noise: a token close to the
 * keyword ("pinkham" for "pinkhams"), containing it, or a run of tokens ≥ 0.8 similar to
 * the whole name. `at` is the OCR word index of the first mention.
 */
export function mentionsOf(
  text: string,
  product: string,
  keyword: string
): { mentions: number; at: number } {
  const { tokens } = adTokens(text)
  const kw = clean(keyword)
  const name = product.split(/\s+/).map(clean).filter(Boolean)
  const joined = name.join('')
  let mentions = 0
  let at = -1
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].norm
    const byKeyword =
      !!kw && (t === kw || similarity(t, kw) >= 0.8 || (kw.length >= 5 && t.includes(kw)))
    const run = tokens
      .slice(i, i + Math.max(1, name.length))
      .map((x) => x.norm)
      .join('')
    const byName = joined.length >= 4 && similarity(run, joined) >= 0.8
    if (!byKeyword && !byName) continue
    mentions++
    if (at < 0) at = tokens[i].at
    if (byName) i += Math.max(0, name.length - 1)
  }
  return { mentions, at }
}

/**
 * Rank searched ads by how well they name the product: more mentions first, then higher OCR
 * confidence, then larger image. Returns the winner and why each other page was dropped.
 */
export function rankAds(
  pages: AdPage[],
  product: string,
  keyword = productKeyword(product)
): { best: Evidence | null; rejected: string[] } {
  const rejected: string[] = []
  const ranked: { page: AdPage; mentions: number; at: number }[] = []
  for (const page of pages) {
    const label = `${page.newspaper}, ${page.date}`
    if (!page.ocrText?.trim()) {
      rejected.push(`${label}: OCR sem texto legível`)
      continue
    }
    const m = mentionsOf(page.ocrText, product, keyword)
    if (!m.mentions) rejected.push(`${label}: o texto não cita “${keyword}”`)
    else ranked.push({ page, ...m })
  }
  ranked.sort(
    (a, b) =>
      b.mentions - a.mentions ||
      (b.page.ocrConfidence ?? 0) - (a.page.ocrConfidence ?? 0) ||
      (b.page.pixels ?? 0) - (a.page.pixels ?? 0)
  )
  const top = ranked[0]
  if (!top) return { best: null, rejected }
  for (const r of ranked.slice(1))
    rejected.push(`${r.page.newspaper}, ${r.page.date}: perdeu para um anúncio melhor`)
  const { words } = adTokens(top.page.ocrText ?? '')
  return {
    best: {
      page: top.page,
      phrase: words.slice(top.at, top.at + Math.max(product.split(/\s+/).length, 6)).join(' '),
      excerpt: words.slice(Math.max(0, top.at - 100), top.at + 250).join(' ')
    },
    rejected
  }
}

/** The best ad among searched pages, or null when none names the product. */
export function bestAd(pages: AdPage[], product: string, keyword?: string): Evidence | null {
  return rankAds(pages, product, keyword).best
}

// ---------------------------------------------------------------- searching

const termsSchema = z.object({
  product: z.string(),
  keyword: z.string(),
  terms: z.array(z.string()).max(4),
  categories: z.array(z.string()).max(4)
})

/** Product name, its most distinctive word, short search variants and Commons categories. */
async function productTerms(
  topic: string,
  settings: Settings,
  signal?: AbortSignal
): Promise<z.infer<typeof termsSchema>> {
  return generateStructured(
    `This YouTube documentary topic is about an old advertised product: "${topic}"
Give:
- product: brand and product as printed in old ads (max 5 words), e.g. "Lydia E. Pinkham's Vegetable Compound"
- keyword: its single most distinctive word, the one any ad for it must print, e.g. "Pinkham"
- terms: 2-3 shorter search variants, e.g. ["Pinkham", "Pinkham Vegetable Compound", "Lydia Pinkham"]
- categories: up to 3 Wikimedia Commons categories likely to hold its ads, without "Category:", e.g. ["Lydia E. Pinkham Medicine Company", "Patent medicines", "Advertisements in the United States"]
Return ONLY JSON: {"product": "...", "keyword": "...", "terms": ["..."], "categories": ["..."]}`,
    termsSchema,
    { settings, signal, temperature: 0, effort: 'low' }
  )
}

/** Search terms from the shortest to the longest, without repeats. */
export function searchOrder(product: string, terms: string[]): string[] {
  const seen = new Set<string>()
  return [...terms, product]
    .map((t) => t.trim())
    .filter((t) => {
      const key = t.toLowerCase()
      if (!t || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.length - b.length)
}

type Log = (message: string, level?: 'info' | 'warn') => void

interface Layer {
  name: string
  search: (term: string, reject: Reject) => Promise<AdPage[]>
}

/** Where ads are searched, in order; the first layer with a good ad wins. */
function layers(categories: string[], signal?: AbortSignal): Layer[] {
  return [
    {
      name: 'loc.gov',
      search: (term) =>
        searchAdPages(term, { from: 1880, to: PUBLIC_DOMAIN_UNTIL, limit: 6 }, signal)
    },
    {
      name: 'Commons (Chronicling America)',
      search: (term, reject) => searchCommonsAds(term, 6, signal, reject)
    },
    {
      name: 'Commons (categorias do produto)',
      search: (term, reject) => searchCommonsGeneral(term, categories, 6, signal, reject)
    },
    {
      name: 'Internet Archive',
      search: (term, reject) => searchArchiveAds(term, 6, signal, reject)
    }
  ]
}

const MAX_REJECTS_LOGGED = 6

/**
 * A topic typed by hand has no ad behind it: find one before the script is written. The LLM
 * names the product, its keyword and short variants; each layer (loc.gov within its block
 * gate, the Commons LoC mirrors, Commons in the product's categories, the Internet Archive)
 * is tried with the terms from shortest to longest, and the first good ad is attached.
 */
export async function findVideoEvidence(
  video: Video,
  settings: Settings,
  signal?: AbortSignal,
  log: Log = () => undefined
): Promise<Evidence | null> {
  const known = videoEvidence(video.id)
  if (known) return known
  const q = await productTerms(video.topic, settings, signal)
  if (!q.product.trim()) return null
  const keyword = clean(q.keyword) ? q.keyword : productKeyword(q.product)
  const terms = searchOrder(q.product, q.terms)
  log(
    `Anúncio real: produto “${q.product}”, palavra-chave “${keyword}”, termos ${terms.map((t) => `“${t}”`).join(', ')}`
  )
  for (const layer of layers(q.categories, signal)) {
    for (const term of terms) {
      const dropped: string[] = []
      let pages: AdPage[]
      try {
        pages = await layer.search(term, (title, reason) => dropped.push(`${title}: ${reason}`))
      } catch (error) {
        if (signal?.aborted) throw error
        log(`${layer.name}: ${(error as Error).message}`, 'warn')
        // A blocked loc.gov refuses every term: go straight to the next layer.
        if (error instanceof LocBlockedError) break
        continue
      }
      const read: AdPage[] = []
      for (const p of pages) read.push(await withOcr(p, signal))
      const { best, rejected } = rankAds(read, q.product, keyword)
      const all = [...dropped, ...rejected]
      log(`${layer.name} “${term}”: ${pages.length} resultado(s), ${all.length} descartado(s)`)
      for (const r of all.slice(0, MAX_REJECTS_LOGGED)) log(`  descartado: ${r}`)
      if (all.length > MAX_REJECTS_LOGGED) log(`  … e mais ${all.length - MAX_REJECTS_LOGGED}`)
      if (best) {
        log(`Anúncio escolhido: ${best.page.newspaper}, ${best.page.date} (${layer.name})`)
        rememberTopicEvidence(video.channel_id, video.topic, best)
        setVideoEvidence(video.id, best)
        return best
      }
    }
  }
  return null
}

// ---------------------------------------------------------------- attached by hand

export interface ManualAd {
  /** Commons file page or Internet Archive item */
  url?: string
  /** Local image picked by the user, with what it is and when it ran */
  file?: string
  source?: string
  date?: string
}

/**
 * The ad the user points to when the search found nothing: a Commons file or an Internet
 * Archive item (same public-domain and ≤ 1930 rules as the search) or a local image.
 */
export async function manualEvidence(input: ManualAd, signal?: AbortSignal): Promise<Evidence> {
  let page: AdPage | null = null
  let why = ''
  const reject: Reject = (_title, reason) => {
    why = reason
  }
  const url = input.url?.trim()
  if (url) {
    const commons = /commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i.exec(url)?.[1]
    const archive = /archive\.org\/details\/([^/?#]+)/i.exec(url)?.[1]
    if (commons) {
      const f = await commonsFile(decodeURIComponent(commons).replace(/_/g, ' '), signal)
      if (!f) throw new Error('Arquivo não encontrado no Commons')
      page = parseCommonsAd(f) ?? parseCommonsFile(f, reject)
    } else if (archive) {
      page = await archiveItem(archive, reject, signal)
    } else {
      throw new Error(
        'Cole o link de um arquivo do Commons (…/wiki/File:…) ou de um item do Archive (…/details/…)'
      )
    }
    if (!page) throw new Error(`Não dá para usar este anúncio: ${why || 'sem dados'}`)
  } else if (input.file) {
    page = {
      id: `local:${input.file}`,
      newspaper: input.source?.trim() || 'Arquivo local',
      city: '',
      state: '',
      date: input.date?.trim() ?? '',
      page: '',
      locUrl: '',
      imageUrl: input.file,
      mirror: input.file,
      mirrorPage: '',
      origin: 'local'
    }
  } else throw new Error('Informe um link ou escolha uma imagem')
  const read = await withOcr(page, signal)
  const { words } = adTokens(read.ocrText ?? '')
  return {
    page: read,
    phrase: words.slice(0, 6).join(' '),
    excerpt: words.slice(0, 250).join(' ')
  }
}
