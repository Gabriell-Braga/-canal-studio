import { describe, expect, it } from 'vitest'
import { eraProblem, lateClue, sceneYears } from '../shared/era'
import { latestYear } from '../electron/services/wikimedia'

describe('period filter', () => {
  it('refuses the 1950s nylon brush leaflet by its printed words', () => {
    const ocr =
      'Good Grooming Special! THE INNER YOU 5 pc. all nylon Brush and Comb Set $1.50 Value YOURS FOR ONLY 50¢ New Varadan Tablets'
    expect(lateClue(ocr)).toBe('nylon')
    expect(lateClue('Lydia E. Pinkham Medicine Co., Lynn, MA 01901')).toBe('ZIP code')
    expect(
      lateClue("Lydia E. Pinkham's Vegetable Compound cures female complaints. Lynn, Mass.")
    ).toBeNull()
  })

  it('needs a date from the source: none or a later one is refused', () => {
    expect(latestYear(undefined)).toBeNull()
    expect(latestYear('')).toBeNull()
    // The visible range counts, not the hidden machine date.
    expect(
      latestYear(
        'between 1883 and 1900<div style="display: none;">date QS:P,+1500-00-00T00:00:00Z/6</div>'
      )
    ).toBe(1900)
    expect(latestYear('1955')).toBe(1955)
  })

  it('keeps pictures within 15 years of the scene, later ones only where the story moves on', () => {
    expect(eraProblem(1903, 1895, 'The ad ran in the paper.')).toBeNull()
    expect(eraProblem(1903, 1819, 'Lydia Estes was born in Lynn.')).not.toBeNull()
    expect(eraProblem(1903, 1819, 'Decades later her face was on every bottle.')).toBeNull()
    expect(eraProblem(1850, 1903, 'Decades later her face was on every bottle.')).not.toBeNull()
    expect(eraProblem(undefined, 1900, '')).toBeNull()
  })

  it('gives scenes without a year the last year before them', () => {
    expect(sceneYears([null, 1819, null, 1875, undefined])).toEqual([null, 1819, 1819, 1875, 1875])
  })
})
