import { join } from 'path'
import { getVideo, listVideos, updateVideo } from '../db/repo'
import { isValidFile, runTool } from '../services/ffmpeg'
import { nextFreeSlot } from '../queue/slots'
import { canUploadCaptions, setThumbnail, uploadCaptions, uploadVideo } from '../services/youtube'
import type { Settings, Video } from '../../shared/types'
import type { Step, StepContext } from './types'

export const uploadStep: Step = {
  type: 'upload',
  status: 'SCHEDULED',
  async run(videoId, ctx) {
    let video = getVideo(videoId)
    // The second human approval is the only way into SCHEDULED; never upload without it.
    if (video.status !== 'SCHEDULED') throw new Error('Upload só depois da aprovação final')
    if (!isValidFile(video.video_path, 100_000)) throw new Error('Arquivo de vídeo não encontrado')

    // A short points to its full video, so that one has to be on YouTube first.
    let description = video.description ?? ''
    if (video.kind === 'short') {
      const parent = video.parent_id ? getVideo(video.parent_id) : null
      if (!parent?.youtube_id) {
        throw new Error('O vídeo completo ainda não foi enviado; o short sobe depois dele')
      }
      const link = `https://youtu.be/${parent.youtube_id}`
      description = `▶ Watch the full video: ${link}\n\n${description}\n\n#shorts`.trim()
      if (parent.scheduled_at && video.scheduled_at && video.scheduled_at < parent.scheduled_at) {
        video = updateVideo(videoId, {
          scheduled_at: new Date(
            new Date(parent.scheduled_at).getTime() + 24 * 3600_000
          ).toISOString()
        })
      }
    }

    // publishAt must be in the future. If the slot passed while waiting, take the next free one.
    const minTime = Date.now() + 15 * 60_000
    if (
      video.kind === 'long' &&
      (!video.scheduled_at || new Date(video.scheduled_at).getTime() < minTime)
    ) {
      const s = ctx.settings
      const taken = listVideos(video.channel_id)
        .filter(
          (v) =>
            v.id !== videoId &&
            v.kind === 'long' &&
            v.scheduled_at &&
            ['SCHEDULED', 'PUBLISHED'].includes(v.status)
        )
        .map((v) => v.scheduled_at as string)
      const slot = nextFreeSlot(s.publishSlots, s.publishTimezone, taken)
      ctx.log(
        `Horário anterior já passou; novo horário ${new Date(slot).toLocaleString('pt-BR')}`,
        'warn'
      )
      video = updateVideo(videoId, { scheduled_at: slot })
    }

    if (!video.youtube_id) {
      ctx.log(
        `Enviando vídeo como privado, publicação em ${new Date(video.scheduled_at as string).toLocaleString('pt-BR')}`
      )
      const id = await uploadVideo(
        {
          channelId: video.channel_id,
          file: video.video_path as string,
          thumbnail: null,
          title: video.title ?? video.topic,
          description,
          tags: video.tags,
          publishAt: video.scheduled_at as string,
          synthetic: video.synthetic_content
        },
        (p) => ctx.progress(p * 0.9)
      )
      video = updateVideo(videoId, { youtube_id: id })
      ctx.log(`Enviado: https://youtu.be/${id}`)
      if (!ctx.settings.youtubeAudited) {
        ctx.log(
          'Projeto do Google Cloud sem auditoria da API: o YouTube trava este vídeo como privado e ignora o agendamento. Publique ou agende no YouTube Studio.',
          'warn'
        )
      }
    }

    await sendExtras(video, ctx.projectDir, ctx.settings, ctx.log, ctx.signal)
    ctx.progress(1)
  }
}

/**
 * Subtitles and the custom thumbnail of an uploaded video. Each one only warns on failure,
 * so the upload still counts; "Reenviar thumbnail e legendas" runs this again later.
 */
export async function sendExtras(
  video: Video,
  projectDir: string,
  settings: Settings,
  log: StepContext['log'],
  signal?: AbortSignal
): Promise<void> {
  // Exact subtitles from the narration timings (YouTube's own captions, not burned in).
  const srt = join(projectDir, 'captions.srt')
  if (video.kind === 'long' && settings.youtubeCaptions && isValidFile(srt, 10)) {
    if (!canUploadCaptions(video.channel_id)) {
      log(
        'Legendas não enviadas: reconecte o YouTube uma vez para liberar o envio de legendas',
        'warn'
      )
    } else {
      try {
        await uploadCaptions(video.channel_id, video.youtube_id as string, srt)
        log('Legendas em inglês enviadas ao YouTube')
      } catch (error) {
        log(`Legendas não enviadas: ${(error as Error).message}`, 'warn')
      }
    }
  }

  // Custom thumbnails cannot be set on shorts.
  const thumb =
    video.kind === 'short' ? undefined : video.thumbnail_paths[video.chosen_thumbnail ?? 0]
  if (thumb && isValidFile(thumb)) {
    // YouTube limits custom thumbnails to 2 MB; JPEG keeps 1280x720 well under it.
    const jpeg = join(projectDir, 'thumbs', 'upload.jpg')
    await runTool('ffmpeg', ['-y', '-i', thumb, '-q:v', '3', jpeg], signal)
    try {
      await setThumbnail(video.channel_id, video.youtube_id as string, jpeg)
      log('Thumbnail enviada')
    } catch (error) {
      // Custom thumbnails need a verified channel (phone verification).
      log(
        `Thumbnail não enviada: ${(error as Error).message}. Verifique o canal por telefone no YouTube.`,
        'warn'
      )
    }
  }
}
