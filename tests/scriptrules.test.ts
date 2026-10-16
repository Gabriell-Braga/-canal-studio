import { describe, expect, it } from 'vitest'
import { scriptProblems } from '../shared/formats/vintage-ads'
import type { Script } from '../shared/types'

const words = (n: number): string => Array(n).fill('word').join(' ')
const page = { newspaper: 'Red River Prospector', city: 'Taos' }
const script = (hook: string, claimScene: number): Script =>
  ({
    hook,
    scenes: Array.from({ length: 12 }, () => ({ narration: words(40) })),
    claims: [{ scene: claimScene, quote: 'cures', verdict: 'FALSE' }]
  }) as unknown as Script

describe('Ads on Trial script rules', () => {
  const conflict = 'Women wrote to Lydia Pinkham for advice. She had been dead for twenty years.'

  it('passes a conflict hook with an early Claim Check', () => {
    // 40 words a scene at 2.5 words/s: scene 5 starts near 1:20.
    expect(scriptProblems(script(conflict, 5), page)).toEqual([])
  })

  it('flags a first Claim Check after 2:30', () => {
    // Scene 11 starts after 10 scenes of 16 s each: about 2:47.
    expect(scriptProblems(script(conflict, 11), page)).toEqual([
      expect.stringContaining('Primeiro Claim Check')
    ])
  })

  it('flags a hook about the newspaper', () => {
    const paper = 'On the last day of 1903, a weekly paper in Red River ran an ad.'
    expect(scriptProblems(script(paper, 5), page)).toEqual([expect.stringContaining('gancho')])
    expect(scriptProblems(script('An ad from Taos promised a cure.', 5), page)).toHaveLength(1)
  })
})
