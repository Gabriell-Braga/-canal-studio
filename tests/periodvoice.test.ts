import { beforeEach, describe, expect, it } from 'vitest'
import { getSettings, setSettings } from '../electron/db/settings'
import { formatOf, periodVoice, voiceAfterFormatChange } from '../shared/formats'
import { freshDb } from './helpers'

describe('period announcer voice', () => {
  beforeEach(() => {
    freshDb()
  })

  it('uses af_heart as the vintage-ads narrator', () => {
    expect(formatOf('vintage-ads').voices.narrator).toBe('af_heart')
  })

  it('falls back to the format voice at 1.05x and keeps the channel choice', () => {
    const s = setSettings({ format: 'vintage-ads' }, 1)
    expect(periodVoice(s)).toMatchObject({ voice: 'bm_george', speed: 1.05 })
    expect(periodVoice(s)?.filter).toMatch(/lowpass/)
    setSettings({ secondaryVoice: 'am_adam', secondaryVoiceSpeed: 0.9 }, 1)
    expect(periodVoice(getSettings(1))).toMatchObject({ voice: 'am_adam', speed: 0.9 })
    expect(getSettings(2).secondaryVoice).toBe('')
  })

  it('has no announcer in formats without a second voice', () => {
    expect(periodVoice(setSettings({ format: 'business-history' }, 1))).toBeNull()
  })

  it('keeps the chosen narrator on format change, except on a new channel', () => {
    const ads = formatOf('vintage-ads')
    expect(voiceAfterFormatChange('bm_daniel', ads, ['bm_daniel', 'af_heart'], false)).toBe(
      'bm_daniel'
    )
    expect(voiceAfterFormatChange('bm_daniel', ads, [], false)).toBe('bm_daniel')
    expect(voiceAfterFormatChange('gone_voice', ads, ['af_heart'], false)).toBe('af_heart')
    expect(voiceAfterFormatChange('', ads, [], false)).toBe('af_heart')
    expect(voiceAfterFormatChange('bm_daniel', ads, [], true)).toBe('af_heart')
  })
})
