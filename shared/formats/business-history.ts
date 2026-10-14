import { z } from 'zod'
import type { FormatPack } from './types'

/** Rise-and-fall stories of companies: the channel the app was first built for. */
export const businessHistory: FormatPack = {
  id: 'business-history',
  name: 'História de empresas',
  description: 'Ascensão e queda de empresas, com valor da empresa e cartões de ano na tela.',
  scriptRules: {
    hook: `Cold open: the hook drops the viewer INTO the most dramatic, surprising moment of the story, told as a scene in the present tense with one concrete detail (a room, a date, a sum of money, a person's words). Not a summary. Never start the hook with a year or "In 19..": context comes later. Within 5–8 seconds name the exact object, sum or decision the title is about. Then one line of tension (what nobody saw coming).`,
    rehook:
      'Between 15 and 30 seconds: what was at stake in dollars, jobs or market share, and one concrete question the ending answers (e.g. "So why did the board say no to a deal that would have saved them?"). Phrase it fresh each time.',
    body: `Scene 1 never opens on the company's founding or a date line ("1865. ..."). Pick up right after the hook; the origin story, if needed, comes later and lasts at most 45 seconds of narration.
Curiosities: every 60–90 seconds of narration, drop in one surprising, little-known but true detail tightly tied to the topic (a strange decision, a near miss, a hidden connection, an odd number) that makes the viewer say "I didn't know that". Weave it into the story; do not announce it as a "fun fact".`,
    ending: `Outro: slow and calm, never rushed. 3–5 unhurried sentences: first answer the question the re-hook asked and land the story with a clear conclusion (what it meant, what changed because of it), then a hook for the next story of the series (one concrete teaser of another company's turn, without a date promise), and at most ONE short, gentle invitation to subscribe. Never list "like, comment, subscribe and hit the bell", never ask for several actions, never add urgency. The video ends on a black screen with recommended videos right after.`,
    banned: [],
    structures: [
      {
        id: 'rise-fall',
        name: 'Ascensão e queda',
        outline: 'the turning point first, then the rise, the peak, the mistake and the fall'
      },
      {
        id: 'one-decision',
        name: 'Uma decisão',
        outline:
          'one meeting or decision, told almost minute by minute: who was in the room, the options on the table, what they chose, then what it cost over the following years'
      },
      {
        id: 'two-rivals',
        name: 'Dois rivais',
        outline:
          'two companies (or two people) side by side: how each one bet, the moment their paths split, who won and why the loser could not see it coming'
      },
      {
        id: 'investigation',
        name: 'Investigação',
        outline:
          'start from a strange fact (a number, a product, a document) and investigate it like a case: clues in order, a false lead, then the real explanation'
      }
    ]
  },
  titleRules: {
    count: 5,
    maxChars: 60,
    rules: `Every option has a different sentence shape: vary between a question, a number, a person's name, a quoted phrase and a contradiction, and never open two options with the same words. Prefer specific curiosity (numbers, names, objects) over generic phrases. Never put a year at the start of a title.`,
    good: [
      'Why Did Nokia Hide Its Own iPhone?',
      'The $50 Million Deal Blockbuster Laughed At',
      'The Memo Stephen Elop Wrote That Sank Nokia'
    ],
    banned: [
      'The <year> Mistake That…',
      'The Day That…',
      'The Mistake That…',
      'X did Y. Then Z happened.'
    ]
  },
  thumbModels: [
    {
      id: 'number',
      label: 'Número chocante',
      layout: 'number',
      brief:
        'A shocking number or before→after figure as the whole headline, e.g. "$250B → $0", "7 YEARS EARLY", "99% GONE". Use a real figure from the facts below. The image is a DIFFERENT subject than the product thumbnail: the company\'s headquarters, flagship store, factory floor or a famous moment of the story, bright and vivid.'
    },
    {
      id: 'product',
      label: 'Produto em destaque',
      layout: 'product',
      brief:
        'The company\'s iconic product that THIS story is about, close up and big, on a vivid solid-color background. Headline of 2–3 words with an emotional twist (e.g. "THEY BURIED IT", "TOO EARLY").'
    },
    {
      id: 'contrast',
      label: 'Antes × depois',
      layout: 'contrast',
      brief:
        'Split screen: the left image shows the glory days (bright, golden, crowded), the right image the ruin (empty, broken, grey). Headline of 2–3 words naming the turn specific to THIS story (e.g. "300M USERS → 0", "EVERY HOME → NONE", "1ST → LAST"). Avoid the generic "KING → ...".'
    }
  ],
  overlays: [
    {
      id: 'companyValue',
      label: 'Valor da empresa',
      rules: `companies: the companies the video is about, at most 2 (the main one first; e.g. a story about Xerox and Apple lists both). Empty array when the video is not about companies. For each: name (short, as people say it), wikipedia_title (exact English Wikipedia article title, e.g. "Apple Inc.") and values: the company's value in US dollars (market capitalization when public, otherwise its latest known private valuation) at each year the script mentions, plus its founding year with value 0. One entry per year, numbers in plain dollars (e.g. 2500000000 for 2.5 billion). Only use figures you are confident about; leave a year out rather than guess.`,
      scriptFields: {
        companies: z
          .array(
            z.object({
              name: z.string().min(1),
              wikipedia_title: z.string(),
              values: z.array(z.object({ year: z.number().int(), usd: z.number() }))
            })
          )
          .max(2)
      }
    },
    {
      id: 'yearCard',
      label: 'Cartões de ano',
      rules: `Years: give every scene the year it takes place in (year, a number), or null when it has no clear moment in time. Keep years in story order where possible. Whenever a scene moves to a different year than the previous scene with a year, its narration MUST say that year out loud, phrased in a varied way each time (e.g. "By 1984...", "Fast forward to 1997.", "In the spring of 2001,", "Eleven years later, in 1995,", "1976. A garage in Los Altos."). Never repeat the same phrasing twice.`,
      sceneFields: { year: z.number().int().nullable() }
    }
  ],
  topicSource: {
    kind: 'llm',
    brief:
      'Short business documentaries (rise and fall of companies). Prefer little-known companies with a dramatic arc, or a specific, surprising episode of a famous company (one decision, one person, one product, one deal) instead of its whole history. Each must be true and well documented, with a clear turning point, real numbers and named people.',
    examples: ['The Hotel Chain That Sold Its Name and Kept the Buildings']
  },
  mediaProviders: ['pixabay', 'wikimedia', 'pexels'],
  voices: { narrator: 'am_michael' },
  saturatedTopics: [
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
  ],
  shortsRules: {
    minSec: 18,
    maxSec: 32,
    hookMaxWords: 14,
    brief:
      'Our best short opened with a contradiction about a famous product ("Nokia built a touch-screen phone before the iPhone, then buried it"), named a product everyone knows, and was the shortest. The others opened mid-story ("On the other side of the continent...", "Years later...") and lost viewers in the first second.'
  },
  metadataRules: {
    description:
      '2 short paragraphs (max 900 characters total) that summarize the story and make people want to watch; end with one line inviting viewers to subscribe.',
    categoryId: '27',
    series: []
  }
}
