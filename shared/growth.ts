/**
 * Click and retention rules: thumbnails, titles, the opening hook, shorts and topic picks.
 * Every prompt and layout reads them from here, so they can be tuned in one place.
 */

export type ThumbApproach = 'number' | 'product' | 'contrast'

export const THUMB = {
  /** Headline font: condensed, so 2–4 words fit very big */
  font: 'Impact, "Arial Black", sans-serif',
  /** Font size of a one-line headline, share of the 720 px height (~35%) */
  oneLineSize: 0.35,
  /** Font size per line when the headline wraps to two lines */
  twoLineSize: 0.24,
  maxWords: 4,
  colors: {
    accent: '#FFD400',
    text: '#FFFFFF',
    alert: '#FF2B2B',
    stroke: '#000000'
  },
  /** Black outline width around the headline, px */
  stroke: 12,
  /** Brighter, more saturated background: dark thumbnails disappear in the mobile feed */
  photoFilter: 'brightness(1.12) saturate(1.45) contrast(1.12)',
  /** Mobile feed size used by the readability preview */
  preview: { width: 246, height: 138 },
  /** Added to every AI image prompt */
  imageStyle:
    'bright vivid saturated colors, well lit, high contrast, sharp focus, clean simple background, photorealistic, no text, no letters, no logos',
  /** One thumbnail per approach, made in this order */
  approaches: [
    {
      id: 'number',
      label: 'Número chocante',
      brief:
        'A shocking number or before→after figure as the whole headline, e.g. "$250B → $0", "7 YEARS EARLY", "99% GONE". Use a real figure from the facts below. The image is a DIFFERENT subject than the product thumbnail: the company\'s headquarters, flagship store, factory floor or a famous moment of the story, bright and vivid.'
    },
    {
      id: 'product',
      label: 'Produto em destaque',
      brief:
        'The company\'s iconic product that THIS story is about, close up and big, on a vivid solid-color background. Headline of 2–3 words with an emotional twist (e.g. "THEY BURIED IT", "TOO EARLY").'
    },
    {
      id: 'contrast',
      label: 'Antes × depois',
      brief:
        'Split screen: the left image shows the glory days (bright, golden, crowded), the right image the ruin (empty, broken, grey). Headline of 2–3 words naming the turn (e.g. "KING → NOTHING").'
    }
  ] as { id: ThumbApproach; label: string; brief: string }[]
}

export const TITLES = {
  count: 5,
  maxChars: 60,
  /** Each title option uses a different one of these */
  structures: [
    'a question with a specific detail ("Why Did Nokia Hide Its Own iPhone?")',
    'a specific number or date ("The $50 Million Deal Blockbuster Laughed At")',
    'a person\'s name ("The Memo Stephen Elop Wrote That Sank Nokia")',
    'a contradiction ("The Phone Company That Invented the iPhone First")',
    '"The mistake that..." / "The day that..." ("The 2007 Mistake That Killed BlackBerry")'
  ],
  /** Worn-out formula "X did Y. Then Z.": two sentences in one title */
  banned: /[.!?]\s+\S/
}

/** Long video opening, appended to the script rules. */
export const HOOK_RULES = `- Cold open: the hook drops the viewer INTO the most dramatic, surprising moment of the story, told as a scene in the present tense with one concrete detail (a room, a date, a sum of money, a person's words). Not a summary. Never start the hook with a year or "In 19..": context comes later. Then one line of tension (what nobody saw coming). End with a specific promise of what the viewer will find out (2–3 concrete things, e.g. "By the end, you'll know who killed the project, why, and what it cost."), phrased differently each time.
- Scene 1 never opens on the company's founding or a date line ("1865. ..."). Pick up right after the hook; the origin story, if needed, comes later and lasts at most 45 seconds of narration.`

export const SHORTS = {
  /** Seconds of the cut from the full narration, pauses already shrunk */
  minSec: 18,
  maxSec: 32,
  /** Words of the narrated opening claim */
  hookMaxWords: 14,
  /** End on a line that flows back into the opening claim instead of the "watch the full video" card */
  loop: true,
  /** What made our best short work (Nokia, 426 views vs 24–60) */
  winningPattern:
    'Our best short opened with a contradiction about a famous product ("Nokia built a touch-screen phone before the iPhone, then buried it"), named a product everyone knows, and was the shortest. The others opened mid-story ("On the other side of the continent...", "Years later...") and lost viewers in the first second.'
}

/** Stories big channels already told to millions; a fresh angle is required for these. */
export const SATURATED_TOPICS = [
  'Blockbuster vs Netflix',
  'Nokia losing to the iPhone',
  'BlackBerry losing to the iPhone',
  'Kodak inventing the digital camera',
  'Xerox PARC and Apple',
  'MySpace losing to Facebook',
  'Yahoo turning down Google',
  'Enron',
  'Theranos',
  'WeWork',
  'Toys R Us',
  'Sears losing to Amazon'
]
