import type { JobType, Video } from '../shared/types'
import {
  cancelPendingJobs,
  createVideo,
  enqueueJob,
  getVideo,
  listVideos,
  updateVideo,
  videosByStatus
} from './db/repo'
import { getSettings } from './db/settings'
import { nextFreeSlot } from './queue/slots'
import type { Scheduler } from './queue/scheduler'

/** User actions that move a video through the pipeline. Shared by IPC handlers and tests. */
export class Pipeline {
  constructor(private scheduler: Scheduler) {}

  addTopics(topics: string[], durationMin?: number): Video[] {
    const s = getSettings()
    const created = topics
      .map((t) => t.trim())
      .filter(Boolean)
      .map((topic) =>
        createVideo({
          topic,
          niche: s.defaultNiche || null,
          durationMin: durationMin ?? s.defaultDurationMin,
          synthetic: s.syntheticDefault
        })
      )
    return created
  }

  /** Script generation is light; it runs right away, outside the night window. */
  generateScripts(ids?: number[]): number {
    const targets = ids?.length
      ? ids.map(getVideo).filter((v) => v.status === 'TOPIC_QUEUED')
      : videosByStatus('TOPIC_QUEUED')
    for (const v of targets) {
      enqueueJob(v.id, 'script', 'now')
      updateVideo(v.id, { status: 'SCRIPT_GENERATING' })
    }
    this.scheduler.kick()
    return targets.length
  }

  approveScripts(ids: number[]): number {
    let count = 0
    for (const id of ids) {
      const v = getVideo(id)
      if (v.status !== 'SCRIPT_REVIEW') continue
      updateVideo(id, { status: 'PRODUCTION_QUEUED', template: v.template ?? this.pickTemplate() })
      enqueueJob(id, 'audio', 'night')
      count++
    }
    this.scheduler.kick()
    return count
  }

  redoScript(id: number): void {
    cancelPendingJobs(id)
    enqueueJob(id, 'script', 'now')
    updateVideo(id, { status: 'SCRIPT_GENERATING', error_message: null, error_step: null })
    this.scheduler.kick()
  }

  retryFrom(id: number, step: JobType): void {
    cancelPendingJobs(id)
    updateVideo(id, { error_message: null, error_step: null })
    if (step === 'script') return this.redoScript(id)
    enqueueJob(id, step, 'now')
    this.scheduler.kick()
  }

  /** Second human approval. Only here does a video get a publish slot and an upload job. */
  approveFinal(id: number): Video {
    const v = getVideo(id)
    if (v.status !== 'FINAL_REVIEW') throw new Error('O vídeo não está em revisão final')
    if (!v.video_path) throw new Error('O vídeo ainda não foi renderizado')
    const scheduledAt = v.scheduled_at ?? this.nextSlot()
    const updated = updateVideo(id, { status: 'SCHEDULED', scheduled_at: scheduledAt })
    enqueueJob(id, 'upload', 'night')
    this.scheduler.kick()
    return updated
  }

  rejectFinal(id: number, fromStep: JobType): void {
    this.retryFrom(id, fromStep)
  }

  nextSlot(): string {
    const s = getSettings()
    const taken = listVideos()
      .filter((v) => v.scheduled_at && ['SCHEDULED', 'PUBLISHED'].includes(v.status))
      .map((v) => v.scheduled_at as string)
    return nextFreeSlot(s.publishSlots, s.publishTimezone, taken)
  }

  /** Rotate templates so consecutive videos do not look identical. */
  private pickTemplate(): string {
    const templates = getSettings().templates
    const used = listVideos()
      .map((v) => v.template)
      .filter(Boolean)
    const last = used[0]
    const options = templates.filter((t) => t !== last)
    return options[Math.floor(Math.random() * options.length)] ?? templates[0]
  }
}
