import { describe, expect, it } from 'vitest'
import { planMusic } from '../electron/steps/music'

describe('planMusic', () => {
  it('opens, turns dramatic, then closes', () => {
    expect(planMusic(200, 600, 640)).toEqual([
      { mood: 'open', from: 0, to: 200 },
      { mood: 'drama', from: 200, to: 600 },
      { mood: 'final', from: 600, to: 640 }
    ])
  })

  it('skips the dramatic part when the story never turns bad', () => {
    expect(planMusic(null, 600, 640).map((p) => p.mood)).toEqual(['open', 'final'])
  })

  it('never starts dramatic in the first minute or for a short stretch', () => {
    expect(planMusic(30, 600, 640).map((p) => p.mood)).toEqual(['open', 'final'])
    expect(planMusic(580, 600, 640).map((p) => p.mood)).toEqual(['open', 'final'])
  })

  it('keeps one track when there is no outro', () => {
    expect(planMusic(null, null, 640)).toEqual([{ mood: 'open', from: 0, to: 640 }])
  })
})
