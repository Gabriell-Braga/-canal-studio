import type { JobType, Video } from '../shared/types'
import {
  cancelPendingJobs,
  createVideo,
  deleteVideo,
  enqueueJob,
  getVideo,
  listShorts,
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

  addTopics(channelId: number, topics: string[], durationMin?: number): Video[] {
    const s = getSettings(channelId)
    const created = topics
      .map((t) => t.trim())
      .filter(Boolean)
      .map((topic) =>
        createVideo({
          channelId,
          topic,
          niche: s.defaultNiche || null,
          durationMin: durationMin ?? s.defaultDurationMin,
          synthetic: s.syntheticDefault
        })
      )
    return created
  }

  /** Script generation is light; it runs right away, outside the night window. */
  generateScripts(channelId: number, ids?: number[]): number {
    const targets = (ids?.length ? ids.map(getVideo) : videosByStatus('TOPIC_QUEUED')).filter(
      (v) => v.status === 'TOPIC_QUEUED' && v.channel_id === channelId
    )
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
      updateVideo(id, {
        status: 'PRODUCTION_QUEUED',
        template: v.template ?? this.pickTemplate(v.channel_id)
      })
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
    const video = getVideo(id)
    // A failed short is cut again from its full video.
    if (video.kind === 'short') {
      if (!video.parent_id) throw new Error('Short sem vídeo de origem')
      deleteVideo(id)
      return this.generateShorts(video.parent_id, 1)
    }
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
    const scheduledAt =
      v.scheduled_at ?? (v.kind === 'short' ? this.shortSlot(v) : this.nextSlot(v.channel_id))
    const updated = updateVideo(id, { status: 'SCHEDULED', scheduled_at: scheduledAt })
    enqueueJob(id, 'upload', 'night')
    this.scheduler.kick()
    return updated
  }

  rejectFinal(id: number, fromStep: JobType): void {
    this.retryFrom(id, fromStep)
  }

  /** Cut vertical shorts from a rendered video; they land in FINAL_REVIEW on their own. */
  generateShorts(id: number, count: number): void {
    const v = getVideo(id)
    if (v.kind !== 'long') throw new Error('Gere shorts a partir do vídeo longo')
    if (!v.video_path) throw new Error('Renderize o vídeo antes de gerar shorts')
    enqueueJob(id, 'short', 'now', 5, true, { count })
    this.scheduler.kick()
  }

  /**
   * Shorts go out one per day after the full video, at the same time of day, so each one
   * can link to a video that is already public.
   */
  shortSlot(short: Video): string {
    const parent = short.parent_id ? getVideo(short.parent_id) : null
    const base = new Date(parent?.scheduled_at ?? Date.now() + 3600_000)
    const siblings = listShorts(short.parent_id ?? 0).filter(
      (x) => x.id !== short.id && x.scheduled_at
    )
    const taken = new Set(siblings.map((x) => new Date(x.scheduled_at as string).getTime()))
    for (let day = 1; day < 60; day++) {
      const slot = new Date(base.getTime() + day * 24 * 3600_000)
      if (slot.getTime() > Date.now() + 3600_000 && !taken.has(slot.getTime()))
        return slot.toISOString()
    }
    return new Date(Date.now() + 24 * 3600_000).toISOString()
  }

  /** After swapping scenes: render again and come straight back to the final review. */
  rerender(id: number): void {
    cancelPendingJobs(id)
    updateVideo(id, { error_message: null, error_step: null })
    enqueueJob(id, 'render', 'now', 10, false)
    this.scheduler.kick()
  }

  /** Slots are per channel: two channels can publish at the same time. */
  nextSlot(channelId: number): string {
    const s = getSettings(channelId)
    const taken = listVideos(channelId)
      .filter((v) => v.kind === 'long')
      .filter((v) => v.scheduled_at && ['SCHEDULED', 'PUBLISHED'].includes(v.status))
      .map((v) => v.scheduled_at as string)
    return nextFreeSlot(s.publishSlots, s.publishTimezone, taken)
  }

  /** Rotate templates so consecutive videos do not look identical. */
  private pickTemplate(channelId: number): string {
    const templates = getSettings(channelId).templates
    const used = listVideos(channelId)
      .map((v) => v.template)
      .filter(Boolean)
    const last = used[0]
    const options = templates.filter((t) => t !== last)
    return options[Math.floor(Math.random() * options.length)] ?? templates[0]
  }
}
