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
  /** Real person, product or event the scene shows (e.g. "Steve Jobs iPhone keynote 2007"); '' when generic */
  real_subject?: string
  /** Year the scene takes place in; a change of year gets a black year card before the scene */
  year?: number | null
}

/** Company value (market cap, or last private valuation) at a point in time */
export interface CompanyValue {
  year: number
  usd: number
}

/** A company the video is about: its logo and value badge stay on screen */
export interface ScriptCompany {
  name: string
  /** English Wikipedia article, used to find the logo on Wikidata */
  wikipedia_title?: string
  values: CompanyValue[]
}

export interface Script {
  title_options: string[]
  hook: string
  scenes: ScriptScene[]
  outro: string
  /** The hook's punch line, shown big on screen while the hook plays */
  teaser?: string
  /** Stock search for the hook: a real, recognizable image of the subject */
  hook_visual_keywords?: string
  outro_visual_keywords?: string
  /** At most two; empty when the video is not about companies */
  companies?: ScriptCompany[]
  /** Claude checked the companies and gave a value for every year of the script */
  companiesChecked?: boolean
  /** Claude's final edit already ran on this script */
  polished?: boolean
}

export type ReviewAlertKind = 'hook' | 'pacing' | 'repetition' | 'dubious_fact' | 'other'

export interface ReviewAlert {
  kind: ReviewAlertKind
  message: string
  quote?: string
  /** Suggested fix (fact-checked with web search when Claude is the model) */
  correction?: string
  source?: string
}

export type LlmProvider = 'ollama' | 'claude-code' | 'claude-api'

export interface Channel {
  id: number
  name: string
  color: string
  /** YouTube channel picture, downloaded when the channel connects */
  avatar_path: string | null
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
  /** Real person, product or event to find a real photo of first; '' when generic */
  real_subject: string
  asset_type: AssetType | null
  asset_path: string | null
  asset_source: string | null
  /** Attribution line when the license requires one (Wikimedia CC BY). */
  asset_credit: string | null
  start_sec: number | null
  end_sec: number | null
  locked: boolean
  year: number | null
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
  /** Who writes scripts, reviews, titles and picks shorts */
  llmProvider: LlmProvider
  /** Claude model alias: opus | sonnet */
  claudeModel: string
  anthropicApiKey: string
  /** Fact-check scripts with web search (Claude only) */
  factCheckWeb: boolean
  /** Claude (Sonnet) does a short final edit of every script: hook, calm outro, real photos */
  scriptPolish: boolean
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
  /** 'z-image' (Z-Image Turbo, default when installed) or 'sdxl' (the checkpoint above) */
  imageModel: 'z-image' | 'sdxl'
  pexelsApiKey: string
  pixabayApiKey: string
  /** Stock sources tried in this order for each scene (per channel). */
  stockProviders: StockProvider[]
  /** Also use CC BY files from Wikimedia, credited in the video description. */
  wikimediaAllowCcBy: boolean
  /** Also CC BY-SA (most photos of real people and events), credited the same way. */
  wikimediaAllowCcBySa: boolean
  aiImageRatio: number
  /** Burn word-by-word captions into long videos (shorts always have them) */
  captionsEnabled: boolean
  /** Upload the narration subtitles (.srt) to YouTube */
  youtubeCaptions: boolean
  musicVolume: number
  templates: string[]
  publishSlots: PublishSlot[]
  publishTimezone: string
  syntheticDefault: boolean
  /** Channel look for thumbnails and shorts captions */
  brandPrimary: string
  brandSecondary: string
  brandFont: string
  /** Black outline around thumbnail and caption text; off gives a cleaner, modern look */
  brandOutline: boolean
  /** text: headline over the image; highlight: no text, the subject in channel colors over a black and white image; mixed: one highlight, two text */
  thumbStyle: ThumbStyle
  /** Refresh the colors from the YouTube channel picture */
  brandAuto: boolean
  shortsCount: number
  shortsCta: string
  shortsAuto: boolean
  /** Channel intro between the hook and the story */
  introEnabled: boolean
  /** Short line under the channel name, e.g. "Business stories nobody told you" */
  introTagline: string
  /** The narrator reads the tagline during the intro */
  introNarrate: boolean
  googleClientId: string
  googleClientSecret: string
  /** The Google Cloud project passed the YouTube API audit, so uploads can go public */
  youtubeAudited: boolean
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
  'youtubeCaptions',
  'musicVolume',
  'templates',
  'publishSlots',
  'publishTimezone',
  'syntheticDefault',
  'brandPrimary',
  'brandSecondary',
  'brandFont',
  'brandOutline',
  'thumbStyle',
  'brandAuto',
  'shortsCount',
  'shortsCta',
  'shortsAuto',
  'introEnabled',
  'introTagline',
  'introNarrate'
] as const satisfies readonly (keyof Settings)[]

export type ChannelSettingKey = (typeof CHANNEL_SETTING_KEYS)[number]

export type ThumbStyle = 'text' | 'highlight' | 'mixed'

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
  /** Median seconds of recent runs per step, keyed "type:kind" */
  typicalSec: Record<string, number>
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
    /** Colors from the YouTube picture; saved as the channel's brand colors */
    brandFromAvatar: (id: number) => Promise<{ primary: string; secondary: string }>
    /** Render the channel intro alone (with unsaved settings); returns the video file path */
    introPreview: (id: number, patch: Partial<Settings>) => Promise<string>
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
    /** Rewrite the flagged passages using the review alerts */
    fixScript: (id: number) => Promise<Video>
    /** Upload the subtitles and the chosen thumbnail again to a video already on YouTube */
    resendExtras: (id: number) => Promise<{ message: string; level: 'info' | 'warn' | 'error' }[]>
    update: (id: number, patch: VideoPatch) => Promise<Video>
    remove: (id: number) => Promise<void>
    retryFrom: (id: number, step: JobType) => Promise<void>
    approveFinal: (id: number) => Promise<Video>
    rerender: (id: number) => Promise<void>
    generateShorts: (id: number, count: number) => Promise<void>
    shorts: (id: number) => Promise<Video[]>
    rejectFinal: (id: number, fromStep: JobType) => Promise<void>
    /** Publish time to suggest: next free slot, or 30 min after the full video for a short. */
    suggestedSlot: (id: number) => Promise<string>
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
    /** Pending job ids in the new order; the first runs first */
    reorder: (ids: number[]) => Promise<void>
    logs: (afterId?: number) => Promise<LogEntry[]>
  }
  settings: {
    /** With a channel id: shared settings merged with that channel's own. */
    get: (channelId?: number) => Promise<Settings>
    set: (patch: Partial<Settings>, channelId?: number) => Promise<Settings>
    voiceSample: (channelId: number) => Promise<string>
    voices: () => Promise<string[]>
    dataDir: () => Promise<string>
    /** Quick call to the chosen model with unsaved settings; returns a status line */
    testLlm: (patch: Partial<Settings>) => Promise<string>
    chooseDataDir: () => Promise<string | null>
  }
  youtube: {
    connect: (channelId: number) => Promise<StartResult>
    disconnect: (channelId: number) => Promise<void>
    stats: (channelId: number, refresh?: boolean) => Promise<ChannelStats>
  }
  onChanged: (callback: (topic: string) => void) => () => void
}
