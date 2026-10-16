import { describe, expect, it } from 'vitest'
import { checkProblems, promptProblems } from '../electron/steps/illustrate'

const PEOPLE = ['Lydia E. Pinkham', 'Edward Bok', 'Charles Pinkham']

describe('AI engraving illustrations', () => {
  it.each([
    'portrait of Lydia Pinkham',
    'a newspaper ad for Vegetable Compound',
    'a photo of a bottle',
    'a label reading "Vegetable Compound"',
    'Edward Bok at his desk'
  ])('refuses "%s"', (p) => {
    expect(promptProblems(p, PEOPLE).length).toBeGreaterThan(0)
  })

  it.each([
    "a woman's hands writing a letter by lamplight",
    'a crowded street in Lynn seen from afar',
    'a kitchen stove with pots and drying herbs'
  ])('accepts "%s"', (p) => {
    expect(promptProblems(p, PEOPLE)).toEqual([])
  })

  it('discards a photoreal image, readable text, a face or a fake document', () => {
    const ok = { photoreal: false, text: false, face: false, document: false }
    expect(checkProblems(ok)).toEqual([])
    for (const k of Object.keys(ok) as (keyof typeof ok)[])
      expect(checkProblems({ ...ok, [k]: true })).toHaveLength(1)
  })
})
