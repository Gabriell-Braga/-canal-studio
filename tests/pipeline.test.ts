import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createShort, createVideo, getVideo, jobsForVideo, updateVideo } from '../electron/db/repo'
import { setSettings } from '../electron/db/settings'
import { Pipeline } from '../electron/pipeline'
import { staleShorts } from '../electron/steps/shorts'
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

describe('shorts show the picked thumbnail', () => {
  let dir = ''
  beforeEach(() => {
    dir = freshDb()
  })

  /** A full video with two thumbnails and one short whose end card shows the first one. */
  function setup(): { id: number; short: number } {
    const id = finishedVideo()
    const thumbs = ['thumb_1.png', 'thumb_2.png'].map((f) => join(dir, f))
    thumbs.forEach((t) => writeFileSync(t, 'png'))
    updateVideo(id, { thumbnail_paths: thumbs, chosen_thumbnail: 0 })
    const short = finishedShort(id)
    mkdirSync(join(dir, 'shorts'))
    const out = join(dir, 'shorts', `short_${short}.mp4`)
    writeFileSync(out, Buffer.alloc(200_000))
    utimesSync(out, new Date(), new Date(Date.now() + 60_000))
    const job = {
      root: dir,
      framed: true,
      extended: true,
      short: { cuts: [], cta: { thumbnail: '{{root}}/thumb_1.png' } }
    }
    writeFileSync(join(dir, 'shorts', `short_${short}.json`), JSON.stringify(job))
    updateVideo(short, { video_path: out })
    return { id, short }
  }

  it('finds shorts whose end card shows another thumbnail', () => {
    const { id, short } = setup()
    expect(staleShorts(getVideo(id))).toEqual([])
    updateVideo(id, { chosen_thumbnail: 1 })
    expect(staleShorts(getVideo(id)).map((s) => s.id)).toEqual([short])
    const pipeline = new Pipeline(scheduler)
    pipeline.refreshShortThumbs(id)
    expect(jobsForVideo(id).find((j) => j.type === 'short')?.args).toEqual({ refresh: true })
  })

  it('renders again full-screen shorts with the pauses still in', () => {
    const { id, short } = setup()
    const file = join(dir, 'shorts', `short_${short}.json`)
    const job = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, JSON.stringify({ ...job, short: { ...job.short, cuts: undefined } }))
    expect(staleShorts(getVideo(id)).map((s) => s.id)).toEqual([short])
  })

  it('renders again shorts cut before the crop followed the subject', () => {
    const { id, short } = setup()
    const file = join(dir, 'shorts', `short_${short}.json`)
    writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), framed: undefined })
    )
    expect(staleShorts(getVideo(id)).map((s) => s.id)).toEqual([short])
  })

  it('leaves shorts already on YouTube alone', () => {
    const { id, short } = setup()
    updateVideo(short, { youtube_id: 'abc' })
    updateVideo(id, { chosen_thumbnail: 1 })
    expect(staleShorts(getVideo(id))).toEqual([])
  })

  it('cuts automatic shorts only when the full video is approved', () => {
    setSettings({ shortsAuto: true, shortsCount: 2 })
    const pipeline = new Pipeline(scheduler)
    const id = finishedVideo()
    expect(jobsForVideo(id).some((j) => j.type === 'short')).toBe(false)
    pipeline.approveFinal(id)
    expect(jobsForVideo(id).find((j) => j.type === 'short')?.args).toEqual({ count: 2 })
  })
})

describe('publish slots', () => {
  beforeEach(() => {
    freshDb()
  })

  it('never gives a video the time of one in ERROR waiting to be sent again', () => {
    const pipeline = new Pipeline(scheduler)
    const failed = finishedVideo()
    const first = pipeline.approveFinal(failed).scheduled_at
    updateVideo(failed, { status: 'ERROR' })
    const next = pipeline.approveFinal(finishedVideo()).scheduled_at
    expect(next).not.toBe(first)
  })
})
