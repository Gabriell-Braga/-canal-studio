import { describe, expect, it } from 'vitest'
import {
  inside,
  MIN_TEXT_SIZE,
  portraitPlacement,
  safeArea,
  testimonialOnly,
  VINTAGE_THUMB,
  vintageLayout
} from '../shared/thumb'

const FRAME = VINTAGE_THUMB.width * VINTAGE_THUMB.height

describe('Ads on Trial thumbnails: safe area', () => {
  const cases: [string, string][] = [
    ['ad-stamp', 'POISON'],
    ['ad-stamp', 'GHOSTWRITTEN TONIC'],
    ['ad-stamp', '$0.50 BOTTLE'],
    ['era-face', 'GHOSTWRITTEN'],
    ['era-face', 'DEAD WOMAN WROTE'],
    ['then-now', '$1 → $30'],
    ['then-now', '$1,250 → $41,800'],
    ['then-now', '→ NO EVIDENCE'],
    ['then-now', '$1 → HALF-TRUE']
  ]
  it.each(cases)('%s "%s": every text and stamp inside the 6%% margin', (layout, text) => {
    const L = vintageLayout(layout, text)
    expect(L.texts.length).toBeGreaterThan(0)
    for (const t of L.texts) {
      expect(inside(t.box, safeArea())).toBe(true)
      expect(t.size).toBeGreaterThanOrEqual(MIN_TEXT_SIZE)
    }
    expect(L.problems).toEqual([])
  })

  it('reproves text too long to read once shrunk into the safe area', () => {
    expect(vintageLayout('ad-stamp', 'UNCONSTITUTIONALLY').problems.length).toBeGreaterThan(0)
    expect(vintageLayout('then-now', '$1 → INCOMPREHENSIBILITIES').problems.length).toBeGreaterThan(
      0
    )
  })

  it('B keeps at most 2 words', () => {
    expect(vintageLayout('era-face', 'she never wrote back').texts[0].text).toBe('SHE NEVER')
  })

  it('A: the real ad covers 55–65% of the frame', () => {
    const ad = vintageLayout('ad-stamp', 'FALSE').ad
    const share = ((ad?.w ?? 0) * (ad?.h ?? 0)) / FRAME
    expect(share).toBeGreaterThanOrEqual(VINTAGE_THUMB.adShare[0])
    expect(share).toBeLessThanOrEqual(VINTAGE_THUMB.adShare[1])
  })

  it('B: the face is 40–55% of the frame height', () => {
    const face = { y: 0.2, h: 0.3 }
    const p = portraitPlacement(face)
    const share = (face.h * p.height) / VINTAGE_THUMB.height
    expect(share).toBeGreaterThanOrEqual(0.4)
    expect(share).toBeLessThanOrEqual(0.55)
    expect(p.top + face.y * p.height).toBeGreaterThanOrEqual(0)
  })

  it('B never uses a face from a testimonial', () => {
    const ad =
      'Another club woman, Mrs. Haule, of Edgerton, Wis., tells how she was cured by Lydia E. Pinkham'
    const story = 'Lydia Pinkham brewed a remedy on her stove in Lynn.'
    expect(testimonialOnly('Mrs. Haule', ad, story)).toBe(true)
    expect(testimonialOnly('Lydia Pinkham', ad, story)).toBe(false)
  })
})
