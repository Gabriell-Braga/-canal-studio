import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, migrate, openDb } from '../electron/db'
import { createChannel, createVideo, listChannels, listVideos } from '../electron/db/repo'
import { copyChannelSettings, getSettings, setSettings } from '../electron/db/settings'
import { freshDb } from './helpers'

describe('channels', () => {
  beforeEach(() => {
    freshDb()
  })

  it('keeps channel settings apart and shares the global ones', () => {
    const b = createChannel('History B', '#ff8800')
    copyChannelSettings(1, b.id)
    setSettings({ voice: 'bf_emma', nightStart: '02:00' }, b.id)
    expect(getSettings(b.id).voice).toBe('bf_emma')
    expect(getSettings(1).voice).toBe('am_michael')
    // nightStart is shared: setting it from channel B changes it for everyone.
    expect(getSettings(1).nightStart).toBe('02:00')
  })

  it('lists videos per channel', () => {
    const b = createChannel('B', '#fff')
    createVideo({ channelId: 1, topic: 'one', durationMin: 1, synthetic: true })
    createVideo({ channelId: b.id, topic: 'two', durationMin: 1, synthetic: true })
    expect(listVideos(1).map((v) => v.topic)).toEqual(['one'])
    expect(listVideos(b.id).map((v) => v.topic)).toEqual(['two'])
    expect(listVideos()).toHaveLength(2)
  })
})

describe('migration to multi-channel', () => {
  it('moves an existing single-channel database into channel 1 without losing settings', () => {
    closeDb()
    const file = join(mkdtempSync(join(tmpdir(), 'canal-mig-')), 'old.db')
    // Build a version-3 database: what the app had before multi-channel support.
    const raw = new Database(file)
    migrate(raw, 3)
    raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('voice', '"bm_george"')
    raw
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('ollamaModel', '"gemma3:12b"')
    raw.prepare("INSERT INTO videos (topic) VALUES ('old video')").run()
    raw.pragma('user_version = 3')
    raw.close()

    openDb(file)
    expect(listChannels().map((c) => c.name)).toEqual(['Canal principal'])
    expect(listVideos(1).map((v) => v.topic)).toEqual(['old video'])
    expect(getSettings(1).voice).toBe('bm_george')
    expect(getSettings(1).ollamaModel).toBe('gemma3:12b')
  })
})
