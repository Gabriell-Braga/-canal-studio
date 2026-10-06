import { describe, expect, it } from 'vitest'
import type { Scene } from '../shared/types'
import { buildChapters, timestamp } from '../electron/steps/metadata'
import { aiIndexes } from '../electron/steps/scenes'
import { clampWords } from '../electron/steps/thumbnail'
import { toPhrases } from '../remotion/Video'

function scene(i: number, start: number, end: number): Scene {
  return {
    id: i,
    video_id: 1,
    index: i,
    narration: `Scene ${i}`,
    visual_keywords: '',
    image_prompt: '',
    asset_type: null,
    asset_path: null,
    asset_source: null,
    start_sec: start,
    end_sec: end,
    locked: false
  }
}

describe('pipeline helpers', () => {
  it('spreads AI scenes evenly', () => {
    expect([...aiIndexes(10, 0.3)]).toEqual([1, 5, 8])
    expect(aiIndexes(10, 0).size).toBe(0)
    expect(aiIndexes(4, 1).size).toBe(4)
  })

  it('keeps thumbnail headlines at 2–4 words without a dangling preposition', () => {
    expect(clampWords('The Last Voyage of the Octavius')).toBe('The Last Voyage')
    expect(clampWords('"Frozen in Time"')).toBe('Frozen in Time')
  })

  it('builds YouTube chapters starting at 0:00', () => {
    const scenes = Array.from({ length: 40 }, (_, i) => scene(i, i * 15, (i + 1) * 15))
    const chapters = buildChapters(scenes)
    expect(chapters.length).toBeGreaterThanOrEqual(3)
    expect(chapters[0].start).toBe(0)
    expect(timestamp(chapters[1].start)).toMatch(/^\d+:\d\d$/)
    expect(buildChapters(scenes.slice(0, 3))).toEqual([])
  })

  it('splits captions into short phrases', () => {
    const words = 'In 1847 a whaling ship was found. Nobody aboard was alive'
      .split(' ')
      .map((w, i) => ({ word: w, start: i * 0.3, end: i * 0.3 + 0.25 }))
    const phrases = toPhrases(words)
    expect(phrases.every((p) => p.words.length <= 5)).toBe(true)
    expect(phrases.map((p) => p.words.length)).toEqual([5, 2, 4])
  })
})
