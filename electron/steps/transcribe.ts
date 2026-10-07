import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getVideo, listScenes, updateScene } from '../db/repo'
import { pythonPost } from '../services/python'
import { readTimings } from './audio'
import type { Step } from './types'

export interface Word {
  word: string
  start: number
  end: number
}

export function readWords(projectDir: string): Word[] {
  const file = join(projectDir, 'words.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).words as Word[]) : []
}

export const transcribeStep: Step = {
  type: 'transcribe',
  status: 'AUDIO',
  async run(videoId, ctx) {
    const video = getVideo(videoId)
    if (!video.audio_path || !existsSync(video.audio_path))
      throw new Error('Narração não encontrada')
    const timings = readTimings(ctx.projectDir)
    if (!timings) throw new Error('timings.json ausente; refaça a etapa de áudio')

    const wordsFile = join(ctx.projectDir, 'words.json')
    const fresh =
      existsSync(wordsFile) && statSync(wordsFile).mtimeMs > statSync(video.audio_path).mtimeMs
    if (!fresh) {
      ctx.log(
        `Transcrevendo com faster-whisper ${ctx.settings.whisperModel} (${ctx.settings.whisperDevice})`
      )
      const result = await pythonPost<{ words: Word[]; duration: number; device: string }>(
        '/transcribe',
        {
          audio_path: video.audio_path,
          model: ctx.settings.whisperModel,
          device: ctx.settings.whisperDevice
        },
        ctx.signal
      )
      writeFileSync(
        wordsFile,
        JSON.stringify({ device: result.device, words: result.words }, null, 2)
      )
      ctx.log(
        `${result.words.length} palavras com tempo (Whisper em ${result.device.toUpperCase()})`
      )
      // Free Whisper's VRAM before ComfyUI runs.
      await pythonPost('/unload', {}).catch(() => undefined)
    }
    ctx.progress(0.8)

    // Scene boundaries come from the exact TTS clip lengths; each scene owns the pause after it.
    const scenes = listScenes(videoId)
    let t = 0
    timings.scenes.forEach((timing, i) => {
      const start = t
      t +=
        timing.duration +
        (i < timings.scenes.length - 1 ? (timings.gaps?.[i] ?? timings.pauseSec) : 0)
      const end = i === timings.scenes.length - 1 ? timings.total : t
      const scene = scenes.find((s) => s.id === timing.sceneId)
      if (scene) updateScene(scene.id, { start_sec: round(start), end_sec: round(end) })
    })

    const words = readWords(ctx.projectDir)
    const expected = scenes
      .map((s) => s.narration)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean).length
    if (Math.abs(words.length - expected) > expected * 0.15) {
      ctx.log(`Atenção: transcrição tem ${words.length} palavras, roteiro tem ${expected}`, 'warn')
    }
    ctx.progress(1)
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
