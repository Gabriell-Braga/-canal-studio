import { describe, expect, it } from 'vitest'
import {
  briefingProblems,
  conceptLayout,
  conceptProblems,
  inside,
  MIN_TEXT_SIZE,
  safeArea,
  scoreProblems,
  VINTAGE_THUMB,
  type ThumbBriefing,
  type ThumbConcept
} from '../shared/thumb'

const TITLE = "Lydia Pinkham's 'Female Complaint' Cure Was Signed by a Dead Woman"

const concept = (type: ThumbConcept['type'], text: string): ThumbConcept => ({
  type,
  idea: 'Her portrait next to a letter signed in her name, dated 1903',
  elements: [
    { kind: 'portrait', what: 'her real portrait', person: 'Lydia E. Pinkham', words: '' },
    { kind: 'letter', what: 'reply dated 1903', person: '', words: 'Dear sister, 1903' }
  ],
  text,
  accent_word: '',
  background: 'dark',
  why_click: 'A dead woman answering mail makes no sense'
})

const brief = (concepts: ThumbConcept[]): ThumbBriefing => ({
  conflict: 'Women wrote to Lydia Pinkham for advice; she had been dead for 20 years',
  question: 'Who was answering her letters?',
  concepts
})

describe('Ads on Trial thumbnail briefing', () => {
  it('accepts one concept of each type with short text that adds to the title', () => {
    const b = brief([
      concept('contradiction', 'SHE DIED IN 1883'),
      concept('secret', '20% ALCOHOL'),
      concept('mystery', 'WHO WROTE BACK?')
    ])
    expect(briefingProblems(b, TITLE)).toEqual([])
  })

  it('needs three different types', () => {
    const b = brief([
      concept('contradiction', 'SHE DIED IN 1883'),
      concept('contradiction', 'WHO WROTE BACK?'),
      concept('mystery', '20% ALCOHOL')
    ])
    expect(briefingProblems(b, TITLE).join(' ')).toMatch(/um de cada tipo/)
  })

  it('reproves text over 4 words, text that repeats the title and a bare price', () => {
    expect(conceptProblems(concept('mystery', 'WHO WAS REALLY WRITING BACK'), TITLE)).toHaveLength(1)
    expect(conceptProblems(concept('mystery', 'DEAD WOMAN?'), TITLE).join()).toMatch(/repete o título/)
    expect(conceptProblems(concept('secret', '$1 → $29'), TITLE).join()).toMatch(/só um preço/)
  })

  it('reproves a portrait without the name of the person shown', () => {
    const c = concept('mystery', 'WHO WROTE BACK?')
    c.elements[0].person = ''
    expect(conceptProblems(c, TITLE).join()).toMatch(/retrato sem o nome/)
  })

  it('flags scores under 7', () => {
    expect(scoreProblems({ understand: 8, click: 7, readable: 9, stands_out: 7, note: '' })).toEqual([])
    expect(scoreProblems({ understand: 6, click: 7, readable: 9, stands_out: 5, note: '' })).toHaveLength(2)
  })
})

describe('Ads on Trial concept layout', () => {
  const frame = VINTAGE_THUMB.width * VINTAGE_THUMB.height
  const cases: [string, number, string][] = [
    ['WHO WROTE BACK?', 0.6, ''],
    ['SHE DIED IN 1883', 0.8, '1903'],
    ['FOR WOMEN', 1.5, '20% ALCOHOL'],
    ['NEVER MET HER', 0.3, 'DECEASED']
  ]
  it.each(cases)('"%s" (aspect %s, stamp "%s"): text in the safe area, subject 40–60%%', (text, aspect, stamp) => {
    const L = conceptLayout(text, aspect, stamp)
    expect(L.problems).toEqual([])
    for (const t of [...L.texts, ...(L.stamp ? [L.stamp] : [])]) {
      expect(inside(t.box, safeArea())).toBe(true)
      expect(t.size).toBeGreaterThanOrEqual(MIN_TEXT_SIZE)
    }
    const share = (L.subject.w * L.subject.h) / frame
    expect(share).toBeGreaterThanOrEqual(0.4)
    expect(share).toBeLessThanOrEqual(0.6)
  })

  it('reproves text too long to read in the free space', () => {
    expect(conceptLayout('UNCONSTITUTIONALLY INCOMPREHENSIBLE', 0.8).problems.length).toBeGreaterThan(0)
  })
})
