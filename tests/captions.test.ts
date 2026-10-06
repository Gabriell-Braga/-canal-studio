import { describe, expect, it } from 'vitest'
import { toSrt } from '../electron/services/captions'

const words =
  'In 2000 three men flew to Dallas. Blockbuster said no to a deal that would have changed everything forever.'
    .split(' ')
    .map((w, i) => ({ word: w, start: i * 0.4, end: i * 0.4 + 0.35 }))

describe('srt', () => {
  it('builds numbered cues with SubRip timestamps', () => {
    const srt = toSrt(words)
    expect(srt.startsWith('1\n00:00:00,000 --> ')).toBe(true)
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/)
  })

  it('keeps lines short and breaks at sentence ends', () => {
    const lines = toSrt(words)
      .split('\n')
      .filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->'))
    expect(lines.every((l) => l.length <= 50)).toBe(true)
    expect(lines.some((l) => l.endsWith('Dallas.'))).toBe(true)
  })
})
