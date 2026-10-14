import { describe, expect, it } from 'vitest'
import { cpiFor, inflate, LATEST_CPI_YEAR, priceTag, roundToday } from '../shared/cpi'

describe('cpi', () => {
  it('returns published BLS values', () => {
    expect(cpiFor(1913)).toBe(9.9)
    expect(cpiFor(1950)).toBe(24.1)
    expect(cpiFor(2024)).toBe(313.689)
    expect(LATEST_CPI_YEAR).toBe(2025)
  })

  it('rescales pre-1913 estimates to 1982-84 = 100', () => {
    expect(cpiFor(1912)).toBeCloseTo(9.67, 2)
    expect(cpiFor(1800)).toBeCloseTo(17, 5)
  })

  it('interpolates sparse years', () => {
    // 1800 = 51, 1805 = 45 on the 1967 base
    expect(cpiFor(1802)).toBeCloseTo((48.6 * 9.9) / 29.7, 5)
  })

  it('is null out of range', () => {
    expect(cpiFor(1799)).toBeNull()
    expect(cpiFor(LATEST_CPI_YEAR + 1)).toBeNull()
    expect(inflate(1, 1700)).toBeNull()
    expect(priceTag(1, 2100)).toBeNull()
  })

  it('$1 in 1924 is about $18-19 today', () => {
    expect(inflate(1, 1924, 2024)).toBeCloseTo(18.34, 2)
    expect(inflate(1, 1924)!).toBeGreaterThan(18)
    expect(inflate(1, 1924)!).toBeLessThan(19.5)
  })

  it('rounds to two significant figures', () => {
    expect(roundToday(17.9)).toBe(18)
    expect(roundToday(1234)).toBe(1200)
    expect(roundToday(0.43)).toBe(0.43)
    expect(roundToday(0)).toBe(0)
  })

  it('formats price tags', () => {
    expect(priceTag(1, 1924)).toEqual({
      then: '$1.00',
      today: '$19',
      text: '$1.00 in 1924 ≈ $19 today',
      estimate: false
    })
    expect(priceTag(0.5, 1924)!.then).toBe('50¢')
    expect(priceTag(1500, 1950)!.text).toBe('$1,500 in 1950 ≈ $20,000 today')
    expect(priceTag(0.05, 2020)!.today).toBe('6¢')
  })

  it('flags pre-1913 years as estimates', () => {
    expect(priceTag(1, 1880)!.estimate).toBe(true)
    expect(priceTag(1, 1913)!.estimate).toBe(false)
  })
})
