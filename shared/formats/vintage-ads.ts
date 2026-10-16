import { z } from 'zod'
import type { Script } from '../types'
import type { FormatPack } from './types'

/** Verdicts the Claim Check stamp can show. */
export const VERDICTS = ['TRUE', 'FALSE', 'HALF-TRUE', 'NO EVIDENCE'] as const

/** Laws and agencies that ended (or did not end) each kind of ad. */
export const AD_LAWS = [
  'Pure Food and Drug Act 1906',
  'FTC Act 1914',
  'Wheeler-Lea Act 1938',
  'FD&C Act 1938'
]

/** Brand of "Ads on Trial": aged paper, ink and a rubber-stamp red. */
export const ADS_ON_TRIAL = {
  paper: '#EDE3CB',
  ink: '#1B1712',
  stamp: '#C2211C',
  fonts: {
    title: 'Abril Fatface',
    stamp: 'Oswald',
    type: 'Special Elite',
    card: 'Old Standard TT',
    hand: 'Homemade Apple'
  }
}

/** Latest publication year that is public domain in the US (in 2026). */
export const PUBLIC_DOMAIN_UNTIL = 1930

/**
 * "Ads on Trial": each video investigates one real old ad (1880–1930) from digitized
 * newspapers: what it promised, who was behind it, what was true and what happened next.
 */
export const vintageAds: FormatPack = {
  id: 'vintage-ads',
  name: 'Anúncios antigos (Ads on Trial)',
  description:
    'Cada vídeo investiga um anúncio real de jornal (1880–1930): promessa, quem estava por trás, o que era verdade e o que aconteceu depois.',
  scriptRules: {
    hook: `The video opens full screen on the real scan with the ad's main promise highlighted: put that promise, word for word, in hook_ad_quote. The FIRST sentence states the story's conflict, the contradiction that makes the ad strange (e.g. "Thousands of women wrote to Lydia Pinkham for advice. She had been dead for twenty years."), never where or when the ad was printed. The NARRATOR (never the period announcer) reads or comments that promise in the first 5 seconds, then one sentence that makes the stakes concrete (who bought it, how many, what it cost). The opening talks about the story and the promise, never about the newspaper where the ad was found (its name, town or date go only on the provenance card). By 8 seconds the viewer knows exactly which ad and which promise this is.`,
    rehook:
      'Before 25 seconds, ask one concrete question the video answers at the end (e.g. "So what was actually in the bottle?"). Write it fresh for this ad.',
    body: `Every quote from the ad is LITERAL text from its OCR (fix only obvious OCR typos); pick them from the ad's headline and promise lines (the claim, slogan, price or "write to..." call), never from testimonials, letters, addresses, fine print or other articles on the page. ad_quote goes only on Claim Check scenes (the scene where that promise is tested), 6 to 20 words; the narration of the scene before it must not quote it again. Never invent quotes and never attribute words to real people without a named source.
The narrator is calm and investigative, never mocking the people who bought it: the fun comes from the evidence.
Prices: whenever the ad (or the story) gives a price, set that scene's price to the amount and the year; the app converts it to today's money, so never do the math in the narration ("one dollar, about eighteen of today's dollars" is said only if you are sure of the figure from the app; prefer "a full day's wages").
scan: true for scenes that show the ad's scan itself (at least the first scene and every scene with an ad_quote).
Never name places, dates or people about the ad that are not in its OCR text or in a named source.
Pacing: the first Claim Check comes within the first 2:30 (about 375 words of narration from the start of the hook). Never tell the whole biography before the tests: give only the background the next Claim Check needs, then test, then the next piece of the life story, then the next test.
Target 8–12 minutes only when the evidence fills them; never pad.`,
    ending:
      'Close with the fixed segment "Would it run today?": which law or agency ended this kind of ad (Pure Food and Drug Act 1906, FTC Act 1914, Wheeler-Lea Act 1938, FD&C Act 1938), or how the same promise still runs today in new clothes. Then a hook for the next ad of the series and at most one short invitation to subscribe.',
    banned: ['Back in the day', 'Believe it or not', "You won't believe"],
    structures: [
      {
        id: 'investigation',
        name: 'Investigação',
        outline:
          "open on the ad's promise in the period voice, follow the money and the people behind it, test each promise with a Claim Check, show the fall, end on the verdict"
      },
      {
        id: 'scam-timeline',
        name: 'Linha do tempo de um golpe',
        outline:
          'the first ad, the escalation (bigger and bigger ads, prices rising, Price Tag each time), the exposé, and what came after'
      },
      {
        id: 'one-price',
        name: 'Um preço, uma época',
        outline:
          'one ad with a price becomes a window into that year: wages, rent, what that money bought, always with a Price Tag'
      }
    ]
  },
  titleRules: {
    count: 5,
    maxChars: 70,
    rules:
      "Every option names the ad's object or promise. Vary the shape between options; avoid starting titles with a year, and never start two titles of the channel the same way.",
    good: [
      "This 1902 Ad Promised to Cure Everything. Here's What Was in the Bottle",
      "Mail This Coupon: The 1920s Belt That 'Recharged' Men",
      'They Invented a Disease to Sell Mouthwash',
      "$4 in 1911: The Most Dangerous 'Health' Product You Could Order"
    ],
    banned: ['The <year> Ad That…', "You Won't Believe…"]
  },
  // Built from the video's conflict by electron/steps/vintagethumb.ts, one concept each.
  thumbModels: [
    {
      id: 'contradiction',
      label: 'A · Contradição',
      layout: 'concept',
      brief: 'Two elements that could not exist together. "image": "" (built from the briefing).'
    },
    {
      id: 'secret',
      label: 'B · Segredo',
      layout: 'concept',
      brief: 'The product and what it hid. "image": "" (built from the briefing).'
    },
    {
      id: 'mystery',
      label: 'C · Mistério',
      layout: 'concept',
      brief: 'The question of the video as a picture. "image": "" (built from the briefing).'
    }
  ],
  overlays: [
    {
      id: 'adVoice',
      label: 'Locutor de época',
      rules:
        'hook_ad_quote: the main promise of the ad, word for word, highlighted on the scan in the opening and read by the narrator (the period announcer never reads it). ad_quote: only on Claim Check scenes, the literal headline or promise line (6–20 words) the period announcer reads when that promise is tested, else "". At most 3 in the video, never in the first minute.',
      scriptFields: { hook_ad_quote: z.string().default('') },
      sceneFields: { ad_quote: z.string().default('') }
    },
    {
      id: 'priceTag',
      label: 'Price Tag (então → hoje)',
      rules:
        'price: for each scene, {"usd": amount in dollars as printed, "year": year it was charged} when the scene shows or says a price, else null.',
      sceneFields: {
        price: z
          .object({ usd: z.number().positive(), year: z.number().int() })
          .nullable()
          .default(null)
      }
    },
    {
      id: 'claimCheck',
      label: 'Claim Check (carimbo)',
      rules: `claims: the ad's promises tested in the video, in order: {"scene": scene number (1-based) where it is checked, "quote": the literal phrase from the ad, "verdict": one of ${VERDICTS.map((v) => `"${v}"`).join(', ')}, "source": the named source of the verdict (FDA or FTC report, a JAMA article of the time, a court case or a book, with year)}. A claim without a real source gets no stamp, so leave it out.`,
      scriptFields: {
        claims: z
          .array(
            z.object({
              scene: z.number().int(),
              quote: z.string().min(1),
              verdict: z.enum(VERDICTS),
              source: z.string()
            })
          )
          .default([])
      }
    },
    {
      id: 'paperTrail',
      label: 'Paper Trail (procedência)',
      rules:
        'scan: for each scene, true when it shows the ad scan itself (the app adds the newspaper, city, date and page the first time).',
      sceneFields: { scan: z.boolean().default(false) }
    },
    {
      id: 'whatWasInside',
      label: 'What Was Inside (rótulo)',
      rules:
        'ingredients: only when a lab analysis of the time or an AMA record ("Nostrums and Quackery") exists: {"scene": scene number, "items": ["alcohol 18%", ...], "source": "..."}; else null.',
      scriptFields: {
        ingredients: z
          .object({
            scene: z.number().int(),
            items: z.array(z.string()).min(1).max(6),
            source: z.string()
          })
          .nullable()
          .default(null)
      }
    },
    {
      id: 'verdict',
      label: 'Would It Run Today?',
      rules: `verdict: the closing segment: {"law": one of ${AD_LAWS.map((l) => `"${l}"`).join(', ')} or "Still running" when it runs today in new clothes, "text": one short line (max 14 words) shown on the card}.`,
      scriptFields: {
        verdict: z.object({ law: z.string(), text: z.string() }).nullable().default(null)
      }
    }
  ],
  topicSource: {
    kind: 'both',
    brief:
      'Each video investigates ONE real old ad (1880–1930) found in digitized newspapers: miracle cures, cigarettes "recommended by doctors", electric healing devices, mail-order scams, products that invented a "disease" to sell the cure (like Listerine\'s "halitosis"), absurd prices of the time. The topic is built from the real ad found, never from scratch.',
    examples: [
      'The Electric Belt That Promised to Make Men Young Again',
      'They Invented a Disease to Sell Mouthwash'
    ],
    queries: [
      'cures',
      'guaranteed',
      'doctors recommend',
      'free trial',
      'send no money',
      'electric belt',
      'radium',
      'tonic',
      'reducing'
    ],
    seeds: [
      'Heidelberg Electric Belt',
      "Dr. Williams' Pink Pills for Pale People",
      'Kickapoo Indian Sagwa',
      "Lydia E. Pinkham's Vegetable Compound",
      'Listerine and "halitosis"',
      "Dr. Scott's Electric Hair Brush",
      'Wilshire I-ON-A-CO magnetic collar',
      'Sears mail-order heart remedy'
    ]
  },
  mediaProviders: ['loc', 'wikimedia', 'archive'],
  maxMediaYear: PUBLIC_DOMAIN_UNTIL,
  wikimediaCategories: ['Patent medicines', 'Advertisements in the United States', 'Quackery'],
  voices: {
    narrator: 'af_heart',
    secondary: {
      voice: 'bm_george',
      role: 'reads only the literal text of the ad',
      // Old radio: 300–3400 Hz band, a little saturation, low hiss.
      filter:
        'highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=4,volume=1.6,alimiter=limit=0.9'
    }
  },
  saturatedTopics: [
    'Radithor (mention only, never the main topic)',
    "Clark Stanley's Snake Oil (mention only)",
    '"More Doctors Smoke Camels" (1940s, not public domain; mention only)'
  ],
  shortsRules: {
    minSec: 20,
    maxSec: 30,
    hookMaxWords: 14,
    brief:
      '"One ad, one claim, one verdict": the vertical scan, the claim read word for word, then the verdict by second 20–30. Line 1 is the ad\'s most absurd literal promise.'
  },
  metadataRules: {
    description:
      '2 short paragraphs (max 900 characters) about the ad and what the investigation found. Do not list sources or credits (added separately).',
    categoryId: '27',
    series: ['Miracle Cures', 'Mail-Order Madness', 'What Things Cost']
  }
}

/** Ad fields of one narrated scene (0 = the hook, then the script scenes, then the outro). */
export interface AdSceneData {
  adQuote: string
  price: { usd: number; year: number } | null
  scan: boolean
}

export function adSceneData(script: Script | null, index: number): AdSceneData {
  if (!script) return { adQuote: '', price: null, scan: false }
  if (index === 0) return { adQuote: String(script.hook_ad_quote ?? ''), price: null, scan: true }
  const sc = script.scenes[index - 1]
  if (!sc) return { adQuote: '', price: null, scan: false }
  return {
    adQuote: String(sc.ad_quote ?? ''),
    price: (sc.price as AdSceneData['price']) ?? null,
    scan: !!sc.scan || !!sc.ad_quote
  }
}

const ONES =
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(
    ' '
  )
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** 0–999 999 in words ("one hundred twenty-five"). */
export function numberWords(n: number): string {
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')
  if (n < 1000)
    return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`
  if (n < 1e6)
    return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ''}`
  return String(n)
}

function moneyWords(dollars: number, cents: number): string {
  const d = dollars ? `${numberWords(dollars)} dollar${dollars === 1 ? '' : 's'}` : ''
  const c = cents ? `${numberWords(cents)} cent${cents === 1 ? '' : 's'}` : ''
  return [d, c].filter(Boolean).join(' and ') || 'zero dollars'
}

/** State abbreviations of old ads, expanded only after a comma ("Edgerton, Wis."). */
const STATES: Record<string, string> = {
  Ala: 'Alabama',
  Ariz: 'Arizona',
  Ark: 'Arkansas',
  Cal: 'California',
  Calif: 'California',
  Colo: 'Colorado',
  Conn: 'Connecticut',
  Del: 'Delaware',
  Fla: 'Florida',
  Ga: 'Georgia',
  Ill: 'Illinois',
  Ind: 'Indiana',
  Ia: 'Iowa',
  Kan: 'Kansas',
  Kans: 'Kansas',
  Ky: 'Kentucky',
  La: 'Louisiana',
  Me: 'Maine',
  Md: 'Maryland',
  Mass: 'Massachusetts',
  Mich: 'Michigan',
  Minn: 'Minnesota',
  Miss: 'Mississippi',
  Mo: 'Missouri',
  Mont: 'Montana',
  Neb: 'Nebraska',
  Nebr: 'Nebraska',
  Nev: 'Nevada',
  'N.H': 'New Hampshire',
  'N.J': 'New Jersey',
  'N.M': 'New Mexico',
  'N.Y': 'New York',
  'N.C': 'North Carolina',
  'N.D': 'North Dakota',
  O: 'Ohio',
  Okla: 'Oklahoma',
  Ore: 'Oregon',
  Pa: 'Pennsylvania',
  Penn: 'Pennsylvania',
  'R.I': 'Rhode Island',
  'S.C': 'South Carolina',
  'S.D': 'South Dakota',
  Tenn: 'Tennessee',
  Tex: 'Texas',
  Vt: 'Vermont',
  Va: 'Virginia',
  'W.Va': 'West Virginia',
  Wash: 'Washington',
  Wis: 'Wisconsin',
  Wyo: 'Wyoming'
}
const STATE_RE = new RegExp(
  `,\\s*(${Object.keys(STATES)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/\./g, '\\.'))
    .join('|')})\\.`,
  'g'
)

/** OCR text cleaned for reading: line-break hyphens joined, stray symbols dropped. */
export function cleanOcr(text: string): string {
  return text
    .replace(/([a-z])-\s+([a-z])/g, '$1$2')
    .replace(/[^A-Za-z0-9\s.,;:'’"!?$%&()-]/g, ' ')
    .replace(/(^|\s)[^A-Za-z0-9$&\s]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** An ad line as the announcer reads it: OCR cleaned, abbreviations and prices in words. */
export function speakableAd(text: string): string {
  return expandTitles(
    cleanOcr(text)
      .replace(STATE_RE, (_m, k: string) => `, ${STATES[k]}`)
      .replace(/\$\s?(\d[\d,]*)(?:\.(\d{2}))?/g, (_m, d: string, c?: string) =>
        moneyWords(Number(d.replace(/,/g, '')), Number(c ?? 0))
      )
      .replace(/\b(\d+)\s*cts?\b\.?/gi, '$1 cents')
      .replace(/\bDrs\./g, 'Doctors')
      .replace(/\bCo\.(?=[\s,;:]|$)/g, 'Company')
      .replace(/\bBros\./g, 'Brothers')
      .replace(/\bdoz\.?(?=\s|$)/gi, 'dozen')
      .replace(/\bbot\.?(?=\s|$)/gi, 'bottle')
      .replace(/\s*&\s*/g, ' and ')
  )
}

/**
 * Titles in words, so Kokoro does not stop at their period ("Mrs. Haule" read as a sentence
 * end). "St." is Saint before a name ("St. Louis") unless a capitalized word comes right
 * before it ("Main St."), which is a street.
 */
export function expandTitles(text: string): string {
  return text
    .replace(/\bMrs\./g, 'Missus')
    .replace(/\bMr\./g, 'Mister')
    .replace(/\bDr\./g, 'Doctor')
    .replace(/\b([A-Z][a-z]+) St\./g, '$1 Street')
    .replace(/\bSt\.(?=\s+[A-Z])/g, 'Saint')
}

/** How a proper name is said: a respelling ("Bock") or misaki phonemes ("/bˈɑk/"). */
export type Pronunciations = Record<string, string>

/** The narrator's text as sent to the TTS: titles in words, names as the dictionary says. */
export function speakableNarration(text: string, dict: Pronunciations = {}): string {
  let out = expandTitles(text)
  for (const [name, say] of Object.entries(dict)) {
    if (!name.trim() || !say.trim()) continue
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
    out = out.replace(re, say.startsWith('/') ? `[${name}](${say})` : say)
  }
  return out
}

// ---------------------------------------------------------------- period announcer plan

/** Where the period announcer may speak: never in the hook, rarely, always introduced. */
export const ANNOUNCER = {
  firstSec: 60,
  max: 3,
  gapSec: 90,
  minWords: 6,
  maxWords: 20,
  dictShare: 0.85
}

/** Narrator lines that introduce each announcer segment, in turn. */
export const BRIDGES = [
  "Here's how the ad put it:",
  'The newspaper promised readers:',
  "In the ad's own words:"
]

const SEVERITY: string[] = ['FALSE', 'NO EVIDENCE', 'HALF-TRUE', 'TRUE']

const TESTIMONIAL =
  /\b(I|I'm|I've|I'd|My|my|me|mine)\b|\b(tells how|writes|testif\w*|says she|says he|letter from|cured me|helped me|thanks to)\b|\b(Mrs|Miss|Mr)\.?\s+[A-Z][a-z]+,?\s+(of|from)\s+[A-Z]/
const ADDRESS =
  /\b\d+\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Road|Rd|Place|Blvd)\b|\bBox\s+\d+|\bDept\.?\s+\d+/

/** The OCR sentence that holds the quote ('' when it spans sentences). */
function sentenceOf(quote: string, ocr: string): string {
  return (
    cleanOcr(ocr)
      .split(/(?<=[.!?])\s+/)
      .find((s) => quoteInText(quote, s)) ?? ''
  )
}

const letters = (w: string): string => w.replace(/[’']s$/i, '').replace(/[^A-Za-z]/g, '')

/**
 * Why a line may not go to the period announcer (pt-BR), or null when it may: it must be in
 * the OCR, be the ad's promise (not a testimonial, address or fine print), 6–20 words and
 * mostly real English words (the ad's own proper names do not count against it).
 */
export function quoteProblem(
  quote: string,
  ocr: string,
  isWord: (w: string) => boolean
): string | null {
  const text = cleanOcr(quote)
  if (!text) return 'citação vazia'
  if (!ocr.trim() || !quoteInText(quote, ocr)) return 'não confere com o OCR (✗)'
  const words = text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w))
  if (words.length < ANNOUNCER.minWords)
    return `curta demais (${words.length} palavras; mínimo ${ANNOUNCER.minWords})`
  if (words.length > ANNOUNCER.maxWords)
    return `longa demais (${words.length} palavras; máximo ${ANNOUNCER.maxWords})`
  if (TESTIMONIAL.test(`${text} ${sentenceOf(quote, ocr)}`))
    return 'é depoimento de cliente, não a promessa do anúncio'
  if (ADDRESS.test(text) && !/\bwrite\b/i.test(text)) return 'é endereço ou letra miúda'
  const counted = words
    .map(letters)
    .filter((w) => w && !(/^[A-Z]/.test(w) && !isWord(w.toLowerCase())))
  const known = counted.filter((w) => isWord(w.toLowerCase())).length
  if (counted.length && known / counted.length < ANNOUNCER.dictShare)
    return `OCR ilegível (${Math.round((100 * known) / counted.length)}% de palavras em inglês)`
  return null
}

export interface AnnouncerSegment {
  /** Scene index (1-based script scene, same as the scenes table) */
  scene: number
  quote: string
  /** Seconds into the narration where the scene starts */
  start: number
  /** Narrator line read right before the announcer */
  bridge: string
}

export interface AnnouncerPlan {
  segments: AnnouncerSegment[]
  dropped: { scene: number; quote: string; reason: string }[]
}

/**
 * Which ad lines the period announcer reads: only at Claim Check scenes, never in the first
 * minute, at most 3, 90 s apart, the most damning verdicts first. `startOf` gives the start
 * second of a scene (real audio or an estimate).
 */
export function planAnnouncer(
  script: Script | null,
  ocr: string,
  startOf: (scene: number) => number | null,
  isWord: (w: string) => boolean
): AnnouncerPlan {
  const plan: AnnouncerPlan = { segments: [], dropped: [] }
  if (!script) return plan
  const claims = Array.isArray(script.claims)
    ? (script.claims as { scene?: number; quote?: string; verdict?: string }[])
    : []
  const seen = new Set<number>()
  const ok: { scene: number; quote: string; start: number; rank: number }[] = []
  claims.forEach((c, k) => {
    const scene = Number(c.scene)
    const sc = script.scenes[scene - 1]
    if (!sc || seen.has(scene)) return
    seen.add(scene)
    const quote = String(sc.ad_quote ?? '').trim() || String(c.quote ?? '').trim()
    const drop = (reason: string): void => void plan.dropped.push({ scene, quote, reason })
    if (sc.ad_quote_off) return drop('desligado na revisão')
    const problem = quoteProblem(quote, ocr, isWord)
    if (problem) return drop(problem)
    const start = startOf(scene)
    if (start === null) return drop('cena sem tempo')
    if (start < ANNOUNCER.firstSec) return drop('cai no primeiro minuto')
    const sev = SEVERITY.indexOf(String(c.verdict ?? ''))
    ok.push({ scene, quote, start, rank: (sev < 0 ? SEVERITY.length : sev) * 1000 + k })
  })
  script.scenes.forEach((sc, i) => {
    const quote = String(sc.ad_quote ?? '').trim()
    if (quote && !seen.has(i + 1))
      plan.dropped.push({ scene: i + 1, quote, reason: 'fora de um Claim Check' })
  })
  const picked: typeof ok = []
  for (const c of ok.sort((a, b) => a.rank - b.rank)) {
    const reason =
      picked.length >= ANNOUNCER.max
        ? `limite de ${ANNOUNCER.max} trechos`
        : picked.some((p) => Math.abs(p.start - c.start) < ANNOUNCER.gapSec)
          ? `a menos de ${ANNOUNCER.gapSec} s de outro trecho`
          : ''
    if (reason) plan.dropped.push({ scene: c.scene, quote: c.quote, reason })
    else picked.push(c)
  }
  plan.segments = picked
    .sort((a, b) => a.start - b.start)
    .map((p, i) => ({
      scene: p.scene,
      quote: p.quote,
      start: p.start,
      bridge: BRIDGES[i % BRIDGES.length]
    }))
  return plan
}

/** Review warning for a video without any announcer line: why each candidate was dropped. */
export function announcerNoteFor(plan: AnnouncerPlan): string {
  const why = plan.dropped.map((d) => `cena ${d.scene}: ${d.reason}`).join('; ')
  return `Sem locutor de época: nenhuma citação do anúncio passou no filtro${why ? ` (${why})` : ' (roteiro sem Claim Check com citação)'}`
}

/**
 * Scene start times before any audio exists, from word counts (150 words a minute at speed
 * 1). Index 0 is the hook; the channel intro sits after it.
 */
export function estimatedStarts(
  script: Script,
  opts: { speed: number; pauseSec: number; introSec: number }
): (scene: number) => number {
  const secs = [script.hook, ...script.scenes.map((s) => s.narration)].map(
    (t) => t.split(/\s+/).filter(Boolean).length / (2.5 * opts.speed)
  )
  const starts = [0]
  for (let i = 1; i < secs.length; i++)
    starts.push(starts[i - 1] + secs[i - 1] + opts.pauseSec + (i === 1 ? opts.introSec : 0))
  return (scene) => starts[scene] ?? 0
}

/** The first Claim Check starts by this second of narration. */
export const FIRST_CLAIM_BY_SEC = 150

const PAPER_WORDS = /\b(newspaper|weekly paper|daily paper|gazette|page \d+)\b/i

/**
 * Script pacing and hook rules the model must meet (pt-BR, empty when it does): the first
 * Claim Check by 2:30 (from word counts) and a hook about the conflict, not about the
 * newspaper the ad was found in (its name and town go on the provenance card).
 */
export function scriptProblems(
  script: Script,
  page: { newspaper: string; city?: string }
): string[] {
  const out: string[] = []
  const claims = Array.isArray(script.claims) ? (script.claims as { scene?: number }[]) : []
  const first = Math.min(...claims.map((c) => Number(c.scene)).filter((n) => n > 0))
  const at = estimatedStarts(script, { speed: 1, pauseSec: 0.35, introSec: 0 })
  if (!Number.isFinite(first)) out.push('Nenhum Claim Check no roteiro')
  else if (at(first) > FIRST_CLAIM_BY_SEC)
    out.push(
      `Primeiro Claim Check só em ${Math.floor(at(first) / 60)}:${String(Math.round(at(first) % 60)).padStart(2, '0')} (máximo 2:30)`
    )
  const hook = script.hook.toLowerCase()
  const name = page.newspaper.toLowerCase().replace(/^the\s+/, '')
  const names = [name, ...(page.city ? [page.city.toLowerCase()] : [])].filter((n) => n.length > 2)
  // "Red River Prospector": its first two words ("Red River") already name it.
  const pairs = names.flatMap((n) => {
    const w = n.split(/\s+/)
    return w.length > 2 ? [n, `${w[0]} ${w[1]}`] : [n]
  })
  if (PAPER_WORDS.test(script.hook) || pairs.some((p) => hook.includes(p)))
    out.push('O gancho fala do jornal onde o anúncio foi achado; abra com o conflito da história')
  return out
}

// ---------------------------------------------------------------- unsourced facts

const MONTHS = new Set(
  'january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday'.split(
    ' '
  )
)

const tokens = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[’']s\b/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1)
  )

function covered(term: string, have: Set<string>): boolean {
  const words = [...tokens(term)]
  return (
    words.length > 0 &&
    words.every((w) => have.has(w) || (w.length >= 4 && [...have].some((h) => oneEdit(w, h))))
  )
}

/** Names (capitalized words: people, places) and years a text mentions. */
export function factTerms(text: string, isWord: (w: string) => boolean): string[] {
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    for (const y of sentence.match(/\b(1[5-9]\d\d|20\d\d)\b/g) ?? []) out.push(y)
    for (const m of sentence.matchAll(/[A-Z][\w’'.-]*(?:\s+[A-Z][\w’'.-]*)*/g)) {
      const words = m[0]
        .split(/\s+/)
        .map((w) => w.replace(/[’']s$/, '').replace(/(\w{2})\.$/, '$1'))
      // A capitalized common word opening the sentence ("On", "Claim") is not a name.
      if (m.index === 0) while (words.length && isWord(words[0].toLowerCase())) words.shift()
      const kept = words.filter((w) => !MONTHS.has(w.toLowerCase()))
      if (!kept.length || (kept.length === 1 && isWord(kept[0].toLowerCase()))) continue
      out.push(kept.join(' '))
    }
  }
  return out
}

/**
 * Names, places and years the ad scenes of a script (hook, scan and Claim Check scenes) say
 * but neither the ad's OCR nor the Claim Check sources contain. `fromMeta` marks terms that
 * only the page record holds (the newspaper's town or date), not the ad itself.
 */
export function unsourcedFacts(
  script: Script,
  ocr: string,
  meta: { newspaper: string; city?: string; state?: string; date?: string },
  isWord: (w: string) => boolean
): { term: string; fromMeta: boolean }[] {
  const claims = Array.isArray(script.claims)
    ? (script.claims as { scene?: number; quote?: string; source?: string }[])
    : []
  const claimScenes = new Set(claims.map((c) => Number(c.scene)))
  const texts = [
    script.hook,
    ...script.scenes
      .filter((s, i) => s.scan || String(s.ad_quote ?? '').trim() || claimScenes.has(i + 1))
      .map((s) => s.narration)
  ]
  const have = tokens([ocr, ...claims.map((c) => `${c.quote ?? ''} ${c.source ?? ''}`)].join(' '))
  const metaTokens = tokens([meta.newspaper, meta.city, meta.state, meta.date].join(' '))
  const seen = new Set<string>()
  const out: { term: string; fromMeta: boolean }[] = []
  for (const term of texts.flatMap((t) => factTerms(t, isWord))) {
    const key = term.toLowerCase()
    if (seen.has(key) || covered(term, have)) continue
    seen.add(key)
    // "Taos County" comes from "Red River Prospector, Taos": one shared word is enough.
    out.push({ term, fromMeta: [...tokens(term)].some((w) => metaTokens.has(w)) })
  }
  return out
}

const norm = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9$¢ ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)

/**
 * Whether a quote really is in the ad's OCR text: at least 75% of its words appear there
 * (OCR drops or garbles a few letters). Quotes that fail go to the review as alerts.
 */
export function quoteInText(quote: string, text: string): boolean {
  const words = norm(quote)
  if (!words.length) return true
  const have = new Set(norm(text))
  // OCR misreads a letter here and there ("CHILL" → "CHILI"): one edit is still a match.
  const near = (w: string): boolean =>
    have.has(w) || (w.length >= 4 && [...have].some((h) => oneEdit(w, h)))
  return words.filter(near).length / words.length >= 0.75
}

/** Every literal ad line a script reads or stamps. */
export function adQuotes(script: Script): string[] {
  const claims = Array.isArray(script.claims) ? (script.claims as { quote?: string }[]) : []
  return [
    String(script.hook_ad_quote ?? ''),
    ...script.scenes.map((s) => String(s.ad_quote ?? '')),
    ...claims.map((c) => String(c.quote ?? ''))
  ].filter((q) => q.trim())
}

/** At most one substitution, insertion or deletion between two words. */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}
