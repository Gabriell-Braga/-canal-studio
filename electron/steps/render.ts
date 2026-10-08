import { createHash } from 'crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { END_SCREEN_SEC, type TemplateId, type VideoProps } from '../../shared/render'
import type { Scene, Video } from '../../shared/types'
import { getVideo, listScenes, updateVideo } from '../db/repo'
import { isValidFile, probeDuration } from '../services/ffmpeg'
import { remotionCodeHash, runRender } from '../services/remotion'
import { readWords } from './transcribe'
import { writeSrt } from '../services/captions'
import { channelIntroProps, renderCompanies, yearCardsFor } from './overlays'
import { readTimings } from './audio'
import { musicTurn, planMusic, prepareMusic } from './music'
import type { Step, StepContext } from './types'

let musicFolderFor: (channelId: number) => string = () => ''
export function configureMusic(resolve: (channelId: number) => string): void {
  musicFolderFor = resolve
}

/** File path inside the project → URL template the render worker resolves. */
function url(projectDir: string, file: string): string {
  return `{{root}}/${relative(projectDir, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

/** Opening, dramatic and closing tracks, placed on the scenes of the script. */
async function musicFor(
  video: Video,
  scenes: Scene[],
  durationSec: number,
  ctx: StepContext
): Promise<Awaited<ReturnType<typeof prepareMusic>>> {
  const folder = musicFolderFor(video.channel_id)
  if (!folder || !existsSync(folder)) return []
  let turn = video.script?.music_turn
  if (video.script && turn === undefined) {
    try {
      turn = await musicTurn(video.script, video.topic, ctx)
      // Fresh copy: the company check may have changed the script since this step began.
      const script = getVideo(video.id).script ?? video.script
      updateVideo(video.id, { script: { ...script, music_turn: turn } })
    } catch (e) {
      if (ctx.signal.aborted) throw e
      ctx.log(
        `Sem ponto de virada da música (${(e as Error).message}); sem trilha dramática`,
        'warn'
      )
    }
  }
  const turnScene = turn ? scenes.find((s) => s.index === turn) : undefined
  const outro = video.script?.outro && scenes.length > 2 ? scenes[scenes.length - 1] : undefined
  const parts = planMusic(turnScene?.start_sec ?? null, outro?.start_sec ?? null, durationSec)
  ctx.log(
    `Música em ${parts.length} parte(s): ${parts.map((p) => `${p.mood} ${Math.round(p.from)}s`).join(', ')}${turn ? ` (virada na cena ${turn})` : ''}`
  )
  return prepareMusic(parts, folder, video.id, ctx)
}

export const renderStep: Step = {
  type: 'render',
  status: 'RENDERING',
  async run(videoId, ctx) {
    const video = getVideo(videoId)
    const pd = ctx.projectDir
    if (!isValidFile(video.audio_path)) throw new Error('Narração não encontrada; refaça o áudio')
    const scenes = listScenes(videoId)
    const missing = scenes.filter((s) => !isValidFile(s.asset_path) || s.start_sec === null)
    if (missing.length)
      throw new Error(`${missing.length} cena(s) sem mídia ou tempo; refaça as cenas`)

    const renderScenes = await Promise.all(
      scenes.map(async (s, i) => {
        const isVideo = s.asset_type === 'stock_video' || s.asset_type === 'ai_video'
        return {
          src: url(pd, s.asset_path as string),
          type: isVideo ? ('video' as const) : ('image' as const),
          start: s.start_sec as number,
          end: s.end_sec as number,
          motion: (i * 7 + videoId) % 4,
          clipDuration: isVideo ? await probeDuration(s.asset_path as string) : undefined
        }
      })
    )
    const words = readWords(pd)
    // Long videos get real YouTube subtitles from this file; burned-in captions are optional.
    writeSrt(words, join(pd, 'captions.srt'))
    const companies = await renderCompanies(video, ctx)
    const yearCards = yearCardsFor(scenes, pd)
    if (companies.length || yearCards.length)
      ctx.log(
        `Sobreposições: ${companies.map((c) => `${c.name}${c.logo ? '' : ' (sem logo)'}`).join(', ') || 'sem empresas'}; ${yearCards.length} cartão(ões) de ano`
      )
    const firstScene = scenes[0]
    const introSec = companies.length
      ? Math.min(3, Math.max(0, (firstScene.end_sec ?? 3) - (firstScene.start_sec ?? 0) - 0.5))
      : 0
    const timings = readTimings(pd)
    const channelIntro = timings?.intro
      ? { ...channelIntroProps(video.channel_id, ctx.settings, pd), ...timings.intro }
      : undefined
    if (channelIntro && scenes[1]?.start_sec != null) {
      // Hold the intro until the year card (or the next scene) is fully over it, so the
      // hook's image never flashes between them. The card fades in over 0.3 s, the intro
      // fades out over its last 0.4 s, underneath.
      const card = yearCards.find((c) => c.at === scenes[1].start_sec)
      const until = card ? card.at - card.duration + 0.7 : scenes[1].start_sec + 0.4
      channelIntro.duration = Math.max(channelIntro.duration, until - channelIntro.start)
    }
    const hookEnd = firstScene.end_sec ?? 0
    const teaserText = video.script?.teaser?.trim()
    const narrationSec = await probeDuration(video.audio_path as string)
    const durationSec = narrationSec + 0.5 + END_SCREEN_SEC
    const music = await musicFor(video, scenes, durationSec, ctx)
    if (!music.length) ctx.log('Sem música na pasta do canal; vídeo sairá só com narração', 'warn')
    const props: VideoProps = {
      fps: 30,
      // Black screen with only the music at the end, where YouTube shows the end screen.
      durationSec,
      endScreenAt: narrationSec + 0.5,
      narration: url(pd, video.audio_path as string),
      scenes: renderScenes,
      words,
      captions: ctx.settings.captionsEnabled,
      music: await Promise.all(
        music.map(async (m) => ({
          src: url(pd, m.file),
          from: m.part.from,
          to: m.part.to,
          duration: await probeDuration(m.file)
        }))
      ),
      musicVolume: ctx.settings.musicVolume,
      template: (video.template as TemplateId) ?? 'documentary',
      companies,
      yearCards,
      introSec,
      teaser: teaserText
        ? { text: teaserText, end: Math.max(0, (channelIntro?.start ?? hookEnd) - 0.2) }
        : undefined,
      channelIntro
    }

    // Skip when the same inputs already produced a valid video.
    const out = join(pd, 'video.mp4')
    // The drawing code counts too, so a fix in remotion/ renders the video again.
    const hash = createHash('sha1')
      .update(JSON.stringify(props))
      .update(remotionCodeHash())
      .digest('hex')
    const hashFile = join(pd, 'render.hash')
    if (
      isValidFile(out, 100_000) &&
      existsSync(hashFile) &&
      readFileSync(hashFile, 'utf8') === hash
    ) {
      ctx.log('Vídeo já renderizado com as mesmas entradas; pulando')
      updateVideo(videoId, { video_path: out })
      return
    }

    const tmp = join(pd, 'video.rendering.mp4')
    rmSync(tmp, { force: true })
    ctx.log(
      `Render: ${scenes.length} cenas, template ${props.template}, ${(props.durationSec / 60).toFixed(1)} min`
    )
    const started = Date.now()
    await runRender(
      { mode: 'video', root: pd, out: tmp, video: props },
      join(pd, 'render-job.json'),
      { progress: ctx.progress, log: (m) => ctx.log(m), signal: ctx.signal }
    )
    rmSync(out, { force: true })
    renameSync(tmp, out)
    writeFileSync(hashFile, hash)
    updateVideo(videoId, { video_path: out })
    ctx.log(`Render concluído em ${Math.round((Date.now() - started) / 60000)} min`)
  }
}
