import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { closeDb, openDb } from '../electron/db'

export function freshDb(): string {
  closeDb()
  const dir = mkdtempSync(join(tmpdir(), 'canal-test-'))
  openDb(join(dir, 'test.db'))
  return dir
}

export function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (cond()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'))
      setTimeout(check, 20)
    }
    check()
  })
}
