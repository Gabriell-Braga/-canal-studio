import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/** Folder with python/, remotion/ and scripts/. Packaged (no asar) they live in resources/app. */
export function appRoot(): string {
  if (app.isPackaged) return app.getAppPath()
  // `electron out/main/index.js` reports out/main as the app path; walk up to the project.
  let dir = app.getAppPath()
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) return app.getAppPath()
    dir = parent
  }
  return dir
}

function pointerFile(): string {
  return join(app.getPath('userData'), 'data-dir.json')
}

function defaultDataDir(): string {
  return app.isPackaged ? join(app.getPath('documents'), 'Canal Studio') : join(appRoot(), 'dados')
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

/** Per-channel files (YouTube picture, music of channels other than the first). */
export function channelDir(channelId: number): string {
  const dir = join(dataDir(), 'canais', String(channelId))
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Background music per channel. Channel 1 keeps the original dados/musica folder;
 * other channels get dados/canais/{id}/musica.
 */
export function channelMusicDir(channelId: number): string {
  const dir = channelId === 1 ? musicDir() : join(dataDir(), 'canais', String(channelId), 'musica')
  mkdirSync(dir, { recursive: true })
  return dir
}
