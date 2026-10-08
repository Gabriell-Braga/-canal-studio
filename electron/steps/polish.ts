import { z } from 'zod'
import type { Script, Settings } from '../../shared/types'
import { generateStructured } from '../services/llm'

const patchSchema = z.object({
  hook: z.string(),
  teaser: z.string(),
  outro: z.string(),
  scenes: z.array(
    z.object({ scene: z.number().int(), narration: z.string(), real_subject: z.string() })
  )
})

/** Claude does the final pass even when Ollama wrote the script; Sonnet keeps it cheap. */
export function polishSettings(s: Settings): Settings {
  return {
    ...s,
    llmProvider: s.llmProvider === 'claude-api' ? 'claude-api' : 'claude-code',
    claudeModel: 'sonnet'
  }
}

/**
 * Final edit by Claude: hook, calm outro, flow and real photos of named people and devices.
 * It answers with the changed parts only, so the output stays a few hundred tokens.
 * Marks the script as polished and returns how many parts changed.
 */
export async function polishScript(
  script: Script,
  topic: string,
  settings: Settings,
  signal?: AbortSignal
): Promise<number> {
  const listing = [
    `HOOK: ${script.hook}`,
    ...script.scenes.map(
      (s, i) =>
        `SCENE ${i + 1}${s.year ? ` (${s.year})` : ''}${s.real_subject ? ` [real: ${s.real_subject}]` : ''}: ${s.narration}`
    ),
    `OUTRO: ${script.outro}`
  ].join('\n')
  const patch = await generateStructured(
    `Final edit of a YouTube documentary script about "${topic}". Return ONLY what must change: "" for a field that is already good, and list only scenes you change. Most scenes should stay untouched.
Check:
1. Hook: first line is a punchy twist that names the subject; it ends asking the viewer to stay until the end. No greeting.
2. Outro: calm and unhurried, 3–5 sentences: a reflective conclusion, a quiet closing thought, then ONE gentle invitation to subscribe. Rewrite it if it lists like/comment/bell, asks for several actions or feels rushed.
3. Flow: cut repetition and filler, fix awkward spoken phrasing. Keep the facts, the length and every year the narration says.
4. real_subject: for a scene about a specific real person, product, device, place or event, the words that find a real photo on Wikimedia Commons. Devices (computer, phone, console, chip, car, gadget) get the exact maker and model, e.g. "IBM PC 5150". Fill it only when missing or wrong; narration "" keeps the text.
teaser: at most 9 words, only when the hook changes.

SCRIPT:
${listing}`,
    patchSchema,
    { settings: polishSettings(settings), signal, temperature: 0.3, effort: 'medium' }
  )
  let changes = 0
  const set = (value: string, apply: (v: string) => void): void => {
    if (!value.trim()) return
    apply(value.trim())
    changes++
  }
  set(patch.hook, (v) => (script.hook = v))
  set(patch.teaser, (v) => (script.teaser = v))
  set(patch.outro, (v) => (script.outro = v))
  for (const p of patch.scenes) {
    const scene = script.scenes[p.scene - 1]
    if (!scene) continue
    set(p.narration, (v) => (scene.narration = v))
    set(p.real_subject, (v) => (scene.real_subject = v))
  }
  script.polished = true
  return changes
}
