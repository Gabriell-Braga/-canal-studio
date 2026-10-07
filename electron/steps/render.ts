import { createHash } from 'crypto'
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { extname, join, relative } from 'path'
import type { TemplateId, VideoProps } from '../../shared/render'
import { getVideo, listScenes, updateVideo } from '../db/repo'
import { isValidFile, probeDuration } from '../services/ffmpeg'
import { runRender } from '../services/remotion'
import { readWords } from './transcribe'
import { writeSrt } from '../services/captions'
import { renderCompanies, yearCardsFor } from './overlays'
import type { Step } from './types'

const MUSIC_EXT = ['.mp3', '.wav', '.m4a', '.ogg']

let musicFolderFor: (channelId: number) => string = () => ''
export function configureMusic(resolve: (channelId: number) => string): void {
  musicFolderFor = resolve
}

/** File path inside the project → URL template the render worker resolves. */
function url(projectDir: string, file: string): string {
  return `{{root}}/${relative(projectDir, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

/** Copy one track from dados/musica into the project (stable per video). */
function pickMusic(projectDir: string, videoId: number, channelId: number): string | null {
  const musicFolder = musicFolderFor(channelId)
  const existing = readdirSync(projectDir).find((f) => f.startsWith('music.'))
  if (existing) return join(projectDir, existing)
  if (!musicFolder || !existsSync(musicFolder)) return null
  const tracks = readdirSync(musicFolder).filter((f) =>
    MUSIC_EXT.includes(extname(f).toLowerCase())
  )
  if (!tracks.length) return null
  const track = tracks[videoId % tracks.length]
  const out = join(projectDir, `music${extname(track).toLowerCase()}`)
  copyFileSync(join(musicFolder, track), out)
  return out
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

    const music = pickMusic(pd, videoId, video.channel_id)
    if (!music) ctx.log('Sem música na pasta do canal; vídeo sairá só com narração', 'warn')

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
    const props: VideoProps = {
      fps: 30,
      durationSec: (await probeDuration(video.audio_path as string)) + 0.5,
      narration: url(pd, video.audio_path as string),
      scenes: renderScenes,
      words,
      captions: ctx.settings.captionsEnabled,
      music: music ? url(pd, music) : null,
      musicVolume: ctx.settings.musicVolume,
      template: (video.template as TemplateId) ?? 'documentary',
      companies,
      yearCards,
      introSec
    }

    // Skip when the same inputs already produced a valid video.
    const out = join(pd, 'video.mp4')
    const hash = createHash('sha1').update(JSON.stringify(props)).digest('hex')
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
