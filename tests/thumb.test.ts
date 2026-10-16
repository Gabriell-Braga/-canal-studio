import { describe, expect, it } from 'vitest'
import { thumbProblems, thumbText } from '../shared/thumb'

describe('thumbnail rules', () => {
  it('keeps at most 3 words and drops the title words', () => {
    expect(thumbText('THEY BURIED THE IPHONE', 'Why Nokia Buried Its Own iPhone')).toBe('THEY')
    expect(thumbText('$250B → $0 GONE', 'The Fall of Nokia')).toBe('$250B → $0')
    expect(thumbText('NOKIA', 'Nokia Hid Its Phone')).toBe('')
  })

  it('flags small subjects and flat contrast', () => {
    expect(thumbProblems({ coverage: 0.5, contrast: 0.25, subject_contrast: 0.2 })).toEqual([])
    expect(thumbProblems({ coverage: 0.1, contrast: 0.25, subject_contrast: 0.2 })).toHaveLength(1)
    expect(thumbProblems({ coverage: 0.1, contrast: 0.05, subject_contrast: 0 })).toHaveLength(2)
    // Real newspaper scans: coverage is not checked, contrast still is.
    expect(thumbProblems({ coverage: 0.1, contrast: 0.25, subject_contrast: 0 }, false)).toEqual([])
  })
})

describe('test & compare winners', () => {
  it('puts the most frequent winner first after 6 results', async () => {
    const { orderModels } = await import('../electron/steps/thumbnail')
    const ids = ['a', 'b', 'c']
    expect(orderModels(ids, { 1: 'c', 2: 'c' })).toEqual(ids)
    expect(orderModels(ids, { 1: 'c', 2: 'c', 3: 'b', 4: 'c', 5: 'a', 6: 'c' })).toEqual([
      'c',
      'a',
      'b'
    ])
  })
})
