/**
 * Background music in up to three parts: an upbeat or curious track for the rise, a dramatic
 * one from the moment things start going wrong for the company, and a closing track for the
 * outro and the end screen. Tracks come from the channel's music folder:
 *   musica/            opening (upbeat, curious)
 *   musica/_sombrias/  dramatic
 *   musica/_final/     closing (falls back to an opening track)
 */
import { existsSync, readdirSync } from 'fs'
import { extname, join } from 'path'
import { z } from 'zod'
import type { Script } from '../../shared/types'
import type { MusicMood } from '../../shared/render'
import { runTool } from '../services/ffmpeg'
import { generateStructured } from '../services/llm'
import { polishSettings } from './polish'
import type { StepContext } from './types'

const MUSIC_EXT = ['.mp3', '.wav', '.m4a', '.ogg']
const FOLDERS: Record<MusicMood, string> = { open: '', drama: '_sombrias', final: '_final' }
/** Project file per part; the opening keeps the old name, which the shorts also use. */
const FILES: Record<MusicMood, string> = {
  open: 'music.mp3',
  drama: 'music-drama.mp3',
  final: 'music-final.mp3'
}
/** No part shorter than this, so the music does not keep changing. */
const MIN_PART_SEC = 45

export interface MusicPart {
  mood: MusicMood
  from: number
  to: number
}

/**
 * Where each part plays, in seconds. `turn` is when things start going wrong (null when they
 * never do), `outro` is the start of the closing words, `end` the end of the video.
 */
export function planMusic(turn: number | null, outro: number | null, end: number): MusicPart[] {
  const finalAt = outro !== null && outro >= MIN_PART_SEC && end - outro >= 20 ? outro : end
  const dramaAt = turn !== null && turn >= 60 && finalAt - turn >= MIN_PART_SEC ? turn : finalAt
  const parts: MusicPart[] = [{ mood: 'open', from: 0, to: dramaAt }]
  if (dramaAt < finalAt) parts.push({ mood: 'drama', from: dramaAt, to: finalAt })
  if (finalAt < end) parts.push({ mood: 'final', from: finalAt, to: end })
  return parts
}

function tracks(folder: string): string[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder, { withFileTypes: true })
    .filter((f) => f.isFile() && MUSIC_EXT.includes(extname(f.name).toLowerCase()))
    .map((f) => join(folder, f.name))
    .sort()
}

/**
 * Copy the track of each part into the project at one loudness, so a change of track does not
 * jump in volume. Stable per video: a part that already has its file keeps it.
 * Returns the project file of each part that has music.
 */
export async function prepareMusic(
  parts: MusicPart[],
  musicFolder: string,
  videoId: number,
  ctx: StepContext
): Promise<{ part: MusicPart; file: string }[]> {
  const out: { part: MusicPart; file: string }[] = []
  for (const part of parts) {
    const file = join(ctx.projectDir, FILES[part.mood])
    if (!existsSync(file)) {
      const open = tracks(musicFolder)
      let pool = tracks(join(musicFolder, FOLDERS[part.mood]))
      // No closing tracks: another opening track, not the one the video starts with.
      if (part.mood === 'final' && !pool.length && open.length > 1)
        pool = open.filter((_, i) => i !== videoId % open.length)
      if (part.mood === 'open') pool = open
      if (!pool.length) continue
      const track = pool[videoId % pool.length]
      await runTool(
        'ffmpeg',
        [
          '-y',
          '-i',
          track,
          '-vn',
          '-af',
          'loudnorm=I=-13:TP=-1.5',
          '-ar',
          '44100',
          '-b:a',
          '192k',
          file
        ],
        ctx.signal
      )
      ctx.log(`Música (${part.mood}): ${track.split(/[\\/]/).pop()}`)
    }
    out.push({ part, file })
  }
  return out
}

/**
 * The script scene (1-based) where things start going wrong for the company, 0 when they
 * never do. Asked once to Claude and kept in the script.
 */
export async function musicTurn(script: Script, topic: string, ctx: StepContext): Promise<number> {
  const listing = script.scenes
    .map((s, i) => `SCENE ${i + 1}${s.year ? ` (${s.year})` : ''}: ${s.narration}`)
    .join('\n')
  const answer = await generateStructured(
    `A YouTube documentary about "${topic}" gets background music in parts: an upbeat, curious track while things go well, then a dramatic track from the moment things start going wrong for the company (the first real decline, crisis or costly mistake that the story then follows), then a closing track. Which scene starts the dramatic part? Answer 0 if the story never turns bad.

SCRIPT:
${listing}`,
    z.object({ scene: z.number().int() }),
    { settings: polishSettings(ctx.settings), signal: ctx.signal, temperature: 0 }
  )
  return Math.max(0, Math.min(script.scenes.length, answer.scene))
}
