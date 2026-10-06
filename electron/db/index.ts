import Database from 'better-sqlite3'

export type DB = Database.Database

let instance: DB | null = null

const migrations: string[] = [
  `
  CREATE TABLE videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    niche TEXT,
    status TEXT NOT NULL DEFAULT 'TOPIC_QUEUED',
    title TEXT,
    title_options TEXT,
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    script_json TEXT,
    review_json TEXT NOT NULL DEFAULT '[]',
    duration_target_min REAL NOT NULL DEFAULT 10,
    template TEXT,
    audio_path TEXT,
    video_path TEXT,
    thumbnail_paths TEXT NOT NULL DEFAULT '[]',
    chosen_thumbnail INTEGER,
    scheduled_at TEXT,
    youtube_id TEXT,
    synthetic_content INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    error_step TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_videos_status ON videos(status);

  CREATE TABLE scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    "index" INTEGER NOT NULL,
    narration TEXT NOT NULL,
    visual_keywords TEXT NOT NULL DEFAULT '',
    image_prompt TEXT NOT NULL DEFAULT '',
    asset_type TEXT,
    asset_path TEXT,
    asset_source TEXT,
    start_sec REAL,
    end_sec REAL,
    locked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_scenes_video ON scenes(video_id, "index");

  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    gpu INTEGER NOT NULL DEFAULT 1,
    run_mode TEXT NOT NULL DEFAULT 'now',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    run_after TEXT,
    log TEXT,
    progress REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX idx_jobs_status ON jobs(status);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_logs_job ON logs(job_id);
  `,
  `
  CREATE TABLE secrets (
    key TEXT PRIMARY KEY,
    value BLOB NOT NULL
  );
  CREATE TABLE analytics (
    video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE quota (
    day TEXT PRIMARY KEY,
    units INTEGER NOT NULL DEFAULT 0
  );
  `
]

function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number
  for (let i = version; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i])
      db.pragma(`user_version = ${i + 1}`)
    })()
  }
}

export function openDb(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  instance = db
  return db
}

export function db(): DB {
  if (!instance) throw new Error('Database not opened')
  return instance
}

export function closeDb(): void {
  instance?.close()
  instance = null
}

export function now(): string {
  return new Date().toISOString()
}
