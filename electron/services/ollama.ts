import { z } from 'zod'

export interface OllamaOptions {
  url: string
  model: string
  numCtx?: number
  temperature?: number
  signal?: AbortSignal
}

interface ChatResponse {
  message?: { content: string }
  error?: string
}

/**
 * One structured-output call. keep_alive: 0 unloads the model right after the answer,
 * so the 12 GB of VRAM are free for Kokoro, Whisper and ComfyUI.
 */
export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts: OllamaOptions,
  retries = 2
): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema)
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${opts.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify({
          model: opts.model,
          messages: [{ role: 'user', content: prompt }],
          format: jsonSchema,
          stream: false,
          think: false,
          keep_alive: 0,
          options: { num_ctx: opts.numCtx ?? 8192, temperature: opts.temperature ?? 0.7 }
        })
      })
      const body = (await res.json()) as ChatResponse
      if (!res.ok || body.error) throw new Error(body.error ?? `Ollama HTTP ${res.status}`)
      const content = stripThinking(body.message?.content ?? '')
      return schema.parse(JSON.parse(content))
    } catch (error) {
      if (opts.signal?.aborted) throw error
      lastError = error
    }
  }
  throw new Error(`Ollama returned invalid JSON after ${retries + 1} tries: ${describe(lastError)}`)
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

function describe(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  return error instanceof Error ? error.message : String(error)
}

/** Unload every model Ollama has in memory. Called before ComfyUI work. */
export async function unloadAll(url: string): Promise<void> {
  try {
    const res = await fetch(`${url}/api/ps`, { signal: AbortSignal.timeout(3000) })
    const { models } = (await res.json()) as { models: { name: string }[] }
    for (const m of models) {
      await fetch(`${url}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({ model: m.name, keep_alive: 0 })
      })
    }
  } catch {
    // Ollama not running means nothing is loaded.
  }
}
