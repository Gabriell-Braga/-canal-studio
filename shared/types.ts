export type ServiceId =
  | 'node'
  | 'python'
  | 'git'
  | 'ffmpeg'
  | 'gpu'
  | 'ollama'
  | 'ollamaModel'
  | 'comfyui'
  | 'pythonServer'
  | 'espeak'

export type ServiceState = 'ok' | 'warning' | 'missing'

export interface ServiceStatus {
  id: ServiceId
  name: string
  state: ServiceState
  version?: string
  detail?: string
  hint?: string
  canStart?: boolean
  canInstall?: boolean
}

export interface StartResult {
  ok: boolean
  message: string
}

export const VIDEO_STATUSES = [
  'TOPIC_QUEUED',
  'SCRIPT_GENERATING',
  'SCRIPT_REVIEW',
  'PRODUCTION_QUEUED',
  'AUDIO',
  'SCENES',
  'RENDERING',
  'THUMBNAIL',
  'FINAL_REVIEW',
  'SCHEDULED',
  'PUBLISHED',
  'ERROR'
] as const

export type VideoStatus = (typeof VIDEO_STATUSES)[number]

export const STATUS_LABELS: Record<VideoStatus, string> = {
  TOPIC_QUEUED: 'Temas',
  SCRIPT_GENERATING: 'Gerando roteiro',
  SCRIPT_REVIEW: 'Revisar roteiro',
  PRODUCTION_QUEUED: 'Na fila de produção',
  AUDIO: 'Áudio',
  SCENES: 'Cenas',
  RENDERING: 'Renderizando',
  THUMBNAIL: 'Thumbnail',
  FINAL_REVIEW: 'Revisão final',
  SCHEDULED: 'Agendado',
  PUBLISHED: 'Publicado',
  ERROR: 'Erro'
}

export const JOB_TYPES = [
  'script',
  'audio',
  'transcribe',
  'scenes',
  'render',
  'thumbnail',
  'metadata',
  'upload',
  'short'
] as const

export type JobType = (typeof JOB_TYPES)[number]

export const JOB_LABELS: Record<JobType, string> = {
  script: 'Roteiro',
  audio: 'Áudio',
  transcribe: 'Transcrição',
  scenes: 'Cenas',
  render: 'Render',
  thumbnail: 'Thumbnail',
  metadata: 'Metadados',
  upload: 'Upload',
  short: 'Shorts'
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
export type RunMode = 'now' | 'night'
export type AssetType = 'stock_video' | 'stock_photo' | 'ai_image' | 'ai_video'

export interface ScriptScene {
  narration: string
  visual_keywords: string
  image_prompt: string
}

export interface Script {
  title_options: string[]
  hook: string
  scenes: ScriptScene[]
  outro: string
}

export type ReviewAlertKind = 'hook' | 'pacing' | 'repetition' | 'dubious_fact' | 'other'

export interface ReviewAlert {
  kind: ReviewAlertKind
  message: string
  quote?: string
}

export interface Channel {
  id: number
  name: string
  color: string
  created_at: string
}

export interface ChannelSummary extends Channel {
  videos: number
  scriptReview: number
  finalReview: number
  errors: number
  scheduled: number
  youtubeTitle: string | null
}

export type VideoKind = 'long' | 'short'

export interface Video {
  id: number
  channel_id: number
  /** 'short': a vertical cut of another video (parent_id) that recommends it at the end. */
  kind: VideoKind
  parent_id: number | null
  short_start: number | null
  short_end: number | null
  topic: string
  niche: string | null
  status: VideoStatus
  title: string | null
  description: string | null
  tags: string[]
  script: Script | null
  review_alerts: ReviewAlert[]
  duration_target_min: number
  template: string | null
  audio_path: string | null
  video_path: string | null
  thumbnail_paths: string[]
  chosen_thumbnail: number | null
  scheduled_at: string | null
  youtube_id: string | null
  synthetic_content: boolean
  error_message: string | null
  error_step: JobType | null
  created_at: string
  updated_at: string
}

export interface Scene {
  id: number
  video_id: number
  index: number
  narration: string
  visual_keywords: string
  image_prompt: string
  asset_type: AssetType | null
  asset_path: string | null
  asset_source: string | null
  /** Attribution line when the license requires one (Wikimedia CC BY). */
  asset_credit: string | null
  start_sec: number | null
  end_sec: number | null
  locked: boolean
}

export interface Job {
  id: number
  video_id: number
  type: JobType
  status: JobStatus
  priority: number
  gpu: boolean
  run_mode: RunMode
  attempts: number
  max_attempts: number
  run_after: string | null
  log: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  progress: number | null
  /** false: stop after this step instead of queueing the next one */
  chain: boolean
  /** Step options, e.g. { count: 2 } for shorts */
  args: Record<string, unknown> | null
}

export interface LogEntry {
  id: number
  job_id: number | null
  level: 'info' | 'warn' | 'error'
  message: string
  created_at: string
}

export interface PublishSlot {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  /** HH:MM */
  time: string
}

export type StockProvider = 'pixabay' | 'pexels' | 'wikimedia' | 'nasa' | 'met' | 'archive'

export interface Settings {
  ollamaUrl: string
  ollamaModel: string
  scriptPrompt: string
  reviewPrompt: string
  defaultDurationMin: number
  defaultNiche: string
  nightStart: string
  nightEnd: string
  maxVideosPerNight: number
  voice: string
  voiceSpeed: number
  scenePauseSec: number
  whisperModel: string
  whisperDevice: 'auto' | 'cuda' | 'cpu'
  comfyUrl: string
  comfyPath: string
  comfyCheckpoint: string
  pexelsApiKey: string
  pixabayApiKey: string
  /** Stock sources tried in this order for each scene (per channel). */
  stockProviders: StockProvider[]
  /** Also use CC BY files from Wikimedia, credited in the video description. */
  wikimediaAllowCcBy: boolean
  aiImageRatio: number
  captionsEnabled: boolean
  musicVolume: number
  templates: string[]
  publishSlots: PublishSlot[]
  publishTimezone: string
  syntheticDefault: boolean
  shortsCount: number
  shortsCta: string
  shortsAuto: boolean
  googleClientId: string
  googleClientSecret: string
  startWithWindows: boolean
  minimizeToTray: boolean
}

/** Settings each channel keeps for itself; everything else is shared by the whole app. */
export const CHANNEL_SETTING_KEYS = [
  'scriptPrompt',
  'reviewPrompt',
  'defaultDurationMin',
  'defaultNiche',
  'voice',
  'voiceSpeed',
  'scenePauseSec',
  'aiImageRatio',
  'stockProviders',
  'captionsEnabled',
  'musicVolume',
  'templates',
  'publishSlots',
  'publishTimezone',
  'syntheticDefault',
  'shortsCount',
  'shortsCta',
  'shortsAuto'
] as const satisfies readonly (keyof Settings)[]

export type ChannelSettingKey = (typeof CHANNEL_SETTING_KEYS)[number]

export interface QueueState {
  paused: boolean
  forceRun: boolean
  inNightWindow: boolean
  nightWindow: string
  videosStartedTonight: number
  maxVideosPerNight: number
  running: Job[]
  pending: Job[]
  recent: Job[]
  vram: { used: number; total: number } | null
}

export interface ChannelStats {
  connected: boolean
  channelTitle?: string
  quotaUsedToday: number
  quotaLimit: number
  videos: {
    video_id: number
    youtube_id: string
    title: string
    views: number
    watchMinutes: number
    avgViewDurationSec: number
    impressionsCtr: number | null
    subscribersGained: number
  }[]
  updatedAt: string | null
  error?: string
}

export type VideoPatch = Partial<
  Pick<
    Video,
    | 'title'
    | 'description'
    | 'tags'
    | 'script'
    | 'scheduled_at'
    | 'synthetic_content'
    | 'chosen_thumbnail'
    | 'template'
    | 'niche'
    | 'duration_target_min'
  >
>

export interface VideoDetail {
  video: Video
  scenes: Scene[]
  jobs: Job[]
  logs: LogEntry[]
}

export interface Api {
  channels: {
    list: () => Promise<ChannelSummary[]>
    create: (input: { name: string; color: string; copyFromId?: number | null }) => Promise<Channel>
    update: (id: number, patch: { name?: string; color?: string }) => Promise<Channel>
    remove: (id: number) => Promise<void>
    musicDir: (id: number) => Promise<string>
    openMusicDir: (id: number) => Promise<void>
  }
  services: {
    check: () => Promise<ServiceStatus[]>
    start: (id: string) => Promise<StartResult>
    install: (id: string) => Promise<StartResult>
  }
  videos: {
    list: (channelId?: number) => Promise<Video[]>
    get: (id: number) => Promise<VideoDetail | null>
    addTopics: (channelId: number, topics: string[], durationMin?: number) => Promise<Video[]>
    generateScripts: (channelId: number, ids?: number[]) => Promise<number>
    approveScripts: (ids: number[]) => Promise<number>
    redoScript: (id: number) => Promise<void>
    update: (id: number, patch: VideoPatch) => Promise<Video>
    remove: (id: number) => Promise<void>
    retryFrom: (id: number, step: JobType) => Promise<void>
    approveFinal: (id: number) => Promise<Video>
    rerender: (id: number) => Promise<void>
    generateShorts: (id: number, count: number) => Promise<void>
    shorts: (id: number) => Promise<Video[]>
    rejectFinal: (id: number, fromStep: JobType) => Promise<void>
    nextSlot: (channelId: number) => Promise<string>
  }
  scenes: {
    update: (
      id: number,
      patch: Partial<Pick<Scene, 'narration' | 'visual_keywords' | 'image_prompt'>>
    ) => Promise<Scene>
    nextStock: (id: number) => Promise<Scene>
    generateAi: (id: number) => Promise<Scene>
    pickFile: (id: number) => Promise<Scene | null>
    unlock: (id: number) => Promise<Scene>
  }
  queue: {
    state: () => Promise<QueueState>
    runNow: () => Promise<void>
    pause: () => Promise<void>
    resume: () => Promise<void>
    cancelJob: (id: number) => Promise<void>
    logs: (afterId?: number) => Promise<LogEntry[]>
  }
  settings: {
    /** With a channel id: shared settings merged with that channel's own. */
    get: (channelId?: number) => Promise<Settings>
    set: (patch: Partial<Settings>, channelId?: number) => Promise<Settings>
    voiceSample: (channelId: number) => Promise<string>
    voices: () => Promise<string[]>
    dataDir: () => Promise<string>
    chooseDataDir: () => Promise<string | null>
  }
  youtube: {
    connect: (channelId: number) => Promise<StartResult>
    disconnect: (channelId: number) => Promise<void>
    stats: (channelId: number, refresh?: boolean) => Promise<ChannelStats>
  }
  onChanged: (callback: (topic: string) => void) => () => void
}
