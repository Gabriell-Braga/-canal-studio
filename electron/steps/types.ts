import type { JobType, Settings, VideoStatus } from '../../shared/types'

export interface StepContext {
  jobId: number
  settings: Settings
  signal: AbortSignal
  /** Data folder for this video: dados/projetos/{id} */
  projectDir: string
  log: (message: string, level?: 'info' | 'warn' | 'error') => void
  progress: (fraction: number) => void
}

/** Every pipeline step has the same shape, so one can be swapped without touching the rest. */
export interface Step {
  type: JobType
  /** Video status shown while the step runs. */
  status: VideoStatus
  run: (videoId: number, ctx: StepContext) => Promise<void>
}
