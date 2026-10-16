import { describe, expect, it } from 'vitest'
import {
  briefingProblems,
  conceptProblems,
  emptyGrid,
  emptyProblems,
  fitAtLeast,
  fitText,
  metricProblems,
  ocrConfidence,
  placeholderProblems,
  scoreProblems,
  textProblems,
  TPL,
  type MeasuredText,
  type ThumbBriefing,
  type ThumbConcept
} from '../shared/thumb'

const TITLE = "Lydia Pinkham's 'Female Complaint' Cure Was Signed by a Dead Woman"

const concept = (type: ThumbConcept['type'], text: string): ThumbConcept => ({
  type,
  idea: 'Her portrait next to a letter signed in her name, dated 1903',
  elements: [
    {
      kind: 'portrait',
      what: 'her real portrait',
      person: 'Lydia E. Pinkham',
      words: '',
      search: ''
    },
    { kind: 'letter', what: 'reply dated 1903', person: '', words: 'Dear sister, 1903', search: '' }
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
    expect(conceptProblems(concept('mystery', 'WHO WAS REALLY WRITING BACK'), TITLE)).toHaveLength(
      1
    )
    expect(conceptProblems(concept('mystery', 'DEAD WOMAN?'), TITLE).join()).toMatch(
      /repete o título/
    )
    expect(conceptProblems(concept('secret', '$1 → $29'), TITLE).join()).toMatch(/só um preço/)
  })

  it('reproves a portrait without the name of the person shown', () => {
    const c = concept('mystery', 'WHO WROTE BACK?')
    c.elements[0].person = ''
    expect(conceptProblems(c, TITLE).join()).toMatch(/retrato sem o nome/)
  })

  it('flags scores under 7', () => {
    expect(
      scoreProblems({ understand: 8, click: 7, readable: 9, stands_out: 7, note: '' })
    ).toEqual([])
    expect(
      scoreProblems({ understand: 6, click: 7, readable: 9, stands_out: 5, note: '' })
    ).toHaveLength(2)
  })
})

describe('Ads on Trial template checks', () => {
  /** A frame (rgb24) with its left half black and its right half a busy checkerboard. */
  function halfBlack(width: number, height: number): Uint8Array {
    const rgb = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++)
      for (let x = width / 2; x < width; x++) {
        const v = (x + y) % 2 ? 255 : 0
        rgb.set([v, v, v], (y * width + x) * 3)
      }
    return rgb
  }

  it('reproves a thumbnail whose left half is black', () => {
    const g = emptyGrid(halfBlack(320, 180), 320, 180)
    // The seam column has edges: 7 of 16 columns read empty.
    expect(g.share).toBeGreaterThan(0.4)
    expect(emptyProblems(g).join()).toMatch(/vazio/)
  })

  it('passes a frame with detail everywhere', () => {
    const rgb = new Uint8Array(320 * 180 * 3).map((_, i) => ((i / 3) % 2 ? 255 : 0))
    expect(emptyProblems(emptyGrid(rgb, 320, 180))).toEqual([])
  })

  // Oswald-like estimate: 0.5 em per character, cap height 0.8 em.
  const font = { capRatio: 0.8, width: (line: string, size: number) => line.length * 0.5 * size }

  it('fills the title zone up to the 180 px cap; a third line before going under 110 px', () => {
    const zone = { w: 552, h: 389 }
    const two = fitText('STILL WRITING BACK', zone, { maxLines: 2, maxCap: 180, ...font })
    expect(two?.cap).toBeLessThan(TPL.minCap.title)
    const three = fitText('STILL WRITING BACK', zone, { maxLines: 3, maxCap: 180, ...font })
    expect(three?.lines).toEqual(['STILL', 'WRITING', 'BACK'])
    expect(three?.cap).toBeGreaterThanOrEqual(TPL.minCap.title)
    expect(
      fitText('WHO', { w: 2000, h: 2000 }, { maxLines: 1, maxCap: 180, ...font })?.cap
    ).toBeCloseTo(180)
  })

  it('cuts small text instead of shrinking it under 48 px', () => {
    const fit = fitAtLeast('LYDIA E. PINKHAM OF LYNN MASSACHUSETTS', { w: 400, h: 150 }, 48, {
      maxLines: 1,
      maxCap: 120,
      ...font
    })
    expect(fit?.cap).toBeGreaterThanOrEqual(48)
    expect(fit?.lines.join(' ').length).toBeLessThan(38)
    expect(
      fitAtLeast('UNCONSTITUTIONALLY', { w: 100, h: 60 }, 48, { maxLines: 1, maxCap: 120, ...font })
    ).toBeNull()
  })

  it('reproves measured text under the minimums, outside the margin or behind the clock', () => {
    const ok: MeasuredText[] = [
      { role: 'title', text: 'WHO WROTE BACK?', cap: 140, rect: { x: 100, y: 50, w: 900, h: 160 } },
      { role: 'stamp', text: 'DIED 1883', cap: 82, rect: { x: 450, y: 450, w: 470, h: 160 } }
    ]
    expect(textProblems(ok)).toEqual([])
    const bad: MeasuredText[] = [
      { role: 'title', text: 'TINY', cap: 90, rect: { x: 10, y: 50, w: 300, h: 100 } },
      { role: 'stamp', text: 'DIED', cap: 60, rect: { x: 1100, y: 640, w: 150, h: 60 } },
      { role: 'letter', text: 'Dear', cap: 40, rect: { x: 700, y: 300, w: 200, h: 60 } }
    ]
    const p = textProblems(bad).join(' | ')
    expect(p).toMatch(/"TINY" com 90 px.*mínimo 110/)
    expect(p).toMatch(/"TINY" fora da margem/)
    expect(p).toMatch(/"DIED" com 60 px.*mínimo 80/)
    expect(p).toMatch(/"DIED" atrás do relógio/)
    expect(p).toMatch(/"Dear" com 40 px.*mínimo 56/)
  })

  it('needs every title and stamp word read by OCR at 246×138 with confidence 80', () => {
    const read = [
      { text: 'WHOWROTE', conf: 93 },
      { text: 'BACK?', conf: 88 }
    ]
    expect(ocrConfidence(['WHO', 'WROTE', 'BACK?'], read)).toEqual({ min: 88, missing: [] })
    expect(ocrConfidence(['DIED', '1883'], read).missing).toEqual(['DIED', '1883'])
    const low = {
      emptyPct: 0,
      occupancyPct: 90,
      subjectPct: 40,
      ocr: 61,
      ocrMissing: [],
      contrast: 9
    }
    const values = {
      ...low,
      caps: { title: 120, stamp: 85, other: null },
      understand: 8,
      click: 8,
      notEmpty: 8
    }
    expect(metricProblems(values).join()).toMatch(/OCR em 246×138 com confiança 61/)
  })

  it('never draws a placeholder: a missing picture changes the concept', () => {
    const t1 = { ...concept('contradiction', 'STILL WRITING BACK') }
    t1.elements = [
      {
        kind: 'portrait',
        what: 'her portrait',
        person: 'Lydia E. Pinkham',
        words: '',
        search: 'Lydia Pinkham'
      },
      { kind: 'stamp', what: 'stamp', person: '', words: 'DIED 1883', search: '' }
    ]
    expect(placeholderProblems(t1, () => true)).toEqual([])
    expect(placeholderProblems(t1, () => false).join()).toMatch(/sem retrato real/)
    const t2 = { ...concept('secret', 'JUST HERBS?') }
    t2.elements = [
      { kind: 'label', what: 'a drawn label', person: '', words: 'VEGETABLE COMPOUND', search: '' },
      { kind: 'stamp', what: 'stamp', person: '', words: '20% ALCOHOL', search: '' }
    ]
    expect(placeholderProblems(t2, () => false).join()).toMatch(/sem objeto real/)
    const t3 = { ...concept('mystery', 'WHO WROTE BACK?') }
    t3.elements = [
      {
        kind: 'tombstone',
        what: 'her grave',
        person: '',
        words: 'LYDIA E. PINKHAM / 1819–1883',
        search: ''
      },
      { kind: 'document', what: 'a document', person: '', words: 'lab report', search: '' }
    ]
    expect(placeholderProblems(t3, () => false).join()).toMatch(/"a document" sem mídia real/)
    t3.elements[1] = {
      kind: 'letter',
      what: 'a reply',
      person: '',
      words: 'Dear Mrs. Pinkham, / — Lynn, 1903',
      search: ''
    }
    expect(placeholderProblems(t3, () => false)).toEqual([])
  })
})
