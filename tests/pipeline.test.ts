import { beforeEach, describe, expect, it } from 'vitest'
import { createShort, createVideo, getVideo, jobsForVideo, updateVideo } from '../electron/db/repo'
import { Pipeline } from '../electron/pipeline'
import type { Scheduler } from '../electron/queue/scheduler'
import { freshDb } from './helpers'

const scheduler = { kick: () => undefined } as unknown as Scheduler

function finishedVideo(): number {
  const v = createVideo({ topic: 'Rome', durationMin: 8, synthetic: false })
  updateVideo(v.id, { status: 'FINAL_REVIEW', video_path: 'C:/v.mp4' })
  return v.id
}

function finishedShort(parentId: number): number {
  const s = createShort(getVideo(parentId), 0, 30, 'Short', 'd')
  updateVideo(s.id, { status: 'FINAL_REVIEW', video_path: 'C:/s.mp4' })
  return s.id
}

describe('shorts follow their full video', () => {
  beforeEach(() => {
    freshDb()
  })

  it('approves the finished shorts with the full video, 30 minutes apart', () => {
    const pipeline = new Pipeline(scheduler)
    const id = finishedVideo()
    const a = finishedShort(id)
    const b = finishedShort(id)
    const parent = pipeline.approveFinal(id)
    const at = new Date(parent.scheduled_at as string).getTime()
    const times = [a, b].map((s) => new Date(getVideo(s).scheduled_at as string).getTime() - at)
    expect([a, b].map((s) => getVideo(s).status)).toEqual(['SCHEDULED', 'SCHEDULED'])
    expect(times).toEqual([30 * 60_000, 60 * 60_000])
    expect(jobsForVideo(a).some((j) => j.type === 'upload')).toBe(true)
  })

  it('leaves shorts waiting while the full video is not approved', () => {
    const pipeline = new Pipeline(scheduler)
    const id = finishedVideo()
    const a = finishedShort(id)
    pipeline.approveShorts(id)
    expect(getVideo(a).status).toBe('FINAL_REVIEW')
  })

  it('approves shorts that finish after the full video was approved', () => {
    const pipeline = new Pipeline(scheduler)
    const id = finishedVideo()
    pipeline.approveFinal(id)
    const a = finishedShort(id)
    pipeline.approveShorts(id)
    expect(getVideo(a).status).toBe('SCHEDULED')
  })
})
