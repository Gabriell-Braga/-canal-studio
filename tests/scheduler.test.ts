import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { JobType } from '../shared/types'
import {
  createVideo,
  enqueueJob,
  getJob,
  getVideo,
  jobsByStatus,
  jobsForVideo,
  updateJob,
  updateVideo
} from '../electron/db/repo'
import { setSettings } from '../electron/db/settings'
import { Scheduler, type QueueEvent } from '../electron/queue/scheduler'
import type { Step } from '../electron/steps/types'
import { freshDb, waitFor } from './helpers'

let clock = new Date(2026, 9, 6, 12, 0)
let concurrentGpu = 0
let maxConcurrentGpu = 0
let failTimes: Partial<Record<JobType, number>> = {}
let events: QueueEvent[] = []

function fakeStep(type: JobType, status: Step['status'], ms = 30): Step {
  return {
    type,
    status,
    async run(_videoId, ctx) {
      concurrentGpu++
      maxConcurrentGpu = Math.max(maxConcurrentGpu, concurrentGpu)
      try {
        await new Promise((r) => setTimeout(r, ms))
        if (ctx.signal.aborted) throw new Error('aborted')
        if ((failTimes[type] ?? 0) > 0) {
          failTimes[type]!--
          throw new Error(`${type} broke`)
        }
      } finally {
        concurrentGpu--
      }
    }
  }
}

const schedulers: Scheduler[] = []

function makeScheduler(): Scheduler {
  const s = new Scheduler({
    steps: {
      script: fakeStep('script', 'SCRIPT_GENERATING'),
      audio: fakeStep('audio', 'AUDIO'),
      transcribe: fakeStep('transcribe', 'AUDIO'),
      scenes: fakeStep('scenes', 'SCENES'),
      render: fakeStep('render', 'RENDERING'),
      thumbnail: fakeStep('thumbnail', 'THUMBNAIL'),
      metadata: fakeStep('metadata', 'THUMBNAIL'),
      upload: fakeStep('upload', 'SCHEDULED')
    },
    projectDir: () => tmpdir(),
    clock: () => clock,
    onEvent: (e) => events.push(e)
  })
  schedulers.push(s)
  return s
}

// A scheduler left alive would pick up jobs from the next test's database.
afterEach(() => {
  schedulers.splice(0).forEach((s) => s.stop())
})

/** Tick until nothing is running or pending-and-eligible. */
async function drain(s: Scheduler, rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await s.tick()
    await new Promise((r) => setTimeout(r, 40))
    if (!jobsByStatus('running').length) {
      await s.tick()
      if (!jobsByStatus('running').length) return
    }
  }
}

beforeEach(() => {
  freshDb()
  clock = new Date(2026, 9, 6, 12, 0)
  concurrentGpu = 0
  maxConcurrentGpu = 0
  failTimes = {}
  events = []
})

describe('scheduler', () => {
  it('runs a script job now and moves the video to review', async () => {
    const s = makeScheduler()
    const v = createVideo({ topic: 'A', durationMin: 1, synthetic: true })
    enqueueJob(v.id, 'script', 'now')
    await drain(s)
    expect(getVideo(v.id).status).toBe('SCRIPT_REVIEW')
    expect(events.some((e) => e.type === 'scripts-ready')).toBe(true)
  })

  it('holds night jobs until the window opens, then runs the whole chain', async () => {
    const s = makeScheduler()
    const v = createVideo({ topic: 'A', durationMin: 1, synthetic: true })
    updateVideo(v.id, { status: 'PRODUCTION_QUEUED' })
    enqueueJob(v.id, 'audio', 'night')
    await drain(s)
    expect(getVideo(v.id).status).toBe('PRODUCTION_QUEUED')

    clock = new Date(2026, 9, 7, 1, 30)
    await drain(s)
    expect(getVideo(v.id).status).toBe('FINAL_REVIEW')
    const types = jobsForVideo(v.id)
      .map((j) => j.type)
      .reverse()
    expect(types).toEqual(['audio', 'transcribe', 'scenes', 'render', 'thumbnail', 'metadata'])
  })

  it('never runs two GPU jobs at once', async () => {
    const s = makeScheduler()
    for (let i = 0; i < 3; i++) {
      const v = createVideo({ topic: `T${i}`, durationMin: 1, synthetic: true })
      enqueueJob(v.id, 'script', 'now')
    }
    await drain(s)
    expect(maxConcurrentGpu).toBe(1)
    expect(jobsByStatus('done')).toHaveLength(3)
  })

  it('limits videos per night and ignores the limit with Rodar agora', async () => {
    setSettings({ maxVideosPerNight: 2 })
    clock = new Date(2026, 9, 7, 2, 0)
    const s = makeScheduler()
    const ids = [0, 1, 2].map((i) => {
      const v = createVideo({ topic: `N${i}`, durationMin: 1, synthetic: true })
      enqueueJob(v.id, 'audio', 'night')
      return v.id
    })
    await drain(s)
    expect(ids.map((id) => getVideo(id).status)).toEqual([
      'FINAL_REVIEW',
      'FINAL_REVIEW',
      'TOPIC_QUEUED'
    ])

    s.runNow()
    await drain(s)
    expect(getVideo(ids[2]).status).toBe('FINAL_REVIEW')
  })

  it('retries with back-off, then marks the video as ERROR', async () => {
    failTimes = { script: 5 }
    const s = makeScheduler()
    const v = createVideo({ topic: 'F', durationMin: 1, synthetic: true })
    const job = enqueueJob(v.id, 'script', 'now')

    await drain(s)
    expect(getJob(job.id).status).toBe('pending')
    expect(getJob(job.id).attempts).toBe(1)

    clock = new Date(clock.getTime() + 61_000)
    await drain(s)
    expect(getJob(job.id).attempts).toBe(2)

    clock = new Date(clock.getTime() + 5 * 60_000 + 1000)
    await drain(s)
    expect(getJob(job.id).status).toBe('failed')
    const video = getVideo(v.id)
    expect(video.status).toBe('ERROR')
    expect(video.error_step).toBe('script')
    expect(video.error_message).toContain('script broke')
  })

  it('puts jobs left running by a crash back in the queue', async () => {
    const v = createVideo({ topic: 'C', durationMin: 1, synthetic: true })
    const job = enqueueJob(v.id, 'script', 'now')
    updateJob(job.id, { status: 'running' })
    const s = makeScheduler()
    s.start()
    await waitFor(() => getJob(job.id).status === 'done')
    s.stop()
    expect(getVideo(v.id).status).toBe('SCRIPT_REVIEW')
  })

  it('pauses and resumes', async () => {
    const s = makeScheduler()
    s.pause()
    const v = createVideo({ topic: 'P', durationMin: 1, synthetic: true })
    enqueueJob(v.id, 'script', 'now')
    await drain(s)
    expect(getVideo(v.id).status).toBe('TOPIC_QUEUED')
    s.resume()
    await drain(s)
    expect(getVideo(v.id).status).toBe('SCRIPT_REVIEW')
  })
})
