import { describe, expect, it } from 'vitest'
import { nextFreeSlot, zonedToUtc } from '../electron/queue/slots'

const slots = [
  { weekday: 1, time: '14:00' },
  { weekday: 3, time: '14:00' },
  { weekday: 5, time: '14:00' }
]

describe('publish slots', () => {
  it('converts New York wall time to UTC across DST', () => {
    expect(zonedToUtc(2026, 7, 1, 14, 0, 'America/New_York').toISOString()).toBe(
      '2026-07-01T18:00:00.000Z'
    )
    expect(zonedToUtc(2026, 12, 1, 14, 0, 'America/New_York').toISOString()).toBe(
      '2026-12-01T19:00:00.000Z'
    )
  })

  it('picks the next free slot', () => {
    // Tuesday 2026-10-06 12:00 UTC → next is Wednesday 14:00 New York (18:00 UTC).
    const from = new Date('2026-10-06T12:00:00Z')
    expect(nextFreeSlot(slots, 'America/New_York', [], from)).toBe('2026-10-07T18:00:00.000Z')
    expect(nextFreeSlot(slots, 'America/New_York', ['2026-10-07T18:00:00.000Z'], from)).toBe(
      '2026-10-09T18:00:00.000Z'
    )
  })

  it('skips a slot less than one hour away', () => {
    const from = new Date('2026-10-07T17:30:00Z')
    expect(nextFreeSlot(slots, 'America/New_York', [], from)).toBe('2026-10-09T18:00:00.000Z')
  })
})
