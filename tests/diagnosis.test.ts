import { describe, expect, it } from 'vitest'
import { diagnose } from '../shared/diagnosis'
import { stillWatchingAt } from '../shared/performance'

describe('diagnose', () => {
  it('low CTR + good retention is packaging', () => {
    const d = diagnose({ ctr: 3, retention30: 75, avgViewPct: 45 })
    expect(d.kind).toBe('packaging')
    expect(d.label).toBe('Problema de embalagem')
    expect(diagnose({ ctr: 1.5, retention30: 75, avgViewPct: 45 }).label).toMatch(/crítico/)
  })
  it('good CTR + low retention is the hook', () => {
    expect(diagnose({ ctr: 6, retention30: 50, avgViewPct: 45 }).kind).toBe('hook')
  })
  it('both low is the topic', () => {
    expect(diagnose({ ctr: 2.5, retention30: 50, avgViewPct: 30 }).kind).toBe('topic')
  })
  it('both fine is ok', () => {
    expect(diagnose({ ctr: 6, retention30: 70, avgViewPct: 45 }).kind).toBe('ok')
  })
  it('falls back to average viewed without the 0:30 number', () => {
    expect(diagnose({ ctr: 6, retention30: null, avgViewPct: 30 }).kind).toBe('hook')
    expect(diagnose({ ctr: 6, retention30: null, avgViewPct: 50 }).kind).toBe('ok')
  })
  it('is unknown without CTR or retention', () => {
    expect(diagnose({ ctr: null, retention30: 70, avgViewPct: 45 }).kind).toBe('unknown')
    expect(diagnose({ ctr: 5, retention30: null, avgViewPct: null }).kind).toBe('unknown')
    expect(diagnose({ ctr: null, retention30: null, avgViewPct: null }).kind).toBe('unknown')
  })
  it('mentions the channel median', () => {
    const d = diagnose({ ctr: 3, retention30: 80, avgViewPct: 45, channelMedians: { ctr: 5 } })
    expect(d.detail).toContain('mediana do canal 5%')
  })
})

describe('stillWatchingAt', () => {
  const curve: [number, number, number][] = [
    [0, 1.1, 0.5],
    [0.05, 0.8, 0.5],
    [0.1, 0.6, 0.5]
  ]
  it('interpolates at 0:30 of a 10 min video', () => {
    // 30 s / 600 s = 0.05
    expect(stillWatchingAt(curve, 600)).toBeCloseTo(80)
    // 30 s / 400 s = 0.075, halfway between 0.8 and 0.6
    expect(stillWatchingAt(curve, 400)).toBeCloseTo(70)
  })
  it('caps at 100 and needs data', () => {
    expect(stillWatchingAt([[0.1, 1.3, 0.5]], 600)).toBe(100)
    expect(stillWatchingAt([], 600)).toBeNull()
    expect(stillWatchingAt(curve, null)).toBeNull()
    expect(stillWatchingAt(curve, 20)).toBeNull()
  })
})
