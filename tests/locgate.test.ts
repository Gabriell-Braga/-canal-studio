import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ocrToWords } from '../electron/services/adscan'
import {
  configureLocGate,
  isChallenge,
  LOC_LOCKOUT_MS,
  LocBlockedError,
  locBlock,
  locFetch,
  locKind
} from '../electron/services/locgate'

const CHALLENGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>
<script src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/orchestrate"></script>`

describe('loc.gov gate', () => {
  beforeEach(() => {
    configureLocGate({
      stateFile: join(mkdtempSync(join(tmpdir(), 'loc-gate-')), 'block.json'),
      log: () => undefined
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('recognizes challenge pages, 429 and 403', () => {
    expect(isChallenge(200, 'text/html; charset=UTF-8', CHALLENGE)).toBe('página de desafio')
    expect(isChallenge(200, 'text/html', '<p>Please complete the CAPTCHA</p>')).toBe(
      'página de desafio'
    )
    expect(isChallenge(429, 'text/plain', '')).toBe('HTTP 429')
    expect(isChallenge(403, 'text/html', '')).toBe('HTTP 403')
    expect(isChallenge(200, 'application/json', '{"results":[]}')).toBeNull()
    expect(isChallenge(200, 'text/html', '<html><body>Search results</body></html>')).toBeNull()
  })

  it('applies the JSON limit to API searches and the file limit to the rest', () => {
    expect(locKind('https://www.loc.gov/collections/chronicling-america/?q=x&fo=json')).toBe('json')
    expect(locKind('https://tile.loc.gov/storage-services/x/0001.xml')).toBe('file')
  })

  it('after a 429 stops every request for 65 minutes, without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response('slow down', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    const before = Date.now()
    await expect(locFetch('https://www.loc.gov/a?fo=json')).rejects.toBeInstanceOf(LocBlockedError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const block = locBlock()
    expect(block?.reason).toBe('HTTP 429')
    const span = Date.parse(block?.until ?? '') - before
    expect(span).toBeGreaterThanOrEqual(LOC_LOCKOUT_MS - 1000)
    expect(span).toBeLessThanOrEqual(LOC_LOCKOUT_MS + 1000)
    // Inside the block: no request leaves the app.
    await expect(locFetch('https://tile.loc.gov/b.jpg')).rejects.toBeInstanceOf(LocBlockedError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // And the block is over 65 minutes later.
    expect(locBlock(Date.now() + LOC_LOCKOUT_MS + 1000)).toBeNull()
  })

  it('treats a 200 challenge page as a block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(CHALLENGE, { status: 200, headers: { 'content-type': 'text/html' } })
      )
    )
    await expect(locFetch('https://www.loc.gov/a?fo=json')).rejects.toBeInstanceOf(LocBlockedError)
    expect(locBlock()?.reason).toBe('página de desafio')
  })
})

describe('local OCR to word boxes', () => {
  it('keeps ALTO-like 0–1 boxes and joins the text in reading order', () => {
    const r = ocrToWords({
      confidence: 92.5,
      words: [
        { text: 'MAKES', conf: 99, x: 0.13, y: 0.2, w: 0.22, h: 0.06 },
        { text: ' ', conf: 10, x: 0, y: 0, w: 0, h: 0 },
        { text: 'CHILDREN', conf: 98, x: 0.14, y: 0.23, w: 0.27, h: 0.07 }
      ]
    })
    expect(r.text).toBe('MAKES CHILDREN')
    expect(r.words[1]).toEqual({ text: 'CHILDREN', x: 0.14, y: 0.23, w: 0.27, h: 0.07 })
    expect(r.confidence).toBe(92.5)
  })
})
