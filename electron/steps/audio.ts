import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getVideo, listScenes, replaceScenes, updateVideo } from '../db/repo'
import { concatAndNormalize, isValidFile, probeDuration, runTool } from '../services/ffmpeg'
import type { Script, Settings } from '../../shared/types'
import { pythonPost } from '../services/python'
import {
  CHANNEL_INTRO_SEC,
  OUTRO_PAUSE_SEC,
  OUTRO_SPEED,
  YEAR_CARD_SEC,
  yearChanges
} from '../../shared/render'
import { polishScript } from './polish'
import { periodVoice } from '../../shared/formats'
import {
  estimatedStarts,
  planAnnouncer,
  speakableAd,
  type AnnouncerPlan,
  type AnnouncerSegment
} from '../../shared/formats/vintage-ads'
import { isEnglishWord } from '../services/words'
import { videoEvidence } from './evidence'
import { refreshAdFactAlert } from './script'
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
  /** Where the period announcer speaks (radio static included), seconds of narration.wav */
  periods?: AnnouncerPeriod[]
}

export interface AnnouncerPeriod {
  sceneId: number
  start: number
  end: number
  quote: string
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

/** Radio static around each announcer line, seconds */
const STATIC_SEC = 0.3
/** Silence between the narrator's bridge line and the static */
const BRIDGE_PAUSE_SEC = 0.25

const STATIC_FX = `highpass=f=800,lowpass=f=5000,afade=t=in:d=0.04,afade=t=out:st=${STATIC_SEC - 0.06}:d=0.06`
const MONO = 'aresample=24000,aformat=sample_fmts=fltp:channel_layouts=mono'

/**
 * A Claim Check scene with a line of the ad: the narrator's bridge ("Here's how the ad put
 * it:"), radio static, the period announcer through the old radio filter, static again,
 * then the scene's narration. Returns where the announcer (with its static) sits in the file.
 */
async function periodScene(
  seg: AnnouncerSegment,
  narration: string,
  period: PeriodVoice,
  narrator: { voice: string; speed: number },
  out: string,
  signal: AbortSignal
): Promise<{ at: number; length: number }> {
  const b = out.replace(/\.wav$/, '_bridge.wav')
  const q = out.replace(/\.wav$/, '_ad.wav')
  if (!isValidFile(b))
    await pythonPost(
      '/tts',
      { text: seg.bridge, voice: narrator.voice, speed: narrator.speed, out_path: b },
      signal
    )
  if (!isValidFile(q)) await periodLine(seg.quote, period, q, signal)
  if (!isValidFile(out)) {
    const noise = `anoisesrc=color=white:amplitude=0.15:sample_rate=24000:duration=${STATIC_SEC}`
    await runTool(
      'ffmpeg',
      [
        '-y',
        '-i',
        b,
        '-i',
        q,
        '-i',
        narration,
        '-f',
        'lavfi',
        '-i',
        noise,
        '-f',
        'lavfi',
        '-i',
        noise,
        '-filter_complex',
        `[0]${MONO},apad=pad_dur=${BRIDGE_PAUSE_SEC}[b];[3]${STATIC_FX},${MONO}[s1];[1]${MONO}[a];[4]${STATIC_FX},${MONO},apad=pad_dur=0.4[s2];[2]${MONO}[n];[b][s1][a][s2][n]concat=n=5:v=0:a=1[o]`,
        '-map',
        '[o]',
        '-ar',
        '24000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        out
      ],
      signal
    )
  }
  return {
    at: (await probeDuration(b)) + BRIDGE_PAUSE_SEC,
    length: 2 * STATIC_SEC + (await probeDuration(q))
  }
}

/** Start second of each file once joined with `pauses[i]` of silence after file i. */
export function fileStarts(durations: number[], pauses: number[]): number[] {
  const starts: number[] = []
  let t = 0
  durations.forEach((d, i) => {
    starts.push(t)
    t += d + (pauses[i] ?? 0)
  })
  return starts
}

/** The real ad text (OCR) the announcer's lines are checked against. */
function adOcr(videoId: number): string {
  return videoEvidence(videoId)?.excerpt ?? ''
}

/** The announcer plan of a video before audio exists, with times estimated from word counts. */
export function estimatedAnnouncer(videoId: number, script: Script, s: Settings): AnnouncerPlan {
  const starts = estimatedStarts(script, {
    speed: s.voiceSpeed,
    pauseSec: s.scenePauseSec,
    introSec: s.introEnabled ? CHANNEL_INTRO_SEC + s.scenePauseSec : 0
  })
  return periodVoice(s)
    ? planAnnouncer(script, adOcr(videoId), starts, isEnglishWord)
    : { segments: [], dropped: [] }
}

type PeriodVoice = NonNullable<ReturnType<typeof periodVoice>>

/** One ad line in the period announcer's voice, through the old radio filter, into `out`. */
export async function periodLine(
  quote: string,
  period: PeriodVoice,
  out: string,
  signal?: AbortSignal
): Promise<void> {
  const raw = out.replace(/\.wav$/, '_raw.wav')
  await pythonPost(
    '/tts',
    { text: speakableAd(quote), voice: period.voice, speed: period.speed, out_path: raw },
    signal
  )
  const filter = period.filter ?? 'highpass=f=300,lowpass=f=3400'
  await runTool(
    'ffmpeg',
    [
      '-y',
      '-i',
      raw,
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=pink:amplitude=0.012:sample_rate=24000',
      '-filter_complex',
      `[0]aresample=24000,${filter},asoftclip[ad];[1]highpass=f=300,lowpass=f=3400[hiss];[ad][hiss]amix=inputs=2:duration=first:normalize=0[o]`,
      '-map',
      '[o]',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      out
    ],
    signal
  )
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
    // Scripts approved before the final edit existed get it now, while no scene has media yet.
    const video = getVideo(videoId)
    if (
      ctx.settings.scriptPolish &&
      video.script &&
      !video.script.polished &&
      !listScenes(videoId).some((s) => s.asset_path)
    ) {
      try {
        ctx.log('Revisão final do roteiro com Claude Sonnet')
        const script = structuredClone(video.script)
        const changed = await polishScript(script, video.topic, ctx.settings, ctx.signal)
        replaceScenes(videoId, script)
        updateVideo(videoId, { script })
        ctx.log(`Revisão final: ${changed} trecho(s) ajustado(s)`)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        ctx.log(`Revisão final falhou: ${(error as Error).message}`, 'warn')
      }
    }
    const scenes = listScenes(videoId)
    if (!scenes.length) throw new Error('Vídeo sem cenas; gere o roteiro primeiro')
    const script = getVideo(videoId).script
    if (script && videoEvidence(videoId)) refreshAdFactAlert(videoId)

    // The outro is the last scene: read slower and after a longer silence.
    const outro = script?.outro?.trim()
    const outroIndex =
      outro && scenes.length > 2 && scenes.at(-1)?.narration.trim() === outro
        ? scenes.length - 1
        : -1

    // 1. The narrator's voice for every scene.
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
      ctx.progress(((i + 1) / scenes.length) * 0.75)
    }

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
    let introClipFile: { file: string; duration: number } | null = null
    if (ctx.settings.introEnabled && scenes.length > 1) {
      introClipFile = await introClip(dir, ctx.settings, ctx.signal)
      gaps[0] = scenePauseSec + introClipFile.duration + gaps[0]
    }
    const sceneStarts = (): number[] =>
      fileStarts(
        timings.map((t) => t.duration),
        gaps
      )

    // 2. The period announcer, planned on the real scene times: at most 3 lines, after the
    // first minute, 90 s apart. Inserting them only pushes later scenes further.
    const secondary = periodVoice(ctx.settings)
    const periods: AnnouncerPeriod[] = []
    if (secondary) {
      const starts = sceneStarts()
      const plan = planAnnouncer(
        script,
        adOcr(videoId),
        (index) => {
          const k = scenes.findIndex((s) => s.index === index)
          return k < 0 ? null : starts[k]
        },
        isEnglishWord
      )
      for (const d of plan.dropped) ctx.log(`Locutor fora da cena ${d.scene}: ${d.reason}`)
      const offsets = new Map<number, { at: number; length: number }>()
      for (const seg of plan.segments) {
        const k = scenes.findIndex((s) => s.index === seg.scene)
        const speed = k === outroIndex ? voiceSpeed * OUTRO_SPEED : voiceSpeed
        const file = sceneFile(
          dir,
          seg.scene,
          `${secondary.voice}@${secondary.speed}:${seg.bridge}|${seg.quote}||${scenes[k].narration}`,
          voice,
          speed
        )
        const narration = timings[k].file
        offsets.set(
          k,
          await periodScene(seg, narration, secondary, { voice, speed }, file, ctx.signal)
        )
        timings[k] = { ...timings[k], file, duration: await probeDuration(file) }
      }
      const final = sceneStarts()
      for (const [k, o] of offsets) {
        const seg = plan.segments.find((s) => s.scene === scenes[k].index)
        periods.push({
          sceneId: scenes[k].id,
          start: final[k] + o.at,
          end: final[k] + o.at + o.length,
          quote: seg?.quote ?? ''
        })
      }
      periods.sort((a, b) => a.start - b.start)
      ctx.log(
        `Locutor de época: ${periods.length} trecho(s)${periods.length ? ` em ${periods.map((p) => `${Math.round(p.start)}s`).join(', ')}` : ''}`
      )
    }
    ctx.progress(0.85)
    ctx.log(`Áudio: ${generated} cena(s) geradas, ${scenes.length - generated} reaproveitadas`)

    const files = timings.map((t) => t.file)
    const pauses = [...gaps]
    let intro: AudioTimings['intro']
    if (introClipFile) {
      files.splice(1, 0, introClipFile.file)
      pauses.splice(0, 1, scenePauseSec, gaps[0] - scenePauseSec - introClipFile.duration)
      intro = { start: timings[0].duration + scenePauseSec, duration: introClipFile.duration }
      ctx.log(`Intro do canal: ${introClipFile.duration.toFixed(1)} s depois do gancho`)
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
      intro,
      periods
    }
    writeFileSync(timingsFile, JSON.stringify(data, null, 2))
    updateVideo(videoId, { audio_path: out })
    ctx.log(`Narração: ${(total / 60).toFixed(1)} min, normalizada a -14 LUFS`)
    ctx.progress(1)
  }
}
