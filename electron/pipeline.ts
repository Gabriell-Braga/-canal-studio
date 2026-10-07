import type { JobType, Video } from '../shared/types'
import {
  cancelPendingJobs,
  createVideo,
  deleteVideo,
  enqueueJob,
  findVideo,
  getVideo,
  listShorts,
  replaceScenes,
  listVideos,
  updateVideo,
  videosByStatus
} from './db/repo'
import { getSettings, getState, setState } from './db/settings'
import { generateStructured } from './services/llm'
import { scriptSchema } from './steps/script'
import { staleShorts } from './steps/shorts'
import { nextFreeSlot, shortSlotAfter } from './queue/slots'
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

  /**
   * Make every video that is not public yet again in the current format (teaser, channel
   * intro, year cards, company badges). Full videos get a new script, which goes back to
   * script review; their shorts are dropped and cut again after the final approval. Copies
   * already uploaded but not public keep their publish time and are replaced on YouTube when
   * the new version is uploaded (see the upload step).
   */
  reprocessAll(): { videos: number; replaced: number } {
    let videos = 0
    let replaced = 0
    for (const v of listVideos()) {
      if (v.kind !== 'long' || v.status === 'PUBLISHED') continue
      if (!v.script && v.status !== 'SCRIPT_GENERATING') continue
      const shorts = listShorts(v.id)
      const oldShortIds = shorts.map((s) => s.youtube_id).filter((id): id is string => !!id)
      for (const s of shorts) {
        cancelPendingJobs(s.id)
        deleteVideo(s.id)
      }
      if (oldShortIds.length) {
        setState(`replaceShorts.${v.id}`, [
          ...getState<string[]>(`replaceShorts.${v.id}`, []),
          ...oldShortIds
        ])
      }
      if (shorts.length) setState(`reshorts.${v.id}`, shorts.length)
      if (v.youtube_id) {
        setState(`replace.${v.id}`, v.youtube_id)
        updateVideo(v.id, { youtube_id: null })
        replaced++
      } else {
        updateVideo(v.id, { scheduled_at: null })
      }
      this.redoScript(v.id)
      videos++
    }
    this.scheduler.kick()
    return { videos, replaced }
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

  /**
   * Second human approval. Only here does a video get a publish slot and an upload job.
   * Approving a full video approves its finished shorts too.
   */
  approveFinal(id: number): Video {
    const v = getVideo(id)
    if (v.status !== 'FINAL_REVIEW') throw new Error('O vídeo não está em revisão final')
    if (!v.video_path) throw new Error('O vídeo ainda não foi renderizado')
    const scheduledAt =
      v.scheduled_at ?? (v.kind === 'short' ? this.shortSlot(v) : this.nextSlot(v.channel_id))
    const updated = updateVideo(id, { status: 'SCHEDULED', scheduled_at: scheduledAt })
    enqueueJob(id, 'upload', 'night')
    if (v.kind === 'long') {
      this.approveShorts(id)
      // Cut only now, so the end card shows the thumbnail picked in the review.
      const s = getSettings(v.channel_id)
      // Shorts dropped when the video was made again are cut again too.
      const recut = getState<number>(`reshorts.${id}`, 0)
      if ((s.shortsAuto || recut) && !listShorts(id).length) {
        enqueueJob(id, 'short', 'night', 0, true, { count: recut || s.shortsCount })
        if (recut) setState(`reshorts.${id}`, 0)
      }
    }
    this.scheduler.kick()
    return updated
  }

  /** Render again the shorts whose end card shows another thumbnail than the picked one. */
  refreshShortThumbs(id: number): void {
    const v = findVideo(id)
    if (!v || v.kind !== 'long' || !staleShorts(v).length) return
    enqueueJob(id, 'short', 'now', 5, true, { refresh: true })
    this.scheduler.kick()
  }

  refreshAllShortThumbs(): void {
    for (const v of listVideos()) {
      if (v.kind === 'long' && v.thumbnail_paths.length) this.refreshShortThumbs(v.id)
    }
  }

  /**
   * Shorts follow their full video: once it is approved, every finished short is approved
   * with it. Runs on approval, when shorts finish and at startup (shorts cut before this rule).
   */
  approveShorts(parentId: number): void {
    const parent = findVideo(parentId)
    if (!parent || !['SCHEDULED', 'PUBLISHED'].includes(parent.status)) return
    for (const short of listShorts(parentId)) {
      if (short.status === 'FINAL_REVIEW' && short.video_path) this.approveFinal(short.id)
    }
  }

  approveAllShorts(): void {
    for (const v of [...videosByStatus('SCHEDULED'), ...videosByStatus('PUBLISHED')]) {
      if (v.kind === 'long') this.approveShorts(v.id)
    }
  }

  rejectFinal(id: number, fromStep: JobType): void {
    this.retryFrom(id, fromStep)
  }

  /**
   * Rewrite the passages the review flagged (facts, hook, pacing) and keep the rest.
   * Runs right away; with the local model it waits for the GPU to be free.
   */
  async fixScript(id: number): Promise<Video> {
    const v = getVideo(id)
    if (!v.script) throw new Error('Vídeo sem roteiro')
    if (!v.review_alerts.length) throw new Error('Nenhum alerta para corrigir')
    const s = getSettings(v.channel_id)
    if (s.llmProvider === 'ollama' && this.scheduler.gpuBusy()) {
      throw new Error('A GPU está ocupada com a fila. Pause a fila ou espere terminar.')
    }
    const alerts = v.review_alerts
      .map(
        (a, i) =>
          `${i + 1}. [${a.kind}] ${a.message}${a.quote ? `\n   Phrase: "${a.quote}"` : ''}${
            a.correction ? `\n   Suggested correction: ${a.correction}` : ''
          }${a.source ? `\n   Source: ${a.source}` : ''}`
      )
      .join('\n')
    const fixed = await generateStructured(
      `Here is a YouTube documentary script as JSON and the editor's review alerts.
Rewrite the script fixing every alert: correct or soften wrong and unverifiable facts, strengthen the hook if flagged, fix pacing and repetition. Keep everything else, the scene structure and the length about the same. Keep visual_keywords, real_subject and image_prompt unless the scene's content changed.

ALERTS:
${alerts}

SCRIPT JSON:
${JSON.stringify(v.script)}`,
      scriptSchema,
      { settings: s, effort: 'high', webSearch: s.llmProvider !== 'ollama' && s.factCheckWeb }
    )
    replaceScenes(id, fixed)
    return updateVideo(id, {
      script: { ...fixed, polished: v.script.polished },
      title_options: fixed.title_options,
      review_alerts: [
        {
          kind: 'other',
          message: `${v.review_alerts.length} alerta(s) corrigido(s) pela IA. Releia o roteiro antes de aprovar.`
        }
      ]
    })
  }

  /** Cut vertical shorts from a rendered video; they land in FINAL_REVIEW on their own. */
  generateShorts(id: number, count: number): void {
    const v = getVideo(id)
    if (v.kind !== 'long') throw new Error('Gere shorts a partir do vídeo longo')
    if (!v.video_path) throw new Error('Renderize o vídeo antes de gerar shorts')
    enqueueJob(id, 'short', 'now', 5, true, { count })
    this.scheduler.kick()
  }

  /** Publish time of a short, anchored on its full video (see shortSlotAfter). */
  shortSlot(short: Video): string {
    const parent = short.parent_id ? getVideo(short.parent_id) : null
    // A full video not approved yet will take the channel's next free slot.
    const parentAt = parent?.scheduled_at ?? this.nextSlot(short.channel_id)
    const taken = listShorts(short.parent_id ?? 0)
      .filter((x) => x.id !== short.id && x.scheduled_at)
      .map((x) => x.scheduled_at as string)
    return shortSlotAfter(parentAt, taken)
  }

  /** What the publish form suggests before the video has its own time. */
  suggestedSlot(id: number): string {
    const v = getVideo(id)
    return v.kind === 'short' ? this.shortSlot(v) : this.nextSlot(v.channel_id)
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
