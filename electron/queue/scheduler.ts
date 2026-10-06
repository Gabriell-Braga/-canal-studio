import type { Job, JobType, QueueState } from '../../shared/types'
import { now } from '../db'
import {
  addLog,
  enqueueJob,
  findVideo,
  getJob,
  jobsByStatus,
  recentJobs,
  resetRunningJobs,
  updateJob,
  updateVideo,
  videosByStatus
} from '../db/repo'
import { getSettings, getState, setState } from '../db/settings'
import type { Step } from '../steps/types'
import { backoffMs, inWindow, windowKey } from './window'

export type QueueEvent =
  | { type: 'scripts-ready'; count: number }
  | { type: 'final-ready'; videoId: number; title: string }
  | { type: 'error'; videoId: number; message: string }
  | { type: 'night-summary'; finalReady: number; errors: number }

export interface SchedulerOptions {
  steps: Partial<Record<JobType, Step>>
  projectDir: (videoId: number) => string
  onBusyChange?: (busy: boolean) => void
  onEvent?: (event: QueueEvent) => void
  getVram?: () => Promise<{ used: number; total: number } | null>
  clock?: () => Date
  tickMs?: number
}

/** Steps whose output feeds the next one, in production order. */
const NEXT: Partial<Record<JobType, JobType>> = {
  audio: 'transcribe',
  transcribe: 'scenes',
  scenes: 'render',
  render: 'thumbnail',
  thumbnail: 'metadata'
}

const MAX_CPU_JOBS = 2

export class Scheduler {
  private running = new Map<number, AbortController>()
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private wasInWindow: boolean | null = null
  private busy = false

  constructor(private opts: SchedulerOptions) {}

  private clock(): Date {
    return this.opts.clock?.() ?? new Date()
  }

  start(): void {
    const recovered = resetRunningJobs()
    if (recovered)
      addLog(null, 'warn', `${recovered} tarefa(s) interrompida(s) voltaram para a fila`)
    this.timer = setInterval(() => this.tick(), this.opts.tickMs ?? 5000)
    this.kick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const controller of this.running.values()) controller.abort()
  }

  /** Check the queue now instead of waiting for the next tick. */
  kick(): void {
    setImmediate(() => this.tick())
  }

  get paused(): boolean {
    return getState('paused', false)
  }

  pause(): void {
    setState('paused', true)
    addLog(null, 'info', 'Fila pausada')
  }

  resume(): void {
    setState('paused', false)
    addLog(null, 'info', 'Fila retomada')
    this.kick()
  }

  /** "Rodar agora": ignore the night window and nightly limit until the queue drains. */
  runNow(): void {
    setState('forceRun', true)
    setState('paused', false)
    addLog(null, 'info', 'Rodar agora: janela noturna ignorada até a fila esvaziar')
    this.kick()
  }

  cancel(jobId: number): void {
    const controller = this.running.get(jobId)
    if (controller) controller.abort()
    else {
      const job = getJob(jobId)
      if (job.status === 'pending') {
        updateJob(jobId, { status: 'cancelled', finished_at: now() })
      }
    }
  }

  async state(): Promise<QueueState> {
    const s = getSettings()
    const date = this.clock()
    const night = getState<{ key: string; videoIds: number[] }>('night', { key: '', videoIds: [] })
    return {
      paused: this.paused,
      forceRun: getState('forceRun', false),
      inNightWindow: inWindow(date, s.nightStart, s.nightEnd),
      nightWindow: `${s.nightStart}–${s.nightEnd}`,
      videosStartedTonight:
        night.key === windowKey(date, s.nightStart, s.nightEnd) ? night.videoIds.length : 0,
      maxVideosPerNight: s.maxVideosPerNight,
      running: jobsByStatus('running'),
      pending: jobsByStatus('pending'),
      recent: recentJobs(),
      vram: (await this.opts.getVram?.()) ?? null
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      this.checkWindowTransition()
      this.markPublished()
      if (!this.paused) this.startEligible()
      this.setBusy(this.running.size > 0)
    } catch (error) {
      addLog(null, 'error', `Erro no agendador: ${(error as Error).message}`)
    } finally {
      this.ticking = false
    }
  }

  private setBusy(busy: boolean): void {
    if (busy !== this.busy) {
      this.busy = busy
      this.opts.onBusyChange?.(busy)
    }
  }

  private checkWindowTransition(): void {
    const s = getSettings()
    const inside = inWindow(this.clock(), s.nightStart, s.nightEnd)
    if (this.wasInWindow === true && !inside) {
      this.opts.onEvent?.({
        type: 'night-summary',
        finalReady: videosByStatus('FINAL_REVIEW').length,
        errors: videosByStatus('ERROR').length
      })
    }
    this.wasInWindow = inside
  }

  private markPublished(): void {
    const date = this.clock().toISOString()
    for (const v of videosByStatus('SCHEDULED')) {
      if (v.youtube_id && v.scheduled_at && v.scheduled_at <= date) {
        updateVideo(v.id, { status: 'PUBLISHED' })
      }
    }
  }

  private startEligible(): void {
    const s = getSettings()
    const date = this.clock()
    const forceRun = getState('forceRun', false)
    const nightOpen = inWindow(date, s.nightStart, s.nightEnd)
    const pending = jobsByStatus('pending')

    if (forceRun && pending.length === 0 && this.running.size === 0) {
      setState('forceRun', false)
    }

    const runningJobs = [...this.running.keys()].map(getJob)
    let gpuBusy = runningJobs.some((j) => j.gpu)
    let cpuCount = runningJobs.filter((j) => !j.gpu).length

    for (const job of pending) {
      if (job.run_after && job.run_after > date.toISOString()) continue
      if (job.run_mode === 'night' && !nightOpen && !forceRun) continue
      if (job.gpu ? gpuBusy : cpuCount >= MAX_CPU_JOBS) continue
      if (job.run_mode === 'night' && !forceRun && !this.claimNightSlot(job, s.maxVideosPerNight)) {
        continue
      }
      const step = this.opts.steps[job.type]
      if (!step) continue
      if (job.gpu) gpuBusy = true
      else cpuCount++
      void this.runJob(job, step)
    }
  }

  /** A video counts against the nightly limit when its first production step starts. */
  private claimNightSlot(job: Job, max: number): boolean {
    if (job.type !== 'audio') return true
    const s = getSettings()
    const key = windowKey(this.clock(), s.nightStart, s.nightEnd)
    let night = getState<{ key: string; videoIds: number[] }>('night', { key, videoIds: [] })
    if (night.key !== key) night = { key, videoIds: [] }
    if (night.videoIds.includes(job.video_id)) return true
    if (night.videoIds.length >= max) return false
    night.videoIds.push(job.video_id)
    setState('night', night)
    return true
  }

  private async runJob(job: Job, step: Step): Promise<void> {
    const controller = new AbortController()
    this.running.set(job.id, controller)
    this.setBusy(true)
    const attempt = job.attempts + 1
    updateJob(job.id, { status: 'running', started_at: now(), attempts: attempt, progress: 0 })
    if (step.status !== 'SCHEDULED') {
      updateVideo(job.video_id, { status: step.status, error_message: null, error_step: null })
    }
    const log = (message: string, level: 'info' | 'warn' | 'error' = 'info'): void =>
      addLog(job.id, level, message)
    log(`Início: ${job.type} (tentativa ${attempt}/${job.max_attempts})`)

    try {
      const video = findVideo(job.video_id)
      if (!video) throw new Error('Vídeo removido')
      await step.run(job.video_id, {
        jobId: job.id,
        settings: getSettings(),
        signal: controller.signal,
        projectDir: this.opts.projectDir(job.video_id),
        log,
        progress: (p) => updateJob(job.id, { progress: Math.max(0, Math.min(1, p)) })
      })
      if (controller.signal.aborted) throw new Error('Cancelado')
      updateJob(job.id, { status: 'done', finished_at: now(), progress: 1 })
      log(`Concluído: ${job.type}`)
      this.advance(job)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (controller.signal.aborted) {
        updateJob(job.id, { status: 'cancelled', finished_at: now() })
        log('Cancelado pelo usuário', 'warn')
        updateVideo(job.video_id, {
          status: 'ERROR',
          error_message: 'Etapa cancelada',
          error_step: job.type
        })
      } else if (attempt < job.max_attempts) {
        const retryAt = new Date(this.clock().getTime() + backoffMs(attempt))
        updateJob(job.id, { status: 'pending', run_after: retryAt.toISOString() })
        log(`Falhou: ${message}. Nova tentativa às ${retryAt.toLocaleTimeString('pt-BR')}`, 'warn')
      } else {
        updateJob(job.id, { status: 'failed', finished_at: now(), log: message })
        log(`Falhou de vez: ${message}`, 'error')
        updateVideo(job.video_id, {
          status: 'ERROR',
          error_message: message,
          error_step: job.type
        })
        this.opts.onEvent?.({ type: 'error', videoId: job.video_id, message })
      }
    } finally {
      this.running.delete(job.id)
      this.kick()
    }
  }

  private advance(job: Job): void {
    const video = findVideo(job.video_id)
    if (!video) return
    if (job.type === 'script') {
      updateVideo(video.id, { status: 'SCRIPT_REVIEW' })
      const stillGenerating = jobsByStatus('pending').some((j) => j.type === 'script')
      if (!stillGenerating) {
        this.opts.onEvent?.({
          type: 'scripts-ready',
          count: videosByStatus('SCRIPT_REVIEW').length
        })
      }
      return
    }
    if (job.type === 'metadata') {
      updateVideo(video.id, { status: 'FINAL_REVIEW' })
      this.opts.onEvent?.({
        type: 'final-ready',
        videoId: video.id,
        title: video.title ?? video.topic
      })
      return
    }
    if (job.type === 'upload') {
      return
    }
    const next = NEXT[job.type]
    if (next) enqueueJob(video.id, next, job.run_mode)
  }
}
