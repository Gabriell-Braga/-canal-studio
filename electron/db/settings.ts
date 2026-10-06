import type { Settings } from '../../shared/types'
import { db } from './index'
import { notify } from './repo'

export const DEFAULT_SCRIPT_PROMPT = `You are a scriptwriter for a successful faceless YouTube documentary channel. Write a script about: {topic}. Target length: {minutes} minutes of narration (~{words} words in total, ~150 words per minute).
Rules: open with a strong hook in the first 15 seconds that creates curiosity; tell it as a story with tension and payoff; short, spoken-style sentences; no filler, no "in this video we will"; concrete facts, names, numbers and dates; add an open loop every 2–3 minutes to keep viewers watching; end with a satisfying conclusion and a soft call to subscribe.
Split into scenes of 10–20 seconds of narration each (about {scenes} scenes, 25–50 words each). For each scene give: narration, visual_keywords (2–4 English words for stock footage search) and image_prompt (a detailed image-generation prompt, documentary style, no text in image).
Give 3 title_options (max 70 characters each), the hook (first 15 seconds of narration) and the outro (conclusion + soft call to subscribe). The hook and outro are narrated too, so do not repeat them inside scenes.
Return ONLY valid JSON matching the schema.`

export const DEFAULT_REVIEW_PROMPT = `You are a demanding YouTube script editor and fact-checker. Review the script below about "{topic}".
Check: hook strength in the first 15 seconds, pacing, repetition, filler, and any factual claim (names, numbers, dates, quotes) that may be wrong or unverifiable.
Return a short list of alerts (max 8). Each alert has: kind ("hook", "pacing", "repetition", "dubious_fact" or "other"), message (one sentence, in Brazilian Portuguese, telling the creator what to check or fix) and quote (the exact phrase from the script, in English, when relevant).
Every claim that a creator should double-check before publishing must be a "dubious_fact" alert.
Return ONLY valid JSON: {"alerts": [...]}.

SCRIPT:
{script}`

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen3:14b',
  scriptPrompt: DEFAULT_SCRIPT_PROMPT,
  reviewPrompt: DEFAULT_REVIEW_PROMPT,
  defaultDurationMin: 10,
  defaultNiche: '',
  nightStart: '01:00',
  nightEnd: '07:00',
  maxVideosPerNight: 3,
  voice: 'am_michael',
  voiceSpeed: 1,
  scenePauseSec: 0.35,
  whisperModel: 'small.en',
  whisperDevice: 'auto',
  comfyUrl: 'http://127.0.0.1:8188',
  comfyPath: 'D:\\ComfyUI_windows_portable',
  comfyCheckpoint: 'sd_xl_base_1.0.safetensors',
  pexelsApiKey: '',
  aiImageRatio: 0.3,
  captionsEnabled: true,
  musicVolume: 0.12,
  templates: ['documentary', 'bold', 'minimal'],
  publishSlots: [
    { weekday: 1, time: '14:00' },
    { weekday: 3, time: '14:00' },
    { weekday: 5, time: '14:00' }
  ],
  publishTimezone: 'America/New_York',
  syntheticDefault: true,
  googleClientId: '',
  googleClientSecret: '',
  startWithWindows: false,
  minimizeToTray: true
}

export function getSettings(): Settings {
  const rows = db().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored: Record<string, unknown> = {}
  for (const { key, value } of rows) {
    try {
      stored[key] = JSON.parse(value)
    } catch {
      // ignore corrupt values; the default applies
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored } as Settings
}

export function setSettings(patch: Partial<Settings>): Settings {
  const upsert = db().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  db().transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !(key in DEFAULT_SETTINGS)) continue
      upsert.run(key, JSON.stringify(value))
    }
  })()
  notify('settings')
  return getSettings()
}

/** Small key/value state that is not user-facing (queue flags, counters). */
export function getState<T>(key: string, fallback: T): T {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(`state.${key}`) as
    { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : fallback
}

export function setState(key: string, value: unknown): void {
  db()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(`state.${key}`, JSON.stringify(value))
}
