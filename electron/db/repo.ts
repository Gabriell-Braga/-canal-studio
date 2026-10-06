import { EventEmitter } from 'events'
import type {
  Job,
  JobStatus,
  JobType,
  LogEntry,
  RunMode,
  Scene,
  Script,
  Video,
  VideoPatch,
  VideoStatus
} from '../../shared/types'
import { db, now } from './index'

/** Main-process change feed; the IPC layer forwards it to the UI. */
export const changes = new EventEmitter()
export function notify(topic: 'videos' | 'jobs' | 'logs' | 'settings' | 'channel'): void {
  changes.emit('change', topic)
}

type Row = Record<string, unknown>

function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- videos

function toVideo(r: Row): Video {
  return {
    id: r.id as number,
    topic: r.topic as string,
    niche: (r.niche as string) ?? null,
    status: r.status as VideoStatus,
    title: (r.title as string) ?? null,
    description: (r.description as string) ?? null,
    tags: parse(r.tags, []),
    script: parse<Script | null>(r.script_json, null),
    review_alerts: parse(r.review_json, []),
    duration_target_min: r.duration_target_min as number,
    template: (r.template as string) ?? null,
    audio_path: (r.audio_path as string) ?? null,
    video_path: (r.video_path as string) ?? null,
    thumbnail_paths: parse(r.thumbnail_paths, []),
    chosen_thumbnail: (r.chosen_thumbnail as number) ?? null,
    scheduled_at: (r.scheduled_at as string) ?? null,
    youtube_id: (r.youtube_id as string) ?? null,
    synthetic_content: Boolean(r.synthetic_content),
    error_message: (r.error_message as string) ?? null,
    error_step: (r.error_step as JobType) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string
  }
}

export function listVideos(): Video[] {
  return (db().prepare('SELECT * FROM videos ORDER BY id DESC').all() as Row[]).map(toVideo)
}

export function videosByStatus(status: VideoStatus): Video[] {
  return (
    db().prepare('SELECT * FROM videos WHERE status = ? ORDER BY id').all(status) as Row[]
  ).map(toVideo)
}

export function getVideo(id: number): Video {
  const row = db().prepare('SELECT * FROM videos WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error(`Video ${id} not found`)
  return toVideo(row)
}

export function findVideo(id: number): Video | null {
  const row = db().prepare('SELECT * FROM videos WHERE id = ?').get(id) as Row | undefined
  return row ? toVideo(row) : null
}

export function createVideo(input: {
  topic: string
  niche?: string | null
  durationMin: number
  synthetic: boolean
}): Video {
  const info = db()
    .prepare(
      'INSERT INTO videos (topic, niche, duration_target_min, synthetic_content) VALUES (?, ?, ?, ?)'
    )
    .run(input.topic, input.niche ?? null, input.durationMin, input.synthetic ? 1 : 0)
  notify('videos')
  return getVideo(Number(info.lastInsertRowid))
}

/** Internal columns the pipeline writes; VideoPatch covers what the user can edit. */
export interface VideoFields extends VideoPatch {
  status?: VideoStatus
  audio_path?: string | null
  video_path?: string | null
  thumbnail_paths?: string[]
  youtube_id?: string | null
  error_message?: string | null
  error_step?: JobType | null
  review_alerts?: Video['review_alerts']
  title_options?: string[]
}

const jsonColumns: Record<string, string> = {
  tags: 'tags',
  script: 'script_json',
  review_alerts: 'review_json',
  thumbnail_paths: 'thumbnail_paths',
  title_options: 'title_options'
}

export function updateVideo(id: number, fields: VideoFields): Video {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (key in jsonColumns) {
      sets.push(`${jsonColumns[key]} = ?`)
      values.push(value === null ? null : JSON.stringify(value))
    } else if (key === 'synthetic_content') {
      sets.push('synthetic_content = ?')
      values.push(value ? 1 : 0)
    } else {
      sets.push(`${key} = ?`)
      values.push(value)
    }
  }
  if (sets.length) {
    sets.push('updated_at = ?')
    values.push(now(), id)
    db()
      .prepare(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values)
    notify('videos')
  }
  return getVideo(id)
}

export function setStatus(id: number, status: VideoStatus): Video {
  return updateVideo(id, { status })
}

export function deleteVideo(id: number): void {
  db().prepare('DELETE FROM videos WHERE id = ?').run(id)
  notify('videos')
}

// ---------------------------------------------------------------- scenes

function toScene(r: Row): Scene {
  return {
    id: r.id as number,
    video_id: r.video_id as number,
    index: r.index as number,
    narration: r.narration as string,
    visual_keywords: r.visual_keywords as string,
    image_prompt: r.image_prompt as string,
    asset_type: (r.asset_type as Scene['asset_type']) ?? null,
    asset_path: (r.asset_path as string) ?? null,
    asset_source: (r.asset_source as string) ?? null,
    start_sec: (r.start_sec as number) ?? null,
    end_sec: (r.end_sec as number) ?? null,
    locked: Boolean(r.locked)
  }
}

export function listScenes(videoId: number): Scene[] {
  return (
    db().prepare('SELECT * FROM scenes WHERE video_id = ? ORDER BY "index"').all(videoId) as Row[]
  ).map(toScene)
}

export function getScene(id: number): Scene {
  const row = db().prepare('SELECT * FROM scenes WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error(`Scene ${id} not found`)
  return toScene(row)
}

/** Narration for the whole video: hook, scenes, outro. Hook and outro become their own scenes. */
export function replaceScenes(videoId: number, script: Script): Scene[] {
  const rows = [
    {
      narration: script.hook,
      visual_keywords: script.scenes[0]?.visual_keywords ?? '',
      image_prompt: script.scenes[0]?.image_prompt ?? ''
    },
    ...script.scenes,
    {
      narration: script.outro,
      visual_keywords: script.scenes.at(-1)?.visual_keywords ?? '',
      image_prompt: script.scenes.at(-1)?.image_prompt ?? ''
    }
  ].filter((s) => s.narration.trim())
  const insert = db().prepare(
    'INSERT INTO scenes (video_id, "index", narration, visual_keywords, image_prompt) VALUES (?, ?, ?, ?, ?)'
  )
  db().transaction(() => {
    db().prepare('DELETE FROM scenes WHERE video_id = ?').run(videoId)
    rows.forEach((s, i) =>
      insert.run(videoId, i, s.narration.trim(), s.visual_keywords, s.image_prompt)
    )
  })()
  notify('videos')
  return listScenes(videoId)
}

export function updateScene(
  id: number,
  fields: Partial<Omit<Scene, 'id' | 'video_id' | 'index'>>
): Scene {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    sets.push(`${key} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
  }
  if (sets.length) {
    values.push(id)
    db()
      .prepare(`UPDATE scenes SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values)
    notify('videos')
  }
  return getScene(id)
}

// ---------------------------------------------------------------- jobs

function toJob(r: Row): Job {
  return {
    id: r.id as number,
    video_id: r.video_id as number,
    type: r.type as JobType,
    status: r.status as JobStatus,
    priority: r.priority as number,
    gpu: Boolean(r.gpu),
    run_mode: r.run_mode as RunMode,
    attempts: r.attempts as number,
    max_attempts: r.max_attempts as number,
    run_after: (r.run_after as string) ?? null,
    log: (r.log as string) ?? null,
    created_at: r.created_at as string,
    started_at: (r.started_at as string) ?? null,
    finished_at: (r.finished_at as string) ?? null,
    progress: (r.progress as number) ?? null
  }
}

export const GPU_JOBS: ReadonlySet<JobType> = new Set([
  'script',
  'audio',
  'transcribe',
  'scenes',
  'render',
  'thumbnail',
  'metadata'
])

export function enqueueJob(videoId: number, type: JobType, runMode: RunMode, priority = 0): Job {
  // Never two live jobs of the same type for one video.
  const existing = db()
    .prepare(
      "SELECT * FROM jobs WHERE video_id = ? AND type = ? AND status IN ('pending','running')"
    )
    .get(videoId, type) as Row | undefined
  if (existing) return toJob(existing)
  const info = db()
    .prepare('INSERT INTO jobs (video_id, type, gpu, run_mode, priority) VALUES (?, ?, ?, ?, ?)')
    .run(videoId, type, GPU_JOBS.has(type) ? 1 : 0, runMode, priority)
  notify('jobs')
  return getJob(Number(info.lastInsertRowid))
}

export function getJob(id: number): Job {
  const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error(`Job ${id} not found`)
  return toJob(row)
}

export function jobsByStatus(status: JobStatus, limit = 200): Job[] {
  const order = status === 'pending' ? 'priority DESC, id' : 'id DESC'
  return (
    db()
      .prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY ${order} LIMIT ?`)
      .all(status, limit) as Row[]
  ).map(toJob)
}

export function recentJobs(limit = 30): Job[] {
  return (
    db()
      .prepare(
        "SELECT * FROM jobs WHERE status IN ('done','failed','cancelled') ORDER BY finished_at DESC LIMIT ?"
      )
      .all(limit) as Row[]
  ).map(toJob)
}

export function jobsForVideo(videoId: number): Job[] {
  return (
    db().prepare('SELECT * FROM jobs WHERE video_id = ? ORDER BY id DESC').all(videoId) as Row[]
  ).map(toJob)
}

export function updateJob(
  id: number,
  fields: Partial<
    Pick<
      Job,
      | 'status'
      | 'attempts'
      | 'run_after'
      | 'log'
      | 'started_at'
      | 'finished_at'
      | 'progress'
      | 'run_mode'
    >
  >
): Job {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (entries.length) {
    db()
      .prepare(`UPDATE jobs SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...entries.map(([, v]) => v), id)
    notify('jobs')
  }
  return getJob(id)
}

/** Crash recovery: jobs left `running` by a previous session go back to the queue. */
export function resetRunningJobs(): number {
  const info = db()
    .prepare(
      "UPDATE jobs SET status = 'pending', started_at = NULL, attempts = MAX(attempts - 1, 0) WHERE status = 'running'"
    )
    .run()
  return info.changes
}

export function cancelPendingJobs(videoId: number): void {
  db()
    .prepare(
      "UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE video_id = ? AND status = 'pending'"
    )
    .run(now(), videoId)
  notify('jobs')
}

// ---------------------------------------------------------------- logs

export function addLog(jobId: number | null, level: LogEntry['level'], message: string): void {
  db()
    .prepare('INSERT INTO logs (job_id, level, message) VALUES (?, ?, ?)')
    .run(jobId, level, message)
  notify('logs')
}

export function logsAfter(afterId = 0, limit = 300): LogEntry[] {
  const rows = db()
    .prepare('SELECT * FROM logs WHERE id > ? ORDER BY id DESC LIMIT ?')
    .all(afterId, limit) as LogEntry[]
  return rows.reverse()
}

export function logsForVideo(videoId: number, limit = 200): LogEntry[] {
  const rows = db()
    .prepare(
      'SELECT logs.* FROM logs JOIN jobs ON jobs.id = logs.job_id WHERE jobs.video_id = ? ORDER BY logs.id DESC LIMIT ?'
    )
    .all(videoId, limit) as LogEntry[]
  return rows.reverse()
}
