import { CHANNEL_SETTING_KEYS, type Settings } from '../../shared/types'
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
  pixabayApiKey: '',
  stockProviders: ['pixabay', 'wikimedia', 'pexels'],
  wikimediaAllowCcBy: true,
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

const CHANNEL_KEYS = new Set<string>(CHANNEL_SETTING_KEYS)

function readRows(prefix: string): Record<string, unknown> {
  const rows = db()
    .prepare("SELECT key, value FROM settings WHERE key LIKE ? || '%'")
    .all(prefix) as { key: string; value: string }[]
  const out: Record<string, unknown> = {}
  for (const { key, value } of rows) {
    const name = key.slice(prefix.length)
    if (!prefix && (name.startsWith('ch.') || name.startsWith('state.'))) continue
    try {
      out[name] = JSON.parse(value)
    } catch {
      // ignore corrupt values; the default applies
    }
  }
  return out
}

/**
 * Shared settings, plus the channel's own values for CHANNEL_SETTING_KEYS when a channel
 * is given. A channel without its own value falls back to the shared one, then the default.
 */
export function getSettings(channelId?: number | null): Settings {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...readRows('') }
  if (channelId) {
    for (const [key, value] of Object.entries(readRows(`ch.${channelId}.`))) {
      if (CHANNEL_KEYS.has(key)) merged[key] = value
    }
  }
  return merged as unknown as Settings
}

/** Channel-specific keys go to the channel when one is given; the rest are shared. */
export function setSettings(patch: Partial<Settings>, channelId?: number | null): Settings {
  const upsert = db().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  db().transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !(key in DEFAULT_SETTINGS)) continue
      const stored = channelId && CHANNEL_KEYS.has(key) ? `ch.${channelId}.${key}` : key
      upsert.run(stored, JSON.stringify(value))
    }
  })()
  notify('settings')
  return getSettings(channelId)
}

/** New channel: start from another channel's settings (or the defaults). */
export function copyChannelSettings(fromId: number | null, toId: number): void {
  const source = fromId ? getSettings(fromId) : DEFAULT_SETTINGS
  const patch = Object.fromEntries(CHANNEL_SETTING_KEYS.map((k) => [k, source[k]]))
  setSettings(patch as Partial<Settings>, toId)
}

export function deleteChannelSettings(channelId: number): void {
  db().prepare("DELETE FROM settings WHERE key LIKE ? || '%'").run(`ch.${channelId}.`)
  db().prepare("DELETE FROM settings WHERE key LIKE ? || '%'").run(`state.ch.${channelId}.`)
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
