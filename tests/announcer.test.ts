import { describe, expect, it } from 'vitest'
import {
  ANNOUNCER,
  BRIDGES,
  planAnnouncer,
  quoteProblem,
  speakableAd
} from '../shared/formats/vintage-ads'
import { isEnglishWord } from '../electron/services/words'
import type { Script } from '../shared/types'

const OCR =
  "LYDIA E. PINKHAM'S VEGETABLE COMPOUND cures the worst forms of female complaints and all ovarian troubles. " +
  'It will dissolve and expel tumors from the uterus in an early stage of development. ' +
  'Price one dollar a bottle at all druggists. Write to Mrs. Pinkham at Lynn for free advice. ' +
  'Another club woman, Mrs. Haule, of Edgerton, Wis., tells how she was cured of irregulari- ties and uterine trouble, terrible pains and backache.'

const GOOD = [
  'cures the worst forms of female complaints and all ovarian troubles',
  'It will dissolve and expel tumors from the uterus in an early stage',
  'Price one dollar a bottle at all druggists',
  'Write to Mrs. Pinkham at Lynn for free advice'
]

/** A script with a Claim Check on every scene listed, each scene 30 s long. */
function script(claims: { scene: number; quote: string; verdict: string }[], n = 20): Script {
  return {
    title_options: ['t'],
    hook: 'hook',
    outro: '',
    scenes: Array.from({ length: n }, () => ({
      narration: 'x',
      visual_keywords: '',
      image_prompt: ''
    })),
    claims: claims.map((c) => ({ ...c, source: 'Book, 1979' }))
  }
}
const every30 = (scene: number): number => scene * 30

describe('period announcer plan', () => {
  it('never speaks in the first minute, at most 3 times, 90 s apart, each after a bridge', () => {
    const claims = [1, 2, 3, 4, 6, 8, 10, 12, 15].map((scene, k) => ({
      scene,
      quote: GOOD[k % GOOD.length],
      verdict: 'FALSE'
    }))
    const plan = planAnnouncer(script(claims), OCR, every30, isEnglishWord)
    expect(plan.segments.length).toBeLessThanOrEqual(ANNOUNCER.max)
    expect(plan.segments.length).toBe(3)
    for (const s of plan.segments) {
      expect(s.start).toBeGreaterThanOrEqual(60)
      expect(BRIDGES).toContain(s.bridge)
      expect(s.bridge.trim().length).toBeGreaterThan(0)
    }
    for (let i = 1; i < plan.segments.length; i++)
      expect(plan.segments[i].start - plan.segments[i - 1].start).toBeGreaterThanOrEqual(90)
    expect(plan.dropped.some((d) => d.reason.includes('primeiro minuto'))).toBe(true)
  })

  it('keeps the most damning verdicts when there are too many', () => {
    const claims = [
      { scene: 4, quote: GOOD[0], verdict: 'TRUE' },
      { scene: 8, quote: GOOD[1], verdict: 'FALSE' },
      { scene: 12, quote: GOOD[2], verdict: 'HALF-TRUE' },
      { scene: 16, quote: GOOD[3], verdict: 'NO EVIDENCE' }
    ]
    const plan = planAnnouncer(script(claims), OCR, every30, isEnglishWord)
    expect(plan.segments.map((s) => s.scene)).toEqual([8, 12, 16])
  })

  it('only reads Claim Check scenes, and not when switched off', () => {
    const s = script([{ scene: 5, quote: GOOD[0], verdict: 'FALSE' }])
    s.scenes[8].ad_quote = GOOD[1]
    expect(planAnnouncer(s, OCR, every30, isEnglishWord).segments.map((x) => x.scene)).toEqual([5])
    s.scenes[4].ad_quote_off = true
    expect(planAnnouncer(s, OCR, every30, isEnglishWord).segments).toEqual([])
  })
})

describe('announcer quote filter', () => {
  it('accepts the promise, price and write-to lines', () => {
    for (const q of GOOD) expect(quoteProblem(q, OCR, isEnglishWord)).toBeNull()
  })
  it('rejects testimonials, short, long, unmatched and garbled lines', () => {
    expect(quoteProblem('cured of irregularities and uterine trouble', OCR, isEnglishWord)).toMatch(
      /depoimento/
    )
    expect(quoteProblem("Lydia E. Pinkham's Vegetable Compound", OCR, isEnglishWord)).toMatch(
      /curta/
    )
    expect(quoteProblem(OCR.slice(0, 200), OCR, isEnglishWord)).toMatch(/longa/)
    expect(
      quoteProblem('guaranteed to cure baldness in a week or money back', OCR, isEnglishWord)
    ).toMatch(/OCR/)
    const junk = 'tbe wcrst fcrms ot femaie cornplaints aud ali ovariau'
    expect(quoteProblem(junk, `${junk} trouble`, isEnglishWord)).toMatch(/ilegível/)
  })
})

describe('speakableAd', () => {
  it('expands old abbreviations and prices and joins broken words', () => {
    expect(speakableAd('Mrs. Haule, of Edgerton, Wis., was cured of irregulari- ties')).toBe(
      'Missus Haule, of Edgerton, Wisconsin, was cured of irregularities'
    )
    expect(speakableAd('Lydia E. Pinkham Medicine Co., Lynn, Mass.')).toBe(
      'Lydia E. Pinkham Medicine Company, Lynn, Massachusetts'
    )
    expect(speakableAd('$1.00 a bottle & 50 cts. a box')).toBe(
      'one dollar a bottle and 50 cents a box'
    )
    expect(speakableAd('only $2.50 ~~ » Dr. Scott')).toBe(
      'only two dollars and fifty cents Doctor Scott'
    )
  })
})
