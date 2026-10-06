import { describe, expect, it } from 'vitest'
import { backoffMs, inWindow, windowKey } from '../electron/queue/window'

const at = (h: number, m = 0, day = 6): Date => new Date(2026, 9, day, h, m)

describe('night window', () => {
  it('handles a same-day window', () => {
    expect(inWindow(at(0, 59), '01:00', '07:00')).toBe(false)
    expect(inWindow(at(1, 0), '01:00', '07:00')).toBe(true)
    expect(inWindow(at(6, 59), '01:00', '07:00')).toBe(true)
    expect(inWindow(at(7, 0), '01:00', '07:00')).toBe(false)
  })

  it('handles a window crossing midnight', () => {
    expect(inWindow(at(23), '22:00', '06:00')).toBe(true)
    expect(inWindow(at(3), '22:00', '06:00')).toBe(true)
    expect(inWindow(at(12), '22:00', '06:00')).toBe(false)
  })

  it('keys one night by the date the window started', () => {
    expect(windowKey(at(23, 0, 6), '22:00', '06:00')).toBe('2026-10-06')
    expect(windowKey(at(3, 0, 7), '22:00', '06:00')).toBe('2026-10-06')
    expect(windowKey(at(3, 0, 7), '01:00', '07:00')).toBe('2026-10-07')
  })

  it('backs off 1, 5, 15 minutes', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([60_000, 300_000, 900_000, 900_000])
  })
})
