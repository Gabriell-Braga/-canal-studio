import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getVideo, listScenes, updateVideo } from '../db/repo'
import { concatAndNormalize, isValidFile, probeDuration, runTool } from '../services/ffmpeg'
import type { Settings } from '../../shared/types'
import { pythonPost } from '../services/python'
import {
  CHANNEL_INTRO_SEC,
  OUTRO_PAUSE_SEC,
  OUTRO_SPEED,
  YEAR_CARD_SEC,
  yearChanges
} from '../../shared/render'
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
  /** Every file joined, in order (scenes plus the channel intro) */
  files?: string[]
  /** Channel intro after the hook: where it starts in the narration and how long it is */
  intro?: { start: number; duration: number }
}

/**
 * Audio for the channel intro: the narrated tagline (or silence) padded to at least
 * CHANNEL_INTRO_SEC, in the TTS format so the concat can join it.
 */
async function introClip(
  dir: string,
  s: Settings,
  signal: AbortSignal
): Promise<{ file: string; duration: number }> {
  const text = s.introNarrate ? s.introTagline.trim() : ''
  const hash = createHash('sha1')
    .update(`${s.voice}|${s.voiceSpeed}|${text}`)
    .digest('hex')
    .slice(0, 10)
  const file = join(dir, `intro_${hash}.wav`)
  if (!isValidFile(file, 1000)) {
    let duration = CHANNEL_INTRO_SEC
    const args = ['-y']
    if (text) {
      const tts = join(dir, `intro_tts_${hash}.wav`)
      await pythonPost('/tts', { text, voice: s.voice, speed: s.voiceSpeed, out_path: tts }, signal)
      duration = Math.max(CHANNEL_INTRO_SEC, (await probeDuration(tts)) + 1.3)
      args.push('-i', tts, '-af', 'adelay=700|700,apad')
    } else {
      args.push('-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono')
    }
    args.push('-t', duration.toFixed(2), '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', file)
    await runTool('ffmpeg', args, signal)
  }
  return { file, duration: await probeDuration(file) }
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

    // The outro is the last scene: read slower and after a longer silence.
    const outro = getVideo(videoId).script?.outro?.trim()
    const outroIndex =
      outro && scenes.length > 2 && scenes.at(-1)?.narration.trim() === outro
        ? scenes.length - 1
        : -1

    const timings: SceneTiming[] = []
    let generated = 0
    for (const [i, scene] of scenes.entries()) {
      if (ctx.signal.aborted) throw new Error('Cancelado')
      const speed = i === outroIndex ? voiceSpeed * OUTRO_SPEED : voiceSpeed
      const file = sceneFile(dir, scene.index, scene.narration, voice, speed)
      if (!isValidFile(file)) {
        await pythonPost(
          '/tts',
          { text: scene.narration, voice, speed, out_path: file },
          ctx.signal
        )
        generated++
      }
      timings.push({ sceneId: scene.id, file, duration: await probeDuration(file) })
      ctx.progress(((i + 1) / scenes.length) * 0.85)
    }
    ctx.log(`Áudio: ${generated} cena(s) geradas, ${scenes.length - generated} reaproveitadas`)

    const changes = yearChanges(scenes.map((s) => s.year))
    const gaps = scenes.map((_, i) =>
      changes.has(i + 1)
        ? YEAR_CARD_SEC
        : i + 1 === outroIndex
          ? Math.max(scenePauseSec, OUTRO_PAUSE_SEC)
          : scenePauseSec
    )
    if (changes.size) ctx.log(`${changes.size} mudança(s) de ano com cartão de transição`)

    // The channel intro goes right after the hook: hook, pause, intro, then the story.
    const files = timings.map((t) => t.file)
    const pauses = [...gaps]
    let intro: AudioTimings['intro']
    if (ctx.settings.introEnabled && scenes.length > 1) {
      const clip = await introClip(dir, ctx.settings, ctx.signal)
      files.splice(1, 0, clip.file)
      pauses.splice(0, 0, scenePauseSec)
      intro = { start: timings[0].duration + scenePauseSec, duration: clip.duration }
      gaps[0] = scenePauseSec + clip.duration + gaps[0]
      ctx.log(`Intro do canal: ${clip.duration.toFixed(1)} s depois do gancho`)
    }

    const out = join(ctx.projectDir, 'narration.wav')
    const timingsFile = join(dir, 'timings.json')
    const previous = readTimings(ctx.projectDir)
    const sameInputs =
      previous &&
      previous.pauseSec === scenePauseSec &&
      JSON.stringify(previous.gaps ?? null) === JSON.stringify(gaps) &&
      JSON.stringify(previous.files ?? previous.scenes.map((s) => s.file)) === JSON.stringify(files)
    if (!sameInputs || !isValidFile(out)) {
      await concatAndNormalize(files, pauses, out, dir, ctx.signal)
    }
    const total = await probeDuration(out)
    const data: AudioTimings = {
      pauseSec: scenePauseSec,
      gaps,
      scenes: timings,
      total,
      files,
      intro
    }
    writeFileSync(timingsFile, JSON.stringify(data, null, 2))
    updateVideo(videoId, { audio_path: out })
    ctx.log(`Narração: ${(total / 60).toFixed(1)} min, normalizada a -14 LUFS`)
    ctx.progress(1)
  }
}
