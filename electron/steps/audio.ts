import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { listScenes, updateVideo } from '../db/repo'
import { concatAndNormalize, isValidFile, probeDuration } from '../services/ffmpeg'
import { pythonPost } from '../services/python'
import { YEAR_CARD_SEC, yearChanges } from '../../shared/render'
import type { Step } from './types'

export interface SceneTiming {
  sceneId: number
  file: string
  duration: number
}

export interface AudioTimings {
  pauseSec: number
  /** Silence after each scene; longer before a scene that opens a new year (the year card) */
  gaps?: number[]
  scenes: SceneTiming[]
  total: number
}

/** Same text + voice + speed → same file name, so only edited scenes are regenerated. */
function sceneFile(dir: string, index: number, text: string, voice: string, speed: number): string {
  const hash = createHash('sha1').update(`${voice}|${speed}|${text}`).digest('hex').slice(0, 10)
  return join(dir, `scene_${String(index).padStart(3, '0')}_${hash}.wav`)
}

export function readTimings(projectDir: string): AudioTimings | null {
  const file = join(projectDir, 'audio', 'timings.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as AudioTimings
}

export const audioStep: Step = {
  type: 'audio',
  status: 'AUDIO',
  async run(videoId, ctx) {
    const { voice, voiceSpeed, scenePauseSec } = ctx.settings
    const dir = join(ctx.projectDir, 'audio')
    mkdirSync(dir, { recursive: true })
    const scenes = listScenes(videoId)
    if (!scenes.length) throw new Error('Vídeo sem cenas; gere o roteiro primeiro')

    const timings: SceneTiming[] = []
    let generated = 0
    for (const [i, scene] of scenes.entries()) {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      const file = sceneFile(dir, scene.index, scene.narration, voice, voiceSpeed)
      if (!isValidFile(file)) {
        await pythonPost(
          '/tts',
          { text: scene.narration, voice, speed: voiceSpeed, out_path: file },
          ctx.signal
        )
        generated++
      }
      timings.push({ sceneId: scene.id, file, duration: await probeDuration(file) })
      ctx.progress(((i + 1) / scenes.length) * 0.85)
    }
    ctx.log(`Áudio: ${generated} cena(s) geradas, ${scenes.length - generated} reaproveitadas`)

    const changes = yearChanges(scenes.map((s) => s.year))
    const gaps = scenes.map((_, i) => (changes.has(i + 1) ? YEAR_CARD_SEC : scenePauseSec))
    if (changes.size) ctx.log(`${changes.size} mudança(s) de ano com cartão de transição`)

    const out = join(ctx.projectDir, 'narration.wav')
    const timingsFile = join(dir, 'timings.json')
    const previous = readTimings(ctx.projectDir)
    const sameInputs =
      previous &&
      previous.pauseSec === scenePauseSec &&
      JSON.stringify(previous.gaps ?? null) === JSON.stringify(gaps) &&
      JSON.stringify(previous.scenes.map((s) => s.file)) ===
        JSON.stringify(timings.map((s) => s.file))
    if (!sameInputs || !isValidFile(out)) {
      await concatAndNormalize(
        timings.map((t) => t.file),
        gaps,
        out,
        dir,
        ctx.signal
      )
    }
    const total = await probeDuration(out)
    const data: AudioTimings = { pauseSec: scenePauseSec, gaps, scenes: timings, total }
    writeFileSync(timingsFile, JSON.stringify(data, null, 2))
    updateVideo(videoId, { audio_path: out })
    ctx.log(`Narração: ${(total / 60).toFixed(1)} min, normalizada a -14 LUFS`)
    ctx.progress(1)
  }
}
