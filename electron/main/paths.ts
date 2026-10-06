import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Folder with python/, remotion/ and scripts/. In a packaged app they ship as extra resources. */
export function appRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

function pointerFile(): string {
  return join(app.getPath('userData'), 'data-dir.json')
}

function defaultDataDir(): string {
  return app.isPackaged
    ? join(app.getPath('documents'), 'Canal Studio')
    : join(app.getAppPath(), 'dados')
}

/**
 * The data folder holds the database, so its location cannot live in the database.
 * CANAL_DATA_DIR wins (used by tests), then the pointer file in userData, then the default.
 */
export function dataDir(): string {
  let dir = process.env.CANAL_DATA_DIR
  if (!dir && existsSync(pointerFile())) {
    try {
      dir = JSON.parse(readFileSync(pointerFile(), 'utf8')).dataDir
    } catch {
      dir = undefined
    }
  }
  dir ??= defaultDataDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export function setDataDir(dir: string): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(pointerFile(), JSON.stringify({ dataDir: dir }, null, 2))
}

export function projectDir(videoId: number): string {
  const dir = join(dataDir(), 'projetos', String(videoId))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function musicDir(): string {
  const dir = join(dataDir(), 'musica')
  mkdirSync(dir, { recursive: true })
  return dir
}
