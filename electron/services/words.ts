import list from '../data/english-words.txt?raw'

// Lowercase English words from Kokoro's misaki lexicon (Apache-2.0), inflected forms dropped.
let words: Set<string> | null = null

/** Whether a lowercase word is English, allowing plural and -ed/-ing endings. */
export function isEnglishWord(w: string): boolean {
  words ??= new Set(list.split('\n'))
  if (words.has(w)) return true
  const stems = [
    w.endsWith('ies') && `${w.slice(0, -3)}y`,
    w.endsWith('es') && w.slice(0, -2),
    w.endsWith('s') && w.slice(0, -1),
    w.endsWith('ed') && w.slice(0, -2),
    w.endsWith('ed') && w.slice(0, -1),
    w.endsWith('ing') && w.slice(0, -3),
    w.endsWith('ing') && `${w.slice(0, -3)}e`
  ]
  return stems.some((s) => !!s && words!.has(s))
}
