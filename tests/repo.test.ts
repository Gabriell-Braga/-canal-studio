import { beforeEach, describe, expect, it } from 'vitest'
import {
  createVideo,
  enqueueJob,
  getVideo,
  listScenes,
  replaceScenes,
  resetRunningJobs,
  updateJob,
  updateVideo
} from '../electron/db/repo'
import { getSettings, setSettings } from '../electron/db/settings'
import { freshDb } from './helpers'

beforeEach(() => {
  freshDb()
})

describe('repo', () => {
  it('stores JSON columns and booleans', () => {
    const v = createVideo({ topic: 'T', durationMin: 8, synthetic: true })
    expect(v.status).toBe('TOPIC_QUEUED')
    expect(v.synthetic_content).toBe(true)
    updateVideo(v.id, { tags: ['a', 'b'], synthetic_content: false })
    const back = getVideo(v.id)
    expect(back.tags).toEqual(['a', 'b'])
    expect(back.synthetic_content).toBe(false)
  })

  it('builds scenes from hook, scenes and outro', () => {
    const v = createVideo({ topic: 'T', durationMin: 1, synthetic: true })
    replaceScenes(v.id, {
      title_options: ['x'],
      hook: 'Hook.',
      scenes: [
        { narration: 'One.', visual_keywords: 'sea', image_prompt: 'p1' },
        { narration: 'Two.', visual_keywords: 'ship', image_prompt: 'p2' }
      ],
      outro: 'Bye.'
    })
    const scenes = listScenes(v.id)
    expect(scenes.map((s) => s.narration)).toEqual(['Hook.', 'One.', 'Two.', 'Bye.'])
    expect(scenes.map((s) => s.index)).toEqual([0, 1, 2, 3])
  })

  it('does not duplicate live jobs and recovers running ones', () => {
    const v = createVideo({ topic: 'T', durationMin: 1, synthetic: true })
    const a = enqueueJob(v.id, 'audio', 'night')
    const b = enqueueJob(v.id, 'audio', 'night')
    expect(b.id).toBe(a.id)
    updateJob(a.id, { status: 'running' })
    expect(resetRunningJobs()).toBe(1)
  })

  it('merges settings with defaults', () => {
    expect(getSettings().maxVideosPerNight).toBe(3)
    setSettings({ maxVideosPerNight: 5, nightStart: '02:00' })
    expect(getSettings().maxVideosPerNight).toBe(5)
    expect(getSettings().nightEnd).toBe('07:00')
  })
})
