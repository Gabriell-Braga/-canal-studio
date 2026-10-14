import { describe, expect, it } from 'vitest'
import {
  hasConcreteElement,
  passingTitles,
  similarity,
  skeleton,
  titleProblems
} from '../shared/titles'

describe('title checks', () => {
  it('reduces a title to its shape', () => {
    expect(skeleton('The 2007 Mistake That Killed BlackBerry')).toBe('the <n> x that x')
    expect(skeleton('The 1998 Deal That Sank Nokia')).toBe('the <n> x that x')
  })

  it('rejects the same skeleton', () => {
    const p = titleProblems('The 1998 Deal That Sank Nokia', [
      'The 2007 Mistake That Killed BlackBerry'
    ])
    expect(p.some((x) => x.includes('esqueleto'))).toBe(true)
  })

  it('rejects the same first three words', () => {
    const p = titleProblems('Why Did Nokia Hide Its Phone?', ['Why Did Nokia Fail?'])
    expect(p.some((x) => x.includes('3 palavras'))).toBe(true)
  })

  it('rejects near duplicates', () => {
    expect(
      similarity('Nokia Buried Its Own iPhone', 'How Nokia Buried Its iPhone')
    ).toBeGreaterThan(0.5)
    const p = titleProblems('Nokia Buried Its Own iPhone', ['How Nokia Buried Its iPhone'])
    expect(p.some((x) => x.includes('Parecido'))).toBe(true)
  })

  it('needs a concrete element', () => {
    expect(hasConcreteElement('The $50 Million Deal')).toBe(true)
    expect(hasConcreteElement('They Said "Send No Money"')).toBe(true)
    expect(hasConcreteElement('The Belt That Recharged Men', ['Heidelberg Electric Belt'])).toBe(
      true
    )
    expect(hasConcreteElement('The Mistake Nobody Saw Coming')).toBe(false)
  })

  it('passes a fresh, concrete title', () => {
    expect(
      titleProblems('The Hotel Chain That Sold Its Name for $1', [
        'The 2007 Mistake That Killed BlackBerry',
        'Why Did Kodak Fail?'
      ])
    ).toEqual([])
  })

  it('keeps candidates when every one fails', () => {
    expect(passingTitles(['Vague One', 'Vague Two'], [])).toEqual(['Vague One', 'Vague Two'])
    expect(passingTitles(['Vague One', 'The $5 Tonic'], [])).toEqual(['The $5 Tonic'])
  })
})
