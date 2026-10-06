import { JOB_TYPES, type JobType, type VideoStatus } from '../../shared/types'
import { replaceScenes, updateVideo } from '../db/repo'
import { audioStep } from './audio'
import { metadataStep } from './metadata'
import { renderStep } from './render'
import { scenesStep } from './scenes'
import { thumbnailStep } from './thumbnail'
import { uploadStep } from './upload'
import { scriptStep } from './script'
import { transcribeStep } from './transcribe'
import type { Step } from './types'

const realSteps: Partial<Record<JobType, Step>> = {
  script: scriptStep,
  audio: audioStep,
  transcribe: transcribeStep,
  scenes: scenesStep,
  render: renderStep,
  thumbnail: thumbnailStep,
  metadata: metadataStep,
  upload: uploadStep
}

const STATUS: Record<JobType, VideoStatus> = {
  script: 'SCRIPT_GENERATING',
  audio: 'AUDIO',
  transcribe: 'AUDIO',
  scenes: 'SCENES',
  render: 'RENDERING',
  thumbnail: 'THUMBNAIL',
  metadata: 'THUMBNAIL',
  upload: 'SCHEDULED'
}

/**
 * Test double used by the queue E2E (CANAL_FAKE_STEPS=1): every step just waits a few
 * seconds, so the scheduler can be exercised without GPU work.
 */
function fakeStep(type: JobType): Step {
  const ms = Number(process.env.CANAL_FAKE_STEP_MS) || 3000
  return {
    type,
    status: STATUS[type],
    async run(videoId, ctx) {
      const parts = 10
      for (let i = 1; i <= parts; i++) {
        if (ctx.signal.aborted) throw new Error('Cancelado')
        await new Promise((r) => setTimeout(r, ms / parts))
        ctx.progress(i / parts)
      }
      ctx.log(`(teste) etapa ${type} simulada`)
      if (type === 'script') {
        const script = {
          title_options: ['Test video'],
          hook: 'A test hook.',
          scenes: [
            { narration: 'Scene one.', visual_keywords: 'ocean', image_prompt: 'ocean' },
            { narration: 'Scene two.', visual_keywords: 'city', image_prompt: 'city' }
          ],
          outro: 'Subscribe.'
        }
        replaceScenes(videoId, script)
        updateVideo(videoId, { script, title: 'Test video' })
      }
      if (type === 'render') updateVideo(videoId, { video_path: `${ctx.projectDir}\\fake.mp4` })
    }
  }
}

function build(): Partial<Record<JobType, Step>> {
  if (process.env.CANAL_FAKE_STEPS !== '1') return realSteps
  return Object.fromEntries(JOB_TYPES.map((t) => [t, fakeStep(t)]))
}

export const steps = build()
