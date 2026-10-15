import { describe, expect, it } from 'vitest'
import { mediaGaps, noMedia, shotSpans } from '../shared/coverage'
import type { RenderScene } from '../shared/render'

const img = (src: string, sec?: number, filler = false): Omit<RenderScene, 'start' | 'end'> => ({
  src,
  type: 'image',
  motion: 0,
  ...(sec !== undefined ? { sec } : {}),
  ...(filler ? { filler } : {})
})
const scene = (start: number, end: number, ...shots: ReturnType<typeof img>[]): RenderScene => {
  const [main, ...rest] = shots
  return { ...main, start, end, shots: rest }
}

describe('media coverage', () => {
  it('passes when every scene shows real media back to back', () => {
    const scenes = [scene(0, 10, img('a', 5), img('b', 5)), scene(10, 20, img('c'))]
    expect(noMedia(scenes, 20)).toEqual([])
    expect(mediaGaps(scenes, 20)).toEqual([])
  })

  it('fails a scene that is only paper filler', () => {
    const scenes = [scene(0, 10, img('a')), scene(10, 22, img('paper', undefined, true))]
    expect(mediaGaps(scenes, 22)).toEqual([{ from: 10, to: 22 }])
  })

  it('accepts a filler stretch up to 2 s but not longer', () => {
    const short = [scene(0, 10, img('a', 8), img('paper', 2, true))]
    expect(mediaGaps(short, 10)).toEqual([])
    const long = [scene(0, 10, img('a', 7), img('paper', 3, true))]
    expect(mediaGaps(long, 10)).toEqual([{ from: 7, to: 10 }])
  })

  it('counts a hole between scenes as no media', () => {
    const scenes = [scene(0, 10, img('a')), scene(13, 20, img('b'))]
    expect(mediaGaps(scenes, 20)).toEqual([{ from: 10, to: 13 }])
  })

  it('splits a scene equally when shots carry no seconds', () => {
    const spans = shotSpans([scene(0, 12, img('a'), img('b'), img('c'))])
    expect(spans.map((s) => s.at)).toEqual([0, 4, 8])
  })
})
