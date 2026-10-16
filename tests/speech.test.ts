import { describe, expect, it } from 'vitest'
import {
  announcerNoteFor,
  expandTitles,
  planAnnouncer,
  speakableAd,
  speakableNarration
} from '../shared/formats/vintage-ads'
import { masterFilter, MASTER, type LoudnessReading } from '../electron/services/ffmpeg'
import { spellingSimilarity, usablePronunciations } from '../electron/steps/audio'
import { isEnglishWord } from '../electron/services/words'
import type { Script } from '../shared/types'

describe('narrator text for the TTS', () => {
  it('reads titles as words, so Kokoro does not stop at their period', () => {
    expect(speakableNarration('Mrs. Haule wrote to Mr. Pinkham and Dr. Pierce.')).toBe(
      'Missus Haule wrote to Mister Pinkham and Doctor Pierce.'
    )
    expect(expandTitles('She moved to St. Louis, then to Main St. in Lynn.')).toBe(
      'She moved to Saint Louis, then to Main Street in Lynn.'
    )
    // The announcer keeps the same expansion.
    expect(speakableAd('Write to Mrs. Pinkham')).toBe('Write to Missus Pinkham')
  })

  it('applies the pronunciation dictionary: respellings and misaki phonemes', () => {
    const out = speakableNarration('Edward Bok met Aroline in Lynn. Bokster stays.', {
      Bok: 'Bock',
      Aroline: '/ˈæɹəlin/'
    })
    expect(out).toBe('Edward Bock met [Aroline](/ˈæɹəlin/) in Lynn. Bokster stays.')
  })

  it('keeps only respellings that tested at least as close as the plain name', () => {
    expect(
      usablePronunciations({
        Bok: { say: 'Bock', ok: true, heard: 'Bock', heardPlain: 'Book' },
        Lynn: { say: 'Lin', ok: false, heard: 'Lin', heardPlain: 'Lynn' }
      })
    ).toEqual({ Bok: 'Bock' })
    expect(spellingSimilarity('Lynn', 'Lynn.')).toBe(1)
    expect(spellingSimilarity('Bock', 'Bok')).toBeGreaterThan(
      spellingSimilarity('Book', 'Bok') - 0.01
    )
  })
})

describe('final limiter', () => {
  const reading = (i: number, tp: number): LoudnessReading => ({
    input_i: String(i),
    input_tp: String(tp),
    input_lra: '3',
    input_thresh: '-24',
    target_offset: '0'
  })

  it('leaves a mix at -14 LUFS under -1 dBTP alone', () => {
    expect(masterFilter(reading(-14.1, -3.4))).toBeNull()
  })

  it('limits a mix peaking above -1 dBTP, keeping -14 LUFS', () => {
    const f = masterFilter(reading(-14, 0.5)) as string
    expect(f).toContain(`TP=${MASTER.truePeak}`)
    expect(f).toContain(`I=${MASTER.lufs}`)
    expect(f).toContain('measured_TP=0.5')
  })
})

describe('period announcer', () => {
  const OCR =
    "LYDIA E. PINKHAM'S VEGETABLE COMPOUND cures the worst forms of female complaints and all ovarian troubles. " +
    'Another club woman, Mrs. Haule, of Edgerton, Wis., tells how she was cured of irregularities and uterine trouble, terrible pains and backache.'
  const script = (claims: { scene: number; quote: string }[]): Script => ({
    title_options: ['t'],
    hook: 'hook',
    outro: '',
    scenes: Array.from({ length: 25 }, () => ({
      narration: 'x',
      visual_keywords: '',
      image_prompt: ''
    })),
    claims: claims.map((c) => ({ ...c, verdict: 'FALSE', source: 'Book, 1979' }))
  })

  it('reads at least one line when a Claim Check quote passes the filter', () => {
    const plan = planAnnouncer(
      script([
        { scene: 8, quote: 'cures the worst forms of female complaints and all ovarian troubles' }
      ]),
      OCR,
      (s) => s * 30,
      isEnglishWord
    )
    expect(plan.segments).toHaveLength(1)
    expect(plan.segments[0].start).toBeGreaterThanOrEqual(60)
  })

  it('explains in the review why a video has none', () => {
    // Video 62: only the testimonial ad and a 4-word fragment.
    const plan = planAnnouncer(
      script([
        { scene: 19, quote: 'cured of irregularities and uterine trouble' },
        { scene: 21, quote: 'terrible pains and backache' }
      ]),
      OCR,
      (s) => s * 30,
      isEnglishWord
    )
    expect(plan.segments).toHaveLength(0)
    const note = announcerNoteFor(plan)
    expect(note).toContain('cena 19')
    expect(note).toContain('cena 21')
  })
})
