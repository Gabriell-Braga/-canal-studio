import { describe, expect, it } from 'vitest'
import { objectPosition, scanRegions } from '../shared/framing'
import { regionCamera, SCAN_HEIGHT } from '../remotion/formats/vintage-ads'

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

describe('ad scan framing', () => {
  const words = Array.from({ length: 12 }, (_, i) => ({
    x: 0.1,
    y: 0.5 + i * 0.04,
    w: 0.8,
    h: 0.03
  }))

  it('splits OCR text into bands, plus the picture above it', () => {
    const r = scanRegions(words)
    expect(r[0]).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
    // 12 lines spanning 0.5–0.97: tall text, 3 bands.
    expect(r).toHaveLength(4)
    expect(new Set(r.map((b) => b.y)).size).toBe(4)
    expect(scanRegions(words.slice(0, 8))).toHaveLength(3)
  })

  it('falls back to thirds without OCR', () => {
    expect(scanRegions([]).map((b) => b.y)).toEqual([0, 0.3, 0.6])
  })

  it('fills most of the height and closes in on the part, inside the scan', () => {
    expect(SCAN_HEIGHT).toBeGreaterThanOrEqual(0.85)
    const size = { width: 1920, height: 1080 }
    const img = { x: 700, y: 43, w: 520, h: 994 }
    const part = { x: 700, y: 43, w: 520, h: 400 }
    const end = regionCamera(90, 90, size, part, img)
    expect(end.scale).toBeGreaterThan(2)
    // The view never runs above the scan's top edge.
    expect(end.y - size.height / (2 * end.scale)).toBeGreaterThanOrEqual(img.y - 0.01)
    expect(regionCamera(0, 90, size, part, img).scale).toBeLessThan(end.scale)
  })
})
