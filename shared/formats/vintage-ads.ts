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
    card: 'Old Standard TT'
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
    hook: "The video opens on the real scan with its most absurd line highlighted: put that line, word for word, in hook_ad_quote (read by the period announcer before the hook). Then, in the narrator's calm investigative voice, one sentence that makes the stakes concrete (who bought it, how many, what it cost). By 8 seconds the viewer knows exactly which ad and which promise this is.",
    rehook:
      'Before 25 seconds, ask one concrete question the video answers at the end (e.g. "So what was actually in the bottle?"). Write it fresh for this ad.',
    body: `Every quote from the ad is LITERAL text from its OCR (fix only obvious OCR typos); put each one in the ad_quote of the scene where it is read, not in the narration. Never invent quotes and never attribute words to real people without a named source.
The narrator is calm and investigative, never mocking the people who bought it: the fun comes from the evidence.
Prices: whenever the ad (or the story) gives a price, set that scene's price to the amount and the year; the app converts it to today's money, so never do the math in the narration ("one dollar, about eighteen of today's dollars" is said only if you are sure of the figure from the app; prefer "a full day's wages").
scan: true for scenes that show the ad's scan itself (at least the first scene and every scene with an ad_quote).
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
  thumbModels: [
    {
      id: 'ad-stamp',
      label: 'A · Anúncio + carimbo',
      layout: 'ad-stamp',
      scan: 'background',
      brief:
        'The real ad scan fills 60% of the frame, slightly tilted, on a plain dark background, with a huge red rubber stamp: "text" is the stamp word ("FALSE", "POISON", "$0.50"), at most one more word. "image": "" (the scan is used).'
    },
    {
      id: 'era-face',
      label: 'B · Rosto da época',
      layout: 'era-face',
      scan: 'background2',
      face: true,
      brief:
        'The real maker or seller of the product (real photo, expression edited) with a red arrow to the product from the scan (the bottle, the belt, the device). "person" is the real maker\'s full name, or "" when there is no photo of a real person. "image": a plain, dark, textured background. Text: 0–2 words.'
    },
    {
      id: 'then-now',
      label: 'C · Então × hoje',
      layout: 'then-now',
      scan: 'background2',
      brief:
        'Split down the middle: left the product from the ad with its old price, right the modern equivalent (generic object) with the price in today\'s money or the verdict. "text" is "OLD → NOW" (e.g. "$1 → $18", "CURE → FALSE"). "image" is the modern equivalent, a plain generic object on a clean background.'
    }
  ],
  overlays: [
    {
      id: 'adVoice',
      label: 'Locutor de época',
      rules:
        'hook_ad_quote: the most absurd line, word for word, read by the period announcer at the very start, before the hook. ad_quote: for each scene, the literal ad text the period announcer reads at the start of that scene (max 30 words), or "".',
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
    narrator: 'bm_lewis',
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

/** Old ad abbreviations read out loud as words ("50 cts." → "50 cents"). */
export function speakableAd(text: string): string {
  return text
    .replace(/\b(\d+)\s*cts?\b\.?/gi, '$1 cents')
    .replace(/\bdoz\.?(?=\s|$)/gi, 'dozen')
    .replace(/\bbot\.?(?=\s|$)/gi, 'bottle')
    .replace(/&/g, 'and')
}
