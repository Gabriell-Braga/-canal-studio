import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { z } from 'zod'
import type { Settings } from '../../shared/types'
import { generateJson } from './ollama'

let skillFile = ''

/** The scriptwriting skill (.claude/skills/documentary-scriptwriter) is Claude's system prompt. */
export function configureLlm(opts: { skillFile: string }): void {
  skillFile = opts.skillFile
}

function skillText(): string {
  if (!skillFile || !existsSync(skillFile)) return ''
  // Drop the YAML front matter; the body is the guidance.
  return readFileSync(skillFile, 'utf8')
    .replace(/^---[\s\S]*?---\s*/, '')
    .trim()
}

export interface LlmCall {
  settings: Settings
  signal?: AbortSignal
  temperature?: number
  /** Let Claude search the web (fact-checking). Ignored by Ollama. */
  webSearch?: boolean
  /** Heavier thinking for scripts; cheap calls (titles, picks) stay at the default. */
  effort?: 'low' | 'medium' | 'high'
  /** Ollama context window for long outputs */
  numCtx?: number
}

const API_MODELS: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5'
}

export function llmLabel(s: Settings): string {
  if (s.llmProvider === 'claude-code') return `Claude ${s.claudeModel} (assinatura)`
  if (s.llmProvider === 'claude-api') return `${API_MODELS[s.claudeModel] ?? s.claudeModel} (API)`
  return s.ollamaModel
}

/**
 * One structured call to the configured model: Ollama (local, free), Claude through the
 * user's Claude Code login, or Claude through an Anthropic API key. Always returns data
 * validated by `schema`.
 */
export async function generateStructured<T>(
  prompt: string,
  schema: z.ZodType<T>,
  call: LlmCall
): Promise<T> {
  const s = call.settings
  if (s.llmProvider === 'claude-code') return claudeCode(prompt, schema, call)
  if (s.llmProvider === 'claude-api') return claudeApi(prompt, schema, call)
  return generateJson(prompt, schema, {
    url: s.ollamaUrl,
    model: s.ollamaModel,
    signal: call.signal,
    temperature: call.temperature,
    numCtx: call.numCtx
  })
}

// ---------------------------------------------------------------- Claude Code (subscription)

interface CliResult {
  is_error?: boolean
  result?: string
  structured_output?: unknown
  subtype?: string
}

/**
 * Headless Claude Code (`claude -p`) with the user's own login. User settings, hooks,
 * plugins, skills and MCP servers are left out so personal setup cannot change the output;
 * only web search/fetch are allowed, and only for fact-checking.
 */
async function claudeCode<T>(prompt: string, schema: z.ZodType<T>, call: LlmCall): Promise<T> {
  const tools = call.webSearch ? 'WebSearch,WebFetch' : ''
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(cliSchema(schema)),
    '--model',
    call.settings.claudeModel,
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--tools',
    tools,
    ...(tools ? ['--allowedTools', tools] : []),
    ...(call.effort ? ['--effort', call.effort] : []),
    '--system-prompt',
    skillText() || 'You write narration scripts for YouTube documentaries.'
  ]
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await runCli(args, prompt, call.signal)
      const result = JSON.parse(out) as CliResult
      if (result.is_error) throw new Error(result.result || `Claude Code: ${result.subtype}`)
      return schema.parse(result.structured_output ?? extractJson(result.result ?? ''))
    } catch (error) {
      if (call.signal?.aborted) throw error
      const message = (error as Error).message
      // Login and usage-limit problems will not fix themselves on a retry.
      if (/not logged in|login|usage limit|rate limit/i.test(message)) throw error
      lastError = error
    }
  }
  throw new Error(`Claude Code falhou: ${(lastError as Error)?.message ?? lastError}`)
}

/** The CLI validates with a draft-07 validator; zod adds a 2020-12 $schema key it rejects. */
function cliSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  void _ignored
  return rest
}

function runCli(args: string[], input: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // Run outside the project so Claude cannot read or edit app files.
    const p = spawn('claude', args, { cwd: tmpdir(), windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    const onAbort = (): void => {
      p.kill()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => p.kill(), 15 * 60_000)
    p.on('error', (e) =>
      reject(
        (e as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error('Claude Code não encontrado. Instale e faça login com `claude` no terminal.')
          : e
      )
    )
    p.on('exit', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(new Error('Cancelado'))
      if (out.trim().startsWith('{')) return resolve(out)
      reject(new Error(`Claude Code saiu com código ${code}: ${(err || out).trim().slice(-400)}`))
    })
    p.stdin.end(input)
  })
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  return JSON.parse(raw)
}

// ---------------------------------------------------------------- Claude API (API key)

async function claudeApi<T>(prompt: string, schema: z.ZodType<T>, call: LlmCall): Promise<T> {
  const s = call.settings
  if (!s.anthropicApiKey)
    throw new Error('Configure a chave da API da Anthropic em Configurações gerais')
  const client = new Anthropic({ apiKey: s.anthropicApiKey })
  const model = API_MODELS[s.claudeModel] ?? s.claudeModel
  const system = skillText() || undefined

  try {
    if (!call.webSearch) {
      const response = await client.messages.parse(
        {
          model,
          max_tokens: 16000,
          system,
          output_config: { format: zodOutputFormat(schema), effort: call.effort ?? 'medium' },
          messages: [{ role: 'user', content: prompt }]
        },
        { signal: call.signal }
      )
      if (response.stop_reason === 'refusal') throw new Error('O modelo recusou o pedido')
      if (!response.parsed_output) throw new Error('Resposta sem JSON válido')
      return response.parsed_output
    }

    // Fact-checking: web search first, then the verdict as JSON in the final text.
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `${prompt}\n\nUse web search to verify the claims. When done, reply with ONLY the JSON object, no other text.\nJSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`
      }
    ]
    for (let turn = 0; turn < 4; turn++) {
      const response = await client.messages.create(
        {
          model,
          max_tokens: 16000,
          system,
          output_config: { effort: call.effort ?? 'medium' },
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10 }],
          messages
        },
        { signal: call.signal }
      )
      if (response.stop_reason === 'refusal') throw new Error('O modelo recusou o pedido')
      if (response.stop_reason === 'pause_turn') {
        // Long server-tool turns pause; send the partial turn back to continue it.
        messages.push({ role: 'assistant', content: response.content })
        continue
      }
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      return schema.parse(extractJson(text))
    }
    throw new Error('A checagem não terminou')
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError)
      throw new Error('Chave da API da Anthropic inválida')
    if (error instanceof Anthropic.RateLimitError)
      throw new Error('Limite da API da Anthropic atingido; tente mais tarde')
    if (error instanceof Anthropic.APIError)
      throw new Error(`API da Anthropic ${error.status}: ${error.message}`)
    throw error
  }
}
