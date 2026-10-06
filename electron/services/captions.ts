import { writeFileSync } from 'fs'
import type { RenderWord } from '../../shared/render'

function stamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

/**
 * SubRip captions from Whisper's word timings: lines of up to ~42 characters (YouTube's
 * readable width), split at sentence ends and pauses, at most two lines per cue.
 */
export function toSrt(words: RenderWord[]): string {
  const cues: { start: number; end: number; lines: string[] }[] = []
  let line: RenderWord[] = []
  let cue: { start: number; end: number; lines: string[] } | null = null

  const pushLine = (): void => {
    if (!line.length) return
    const text = line.map((w) => w.word).join(' ')
    if (!cue || cue.lines.length >= 2) {
      if (cue) cues.push(cue)
      cue = { start: line[0].start, end: line[line.length - 1].end, lines: [text] }
    } else {
      cue.lines.push(text)
      cue.end = line[line.length - 1].end
    }
    line = []
  }

  words.forEach((w, i) => {
    const prev = words[i - 1]
    const length = line.reduce((n, x) => n + x.word.length + 1, 0) + w.word.length
    if (line.length && (length > 42 || (prev && w.start - prev.end > 0.6))) {
      pushLine()
      if (prev && w.start - prev.end > 0.6 && cue) {
        cues.push(cue)
        cue = null
      }
    }
    line.push(w)
    if (/[.!?]$/.test(w.word)) {
      pushLine()
      if (cue) {
        cues.push(cue)
        cue = null
      }
    }
  })
  pushLine()
  if (cue) cues.push(cue)

  return cues
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.lines.join('\n')}\n`)
    .join('\n')
}

export function writeSrt(words: RenderWord[], file: string): void {
  writeFileSync(file, toSrt(words), 'utf8')
}
