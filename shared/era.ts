/**
 * Period checks of Ads on Trial media: printed clues that date a picture after 1930, and
 * whether a dated picture belongs to the time a scene talks about.
 */

/** Words and patterns that only exist in later ads, with the reason shown in the review. */
const LATE_CLUES: [RegExp, string][] = [
  [/\bnylon\b/i, 'nylon'],
  [/\bplastics?\b/i, 'plastic'],
  [/\btelevision\b/i, 'television'],
  [/\bvaradan\b/i, 'Varadan'],
  [/\bzip\s*(code)?\b/i, 'ZIP code'],
  // Two-letter state + five digits: postal codes, 1963 on ("Lynn, MA 01901").
  [/\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/, 'ZIP code'],
  [/\byours\s+for\s+only\b/i, '"yours for only"'],
  [/\$\s?\d[\d.,]*\s+value\b/i, '"$ value"']
]

/** The first late clue in OCR text, or null when nothing dates it after 1930. */
export function lateClue(ocr: string): string | null {
  for (const [re, why] of LATE_CLUES) if (re.test(ocr)) return why
  return null
}

/** How far a picture may be from the scene's year. */
export const ERA_TOLERANCE = 15

/** Narration that talks about what came after (the picture may be later than the scene). */
const LATER =
  /\b(later|afterwards?|after (her|his|their|the) death|decades|years after|today|still|since|by the (19|20)\d0s|went on|kept|continued|outlived|long after)\b/i

/**
 * Why a picture dated `mediaYear` does not belong in a scene set in `sceneYear`, or null.
 * Unknown years pass (the source check already refused undated media). A scene that talks
 * about what came after accepts later pictures.
 */
export function eraProblem(
  mediaYear: number | null | undefined,
  sceneYear: number | null | undefined,
  narration: string
): string | null {
  if (!mediaYear || !sceneYear) return null
  if (mediaYear < sceneYear - ERA_TOLERANCE) return `de ${mediaYear}, cena em ${sceneYear}`
  if (mediaYear > sceneYear + ERA_TOLERANCE && !LATER.test(narration))
    return `de ${mediaYear}, cena em ${sceneYear}`
  return null
}

/** Each scene's year: its own, else the last one before it (the story moves forward). */
export function sceneYears(years: (number | null | undefined)[]): (number | null)[] {
  let last: number | null = null
  return years.map((y) => (last = y || last))
}
