import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

/**
 * Every request to loc.gov goes through here, within the limits the Library of Congress
 * publishes (loc.gov/apis/json-and-yaml/working-within-limits): one JSON API request per 4 s,
 * one image/file request per 0.5 s, an identified User-Agent. A 429, a 403 or a challenge
 * page stops ALL loc.gov requests for 65 minutes (retrying inside the block restarts it).
 * The challenge is never worked around: no headless browser, no solver, no other IP.
 */
export const LOC_USER_AGENT = 'CanalStudio/1.0 (contato: braga@gabrielbraga.app)'
export const LOC_GAP_MS = { json: 4000, file: 500 } as const
export const LOC_LOCKOUT_MS = 65 * 60_000

export type LocKind = keyof typeof LOC_GAP_MS

export interface LocBlock {
  /** ISO time the block was detected */
  at: string
  /** ISO time requests may start again */
  until: string
  reason: string
}

export class LocBlockedError extends Error {
  constructor(public block: LocBlock) {
    super(
      `Library of Congress bloqueada até ${new Date(block.until).toLocaleTimeString('pt-BR')} (${block.reason}); usando o Commons`
    )
  }
}

let stateFile = join(tmpdir(), 'canal-studio-loc.json')
let logger: (message: string) => void = (m) => console.warn(m)

export function configureLocGate(opts: { stateFile?: string; log?: (m: string) => void }): void {
  if (opts.stateFile) stateFile = opts.stateFile
  if (opts.log) logger = opts.log
}

/** The block in force at `now`, or null. Survives app restarts (kept in a file). */
export function locBlock(now = Date.now()): LocBlock | null {
  if (!existsSync(stateFile)) return null
  try {
    const b = JSON.parse(readFileSync(stateFile, 'utf8')) as LocBlock
    return Date.parse(b.until) > now ? b : null
  } catch {
    return null
  }
}

/** Start (or restart) the 65-minute block. */
export function startLocBlock(reason: string, now = Date.now()): LocBlock {
  const block = {
    at: new Date(now).toISOString(),
    until: new Date(now + LOC_LOCKOUT_MS).toISOString(),
    reason
  }
  mkdirSync(dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, JSON.stringify(block, null, 2))
  logger(
    `loc.gov bloqueou (${reason}) às ${new Date(now).toLocaleTimeString('pt-BR')}; nenhum pedido até ${new Date(now + LOC_LOCKOUT_MS).toLocaleTimeString('pt-BR')}`
  )
  return block
}

/** A Cloudflare / CAPTCHA challenge instead of the content asked for. */
export function isChallenge(status: number, contentType: string, body: string): string | null {
  if (status === 429) return 'HTTP 429'
  if (status === 403) return 'HTTP 403'
  if (!/html/i.test(contentType)) return null
  if (
    /<title>\s*Just a moment/i.test(body) ||
    /challenges\.cloudflare\.com|cf-chl|cf_chl_opt|challenge-platform/i.test(body) ||
    /captcha/i.test(body)
  )
    return 'página de desafio'
  return null
}

const last: Record<LocKind, number> = { json: 0, file: 0 }
let chain: Promise<unknown> = Promise.resolve()

/** Which limit a loc.gov URL falls under: the JSON API, or files (images, OCR). */
export function locKind(url: string): LocKind {
  return /[?&]fo=json\b/.test(url) ? 'json' : 'file'
}

/**
 * GET a loc.gov URL, one request at a time, spaced by the official limits. Throws
 * LocBlockedError without contacting loc.gov while a block is in force.
 */
export function locFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const run = async (): Promise<Response> => {
    const blocked = locBlock()
    if (blocked) throw new LocBlockedError(blocked)
    const kind = locKind(url)
    const wait = last[kind] + LOC_GAP_MS[kind] - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last[kind] = Date.now()
    const res = await fetch(url, { headers: { 'User-Agent': LOC_USER_AGENT }, signal })
    const type = res.headers.get('content-type') ?? ''
    const body =
      res.status === 429 || res.status === 403 || /html/i.test(type) ? await res.clone().text() : ''
    const challenge = isChallenge(res.status, type, body)
    if (challenge) throw new LocBlockedError(startLocBlock(challenge))
    if (!res.ok) throw new Error(`Library of Congress HTTP ${res.status}`)
    return res
  }
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return p
}
