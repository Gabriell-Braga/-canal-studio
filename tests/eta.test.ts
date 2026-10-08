import { describe, expect, it } from 'vitest'
import { formatDuration, jobEta, median } from '../shared/eta'

describe('queue time estimates', () => {
  it('uses past runs before the job moves, its own pace near the end', () => {
    expect(jobEta(0, 30, 900)).toBe(870)
    expect(jobEta(0, 30, undefined)).toBeNull()
    // Half way after 300 s: own pace says 300 s left, history 450 s; blended half and half.
    expect(jobEta(0.5, 300, 900)).toBe(375)
    expect(jobEta(0.5, 300, undefined)).toBe(300)
  })

  it('never shows zero or negative while a slow run is still going', () => {
    expect(jobEta(0.9, 1800, 600)).toBeCloseTo(186)
    expect(jobEta(0.02, 1000, 600)).toBeNull()
  })

  it('formats and takes medians', () => {
    expect(median([5, 1, 900])).toBe(5)
    expect(median([1, 3])).toBe(2)
    expect(median([])).toBeUndefined()
    expect(formatDuration(45)).toBe('45 s')
    expect(formatDuration(245)).toBe('4 min 05 s')
    expect(formatDuration(4320)).toBe('1 h 12 min')
  })
})
