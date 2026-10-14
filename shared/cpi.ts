// US consumer price index, 1982-84 = 100, for "$X then ≈ $Y today" price tags.

// BLS CPI-U, U.S. city average, all items (CUUR0000SA0), annual averages 1913–2025.
// Index = year - 1913. Pre-2007 values are published to one decimal.
// prettier-ignore
const BLS: number[] = [
  9.9, 10.0, 10.1, 10.9, 12.8, 15.1, 17.3, 20.0, 17.9, 16.8, // 1913–1922
  17.1, 17.1, 17.5, 17.7, 17.4, 17.1, 17.1, 16.7, 15.2, 13.7, // 1923–1932
  13.0, 13.4, 13.7, 13.9, 14.4, 14.1, 13.9, 14.0, 14.7, 16.3, // 1933–1942
  17.3, 17.6, 18.0, 19.5, 22.3, 24.1, 23.8, 24.1, 26.0, 26.5, // 1943–1952
  26.7, 26.9, 26.8, 27.2, 28.1, 28.9, 29.1, 29.6, 29.9, 30.2, // 1953–1962
  30.6, 31.0, 31.5, 32.4, 33.4, 34.8, 36.7, 38.8, 40.5, 41.8, // 1963–1972
  44.4, 49.3, 53.8, 56.9, 60.6, 65.2, 72.6, 82.4, 90.9, 96.5, // 1973–1982
  99.6, 103.9, 107.6, 109.6, 113.6, 118.3, 124.0, 130.7, 136.2, 140.3, // 1983–1992
  144.5, 148.2, 152.4, 156.9, 160.5, 163.0, 166.6, 172.2, 177.1, 179.9, // 1993–2002
  184.0, 188.9, 195.3, 201.6, 207.342, 215.303, 214.537, 218.056, 224.939, 229.594, // 2003–2012
  232.957, 236.736, 237.017, 240.007, 245.12, 251.107, 255.657, 258.811, 270.97, 292.655, // 2013–2022
  304.702, 313.689,
  322.2, // 2025: estimate (monthly 2025 readings averaged; October 2025 was never published)
]

// 1800–1912: Federal Reserve Bank of Minneapolis, "Consumer Price Index, 1800-"
// (pre-1913 from Officer & Williamson / David & Solar estimates), published on a
// 1967 = 100 base where 1913 = 29.7. Rescaled below by 9.9 / 29.7 to 1982-84 = 100.
// 1800–1855 kept at 5-year steps; years in between are interpolated.
// prettier-ignore
const HIST_1967: Record<number, number> = {
  1800: 51, 1805: 45, 1810: 47, 1815: 58, 1820: 42, 1825: 35, 1830: 32, 1835: 31,
  1840: 30, 1845: 27, 1850: 25, 1855: 28,
  1856: 27, 1857: 28, 1858: 26, 1859: 27, 1860: 27, 1861: 28, 1862: 32, 1863: 40,
  1864: 49, 1865: 51, 1866: 49, 1867: 46, 1868: 44, 1869: 42, 1870: 39, 1871: 37,
  1872: 37, 1873: 36, 1874: 35, 1875: 33, 1876: 32, 1877: 32, 1878: 29, 1879: 29,
  1880: 29, 1881: 29, 1882: 29, 1883: 28, 1884: 27, 1885: 27, 1886: 27, 1887: 27,
  1888: 27, 1889: 27, 1890: 27, 1891: 27, 1892: 27, 1893: 27, 1894: 26, 1895: 25,
  1896: 25, 1897: 25, 1898: 25, 1899: 25, 1900: 25, 1901: 25, 1902: 26, 1903: 27,
  1904: 27, 1905: 27, 1906: 27, 1907: 28, 1908: 28, 1909: 27, 1910: 28, 1911: 28,
  1912: 29,
}

export const FIRST_CPI_YEAR = 1800
export const FIRST_OFFICIAL_CPI_YEAR = 1913
export const LATEST_CPI_YEAR = FIRST_OFFICIAL_CPI_YEAR + BLS.length - 1

const TABLE: [number, number][] = [
  ...Object.entries(HIST_1967).map(([y, v]): [number, number] => [Number(y), (v * 9.9) / 29.7]),
  ...BLS.map((v, i): [number, number] => [FIRST_OFFICIAL_CPI_YEAR + i, v]),
]

/** CPI (1982-84 = 100) for a year; linear interpolation between known points, null out of range. */
export function cpiFor(year: number): number | null {
  if (!Number.isFinite(year) || year < FIRST_CPI_YEAR || year > LATEST_CPI_YEAR) return null
  const i = TABLE.findIndex(([y]) => y >= year)
  const [y1, v1] = TABLE[i]
  if (y1 === year) return v1
  const [y0, v0] = TABLE[i - 1]
  return v0 + ((v1 - v0) * (year - y0)) / (y1 - y0)
}

export function inflate(usd: number, fromYear: number, toYear = LATEST_CPI_YEAR): number | null {
  const from = cpiFor(fromYear)
  const to = cpiFor(toYear)
  return from === null || to === null ? null : (usd * to) / from
}

/** Two significant figures: 17.9 → 18, 1234 → 1200, 0.43 → 0.43. */
export function roundToday(usd: number): number {
  return usd === 0 || !Number.isFinite(usd) ? usd : Number(usd.toPrecision(2))
}

/** Under $1 → "50¢"; under $100 → "$1.00"; otherwise "$1,500" (cents kept only if present). */
function money(usd: number): string {
  if (usd < 1) return `${Math.round(usd * 100)}¢`
  const cents = usd < 100 || !Number.isInteger(usd)
  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })
}

/** "$1.00 in 1924 ≈ $19 today"; estimate = year predates the official BLS series. */
export function priceTag(
  usd: number,
  year: number,
): { then: string; today: string; text: string; estimate: boolean } | null {
  const now = inflate(usd, year)
  if (now === null) return null
  const then = money(usd)
  const r = roundToday(now)
  const today = r >= 1 && Number.isInteger(r) ? '$' + r.toLocaleString('en-US') : money(r)
  return { then, today, text: `${then} in ${year} ≈ ${today} today`, estimate: year < FIRST_OFFICIAL_CPI_YEAR }
}
