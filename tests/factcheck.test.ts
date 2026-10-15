import { describe, expect, it } from 'vitest'
import { unsourcedFacts } from '../shared/formats/vintage-ads'
import { isEnglishWord } from '../electron/services/words'
import type { Script } from '../shared/types'

// Video 62 (Lydia Pinkham), as approved: the hook named the newspaper's town.
const OCR =
  "Another club woman, Mrs. Haule, of Edgerton, Wis., tells how she was cured of irregulari- ties and uterine trouble, terrible pains and backache, by the use of Lydia E. Pinkham's Vegetable Compound."
const PAGE = {
  newspaper: 'Red River Prospector, Taos , New Mexico',
  city: '',
  state: '',
  date: '1903-12-31'
}

const script: Script = {
  title_options: ['t'],
  hook: "On the last day of 1903, a weekly paper in Red River, a mining town in Taos County, New Mexico, ran an ad promising to cure women's uterine trouble. The name that closed the pitch, Lydia Pinkham, had been dead for twenty years.",
  outro: '',
  scenes: [
    {
      narration: 'Lydia Estes was born in Lynn, Massachusetts, in 1819.',
      visual_keywords: '',
      image_prompt: ''
    },
    {
      narration: 'Claim one. Could an herbal tonic cure what the ad calls uterine trouble?',
      visual_keywords: '',
      image_prompt: '',
      scan: true
    }
  ],
  claims: [
    {
      scene: 2,
      quote: 'cured of irregularities and uterine trouble',
      verdict: 'FALSE',
      source: 'Sarah Stage, Female Complaints (1979)'
    }
  ]
}

describe('unsourced facts in the ad scenes', () => {
  it('flags the newspaper town of video 62 and says it came from the page record', () => {
    const facts = unsourcedFacts(script, OCR, PAGE, isEnglishWord)
    const taos = facts.find((f) => f.term.includes('Taos'))
    expect(taos).toBeDefined()
    expect(taos?.fromMeta).toBe(true)
    expect(facts.find((f) => f.term === '1903')?.fromMeta).toBe(true)
    // Sourced by the OCR: not flagged.
    expect(facts.some((f) => f.term.includes('Pinkham'))).toBe(false)
    // Scene 1 is not an ad scene: its biography is not checked here.
    expect(facts.some((f) => f.term.includes('Lynn'))).toBe(false)
  })
})
