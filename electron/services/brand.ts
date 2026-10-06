import { nativeImage } from 'electron'

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60
  return [h, s, l]
}

function toHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * Brand colors from the channel picture: the most present saturated hue becomes the
 * accent, a second distinct hue (or white) the main text color. Both are lifted to stay
 * readable on dark backgrounds with a black outline.
 */
export function brandColorsFromImage(file: string): { primary: string; secondary: string } | null {
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return null
  const small = image.resize({ width: 64, height: 64 })
  const bitmap = small.toBitmap() // BGRA
  const bins = new Map<number, { weight: number; h: number; s: number; l: number }>()
  for (let i = 0; i < bitmap.length; i += 4) {
    if (bitmap[i + 3] < 128) continue
    const [h, s, l] = toHsl(bitmap[i + 2], bitmap[i + 1], bitmap[i])
    if (s < 0.35 || l < 0.18 || l > 0.85) continue
    const bin = Math.floor(h / 15)
    const w = s
    const cur = bins.get(bin) ?? { weight: 0, h: 0, s: 0, l: 0 }
    cur.weight += w
    cur.h += h * w
    cur.s += s * w
    cur.l += l * w
    bins.set(bin, cur)
  }
  const ranked = [...bins.values()]
    .map((b) => ({ weight: b.weight, h: b.h / b.weight, s: b.s / b.weight, l: b.l / b.weight }))
    .sort((a, b) => b.weight - a.weight)
  if (!ranked.length) return null
  const readable = (c: { h: number; s: number; l: number }): string =>
    toHex(c.h, Math.min(1, c.s * 1.05), Math.max(0.55, Math.min(0.7, c.l)))
  const primary = ranked[0]
  const other = ranked.find(
    (c) =>
      Math.min(Math.abs(c.h - primary.h), 360 - Math.abs(c.h - primary.h)) > 40 &&
      c.weight > primary.weight * 0.15
  )
  return {
    primary: readable(primary),
    secondary: other ? toHex(other.h, other.s * 0.5, 0.92) : '#ffffff'
  }
}
