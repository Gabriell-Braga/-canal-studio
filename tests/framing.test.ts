import { describe, expect, it } from 'vitest'
import { objectPosition } from '../shared/framing'

describe('objectPosition', () => {
  it('stays centered without a focus', () => {
    expect(objectPosition(undefined, 1920, 1080)).toBe('50% 50%')
  })

  it('moves a square image up to keep a head near the top', () => {
    // Square image in 16:9: 1920x1920, 840 px hidden vertically. Head at 15% of the height.
    // Head at 288 px should sit at 432 px (40% of 1080): impossible above the top edge, so 0%.
    expect(objectPosition({ x: 0.5, y: 0.15, aspect: 1 }, 1920, 1080)).toBe('50.0% 0.0%')
    // Head at 45%: 864 px to 432 px, so the image moves up 432 px of 840: 51.4%.
    expect(objectPosition({ x: 0.5, y: 0.45, aspect: 1 }, 1920, 1080)).toBe('50.0% 51.4%')
  })

  it('pans across a wide image for a vertical short', () => {
    // 16:9 image in 1080x1920: 3413 px wide, subject at 80% across: (2731 - 540) / 2333.
    expect(objectPosition({ x: 0.8, y: 0.3, aspect: 16 / 9 }, 1080, 1920)).toBe('93.9% 50.0%')
  })
})
