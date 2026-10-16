import type { JobType, Video } from '../shared/types'
import type { ThumbBriefReport } from '../shared/thumb'
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
import { formatOf, scriptSchemaFor } from '../shared/formats'
import { perfPromptBlock } from './services/youtube'
import { checklistMissing } from '../shared/checklist'
import type { AdPage } from './services/chroniclingamerica'
import { findAdPages, withOcr } from './services/commonsads'
import {
  attachEvidence,
  manualEvidence,
  rememberTopicEvidence,
  setVideoEvidence,
  type ManualAd
} from './steps/evidence'
import { polishSettings } from './steps/polish'
import { z } from 'zod'
import { staleShorts } from './steps/shorts'
import { nextFreeSlot, shortSlotAfter } from './queue/slots'
import type { Scheduler } from './queue/scheduler'

/** User actions that move a video through the pipeline. Shared by IPC handlers and tests. */
export class Pipeline {
  constructor(private scheduler: Scheduler) {}

  /**
   * Ten topic ideas for the channel: little-told stories or a specific angle on a famous
   * company, never one already on the channel or a saturated story told the usual way.
   */
  async suggestTopics(channelId: number): Promise<string[]> {
    const s = getSettings(channelId)
    const done = listVideos()
      .filter((v) => v.channel_id === channelId && v.kind === 'long')
      .map((v) => v.title ?? v.topic)
    const pack = formatOf(s.format)
    const src = pack.topicSource
    if (src.kind !== 'llm' && src.queries?.length) {
      const found = await this.topicsFromAds(channelId, done).catch((error: Error) => {
        console.warn(`Busca de anúncios reais falhou: ${error.message}`)
        return []
      })
      if (found.length) return found
    }
    const { topics } = await generateStructured(
      `You pick topics for a faceless YouTube channel. Format: ${src.brief}${s.defaultNiche ? `\nNiche: ${s.defaultNiche}` : ''}
Already on the channel (do not repeat these stories): ${done.join(' | ') || 'none'}
Saturated stories big channels already told to millions (avoid them, or use them only through a specific angle almost nobody covers): ${pack.saturatedTopics.join(', ')}
${perfPromptBlock(channelId)}
Give 10 topics.
Write each topic as a short English working title with the hook in it (max 80 characters)${src.examples.length ? `, e.g. ${src.examples.map((e) => `"${e}"`).join(', ')}` : ''}.
Return ONLY JSON: {"topics": ["...", ...]}`,
      z.object({ topics: z.array(z.string().min(1)).min(1).max(15) }),
      { settings: { ...polishSettings(s), claudeModel: 'opus' }, temperature: 1, effort: 'medium' }
    )
    return topics.map((t) => t.replace(/^["']|["']$/g, '').trim()).filter(Boolean)
  }

  /**
   * Topics born from real ads: search the newspaper archive with the format's terms, show the
   * model what was found (OCR text) and keep each topic's page as its evidence.
   */
  private async topicsFromAds(channelId: number, done: string[]): Promise<string[]> {
    const s = getSettings(channelId)
    const pack = formatOf(s.format)
    const queries = [...(pack.topicSource.queries ?? [])]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
    const pages: AdPage[] = []
    for (const q of queries) {
      const found: AdPage[] = []
      for (const p of await findAdPages(q, 6)) found.push(await withOcr(p))
      pages.push(...found.filter((p) => p.ocrText).map((p) => ({ ...p, query: q })))
    }
    if (!pages.length) return []
    const listing = pages
      .map((p, i) => {
        const text = p.ocrText ?? ''
        const at = Math.max(
          0,
          text.toLowerCase().indexOf(((p as { query?: string }).query ?? '').toLowerCase()) - 400
        )
        return `[${i}] ${p.newspaper}, ${p.date}: ${text.slice(at, at + 900).replace(/\s+/g, ' ')}`
      })
      .join('\n')
    const { topics } = await generateStructured(
      `You pick topics for "${pack.name}": ${pack.topicSource.brief}
Already on the channel: ${done.join(' | ') || 'none'}
Mention only, never the main topic: ${pack.saturatedTopics.join(', ')}
Newspaper pages found in the archive (OCR, noisy):
${listing}

Pick up to 8 real ads from these pages that make a strong investigation. For each: topic (English working title with the hook, max 80 characters), page (the [number]) and phrase (3–8 words copied exactly from the ad's OCR text, its most striking line, to locate it on the page).
Return ONLY JSON: {"topics": [{"topic": "...", "page": 0, "phrase": "..."}]}`,
      z.object({
        topics: z.array(
          z.object({ topic: z.string().min(1), page: z.number().int(), phrase: z.string() })
        )
      }),
      {
        settings: { ...polishSettings(s), claudeModel: 'opus' },
        temperature: 0.8,
        effort: 'medium'
      }
    )
    const out: string[] = []
    for (const t of topics) {
      const page = pages[t.page]
      if (!page) continue
      const topic = t.topic.replace(/^["']|["']$/g, '').trim()
      const text = page.ocrText ?? ''
      const at = Math.max(0, text.indexOf(t.phrase) - 600)
      rememberTopicEvidence(channelId, topic, {
        page,
        phrase: t.phrase,
        excerpt: text.slice(at, at + 1500)
      })
      out.push(topic)
    }
    return out
  }

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
    for (const v of created) attachEvidence(channelId, v.topic, v.id)
    return created
  }

  /**
   * The real ad the user attaches when the search found none (Ads on Trial): checked like a
   * searched one, read with the OCR, then the script is written from it.
   */
  async attachAd(id: number, input: ManualAd): Promise<void> {
    const v = getVideo(id)
    if (!['TOPIC_QUEUED', 'SCRIPT_REVIEW', 'ERROR'].includes(v.status))
      throw new Error('O vídeo já está em produção')
    setVideoEvidence(id, await manualEvidence(input))
    this.redoScript(id)
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
      if (v.status !== 'SCRIPT_REVIEW' || !v.script) continue
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
    const missing = v.kind === 'long' ? checklistMissing(v) : []
    if (missing.length)
      throw new Error(`Complete o checklist antes de aprovar: ${missing.join('; ')}`)
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
      scriptSchemaFor(formatOf(s.format)),
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

  /** Thumbnail model that won YouTube's "Test & compare" for this video, if recorded. */
  /** Ads on Trial: concept, blind test and scores of the thumbnails, for the final review. */
  thumbBrief(id: number): ThumbBriefReport | null {
    return getState<ThumbBriefReport | null>(`thumbBrief.video.${id}`, null)
  }

  /** New thumbnail concepts as a side job: the video keeps its status and its title. */
  newThumbConcept(id: number): void {
    getVideo(id)
    enqueueJob(id, 'thumbnail', 'now', 5, false, { keepStatus: true, newConcept: true })
    this.scheduler.kick()
  }

  thumbWinner(id: number): string | null {
    const v = getVideo(id)
    return getState<Record<string, string>>(`thumbWins.ch.${v.channel_id}`, {})[id] ?? null
  }

  /** Record (or clear) a test winner; after 6 results the winner's model goes first. */
  setThumbWinner(id: number, model: string | null): void {
    const v = getVideo(id)
    const key = `thumbWins.ch.${v.channel_id}`
    const wins = getState<Record<string, string>>(key, {})
    if (model) wins[id] = model
    else delete wins[id]
    setState(key, wins)
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
      // Any video holding a time keeps it, even one in ERROR waiting to be sent again.
      .filter((v) => v.scheduled_at)
      .map((v) => v.scheduled_at as string)
    return nextFreeSlot(s.publishSlots, s.publishTimezone, taken, new Date(), s.maxLongPerWeek)
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
