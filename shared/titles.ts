/**
 * Title checks against the channel's recent titles: a channel whose titles all read
 * "The <year> Mistake That…" looks templated to viewers and to YouTube.
 */

export const RECENT_TITLES = 15
export const MAX_SIMILARITY = 0.5

const FUNCTION_WORDS = new Set(
  'the a an of to in on at for and or but that this these those who what why how when where which was were is are did does do had has have it its their his her they them he she we you your our my me i into from by with as than then so not no never ever just only one'.split(
    ' '
  )
)

function tokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[“”"'’]/g, '')
    .split(/[^a-z0-9$%]+/)
    .filter(Boolean)
}

/** "The 2007 Mistake That Killed BlackBerry" → "the <n> x that x". */
export function skeleton(title: string): string {
  const out: string[] = []
  for (const t of tokens(title)) {
    const s = /\d/.test(t) ? '<n>' : FUNCTION_WORDS.has(t) ? t : 'x'
    // Runs of content words collapse: the shape is what repeats, not the length.
    if (s === 'x' && out[out.length - 1] === 'x') continue
    out.push(s)
  }
  return out.join(' ')
}

/** Share of content words two titles have in common (Jaccard). */
export function similarity(a: string, b: string): number {
  const set = (t: string): Set<string> =>
    new Set(tokens(t).filter((w) => !FUNCTION_WORDS.has(w) && w.length > 1))
  const x = set(a)
  const y = set(b)
  if (!x.size || !y.size) return 0
  let common = 0
  for (const w of x) if (y.has(w)) common++
  return common / (x.size + y.size - common)
}

/**
 * Has something you could picture or check: a number, a quoted phrase, or a name or object
 * from the story (`entities`: companies, people, products the script names).
 */
export function hasConcreteElement(title: string, entities: string[] = []): boolean {
  if (/\d|\$|£|€/.test(title)) return true
  if (/["“'‘][^"”'’]{3,}["”'’]/.test(title)) return true
  const words = new Set(tokens(title))
  return entities.some((e) => {
    const parts = tokens(e).filter((w) => !FUNCTION_WORDS.has(w) && w.length > 2)
    return parts.length > 0 && parts.some((w) => words.has(w))
  })
}

/** Why a title is rejected (pt-BR), empty when it passes. */
export function titleProblems(title: string, recent: string[], entities: string[] = []): string[] {
  const problems: string[] = []
  const first3 = tokens(title).slice(0, 3).join(' ')
  const shape = skeleton(title)
  // The shape repeats when the first four slots match and they are not just content words.
  const lead = (s: string): string => s.split(' ').slice(0, 4).join(' ')
  const shaped = (s: string): boolean => s.split(' ').filter((w) => w !== 'x').length >= 2
  for (const r of recent) {
    if (tokens(r).slice(0, 3).join(' ') === first3 && first3.split(' ').length === 3) {
      problems.push(`Começa com as mesmas 3 palavras de "${r}"`)
      break
    }
  }
  for (const r of recent) {
    const other = skeleton(r)
    if (shaped(lead(shape)) && lead(other) === lead(shape)) {
      problems.push(`Mesmo esqueleto de "${r}" (${lead(shape)})`)
      break
    }
  }
  for (const r of recent) {
    const sim = similarity(title, r)
    if (sim > MAX_SIMILARITY) {
      problems.push(`Parecido demais com "${r}" (${Math.round(sim * 100)}%)`)
      break
    }
  }
  if (!hasConcreteElement(title, entities))
    problems.push('Sem elemento concreto (nome, valor, objeto ou frase citada)')
  return problems
}

/** Candidates that pass the checks, in order; never empty when there were candidates. */
export function passingTitles(
  titles: string[],
  recent: string[],
  entities: string[] = []
): string[] {
  const ok = titles.filter((t) => !titleProblems(t, recent, entities).length)
  return ok.length ? ok : titles
}
