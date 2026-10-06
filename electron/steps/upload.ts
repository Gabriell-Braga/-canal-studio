import { join } from 'path'
import { getVideo, listVideos, updateVideo } from '../db/repo'
import { isValidFile, runTool } from '../services/ffmpeg'
import { nextFreeSlot } from '../queue/slots'
import { setThumbnail, uploadVideo } from '../services/youtube'
import type { Step } from './types'

export const uploadStep: Step = {
  type: 'upload',
  status: 'SCHEDULED',
  async run(videoId, ctx) {
    let video = getVideo(videoId)
    // The second human approval is the only way into SCHEDULED; never upload without it.
    if (video.status !== 'SCHEDULED') throw new Error('Upload só depois da aprovação final')
    if (!isValidFile(video.video_path, 100_000)) throw new Error('Arquivo de vídeo não encontrado')

    // publishAt must be in the future. If the slot passed while waiting, take the next free one.
    const minTime = Date.now() + 15 * 60_000
    if (!video.scheduled_at || new Date(video.scheduled_at).getTime() < minTime) {
      const s = ctx.settings
      const taken = listVideos()
        .filter(
          (v) => v.id !== videoId && v.scheduled_at && ['SCHEDULED', 'PUBLISHED'].includes(v.status)
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
          file: video.video_path as string,
          thumbnail: null,
          title: video.title ?? video.topic,
          description: video.description ?? '',
          tags: video.tags,
          publishAt: video.scheduled_at as string,
          synthetic: video.synthetic_content
        },
        (p) => ctx.progress(p * 0.9)
      )
      video = updateVideo(videoId, { youtube_id: id })
      ctx.log(`Enviado: https://youtu.be/${id}`)
    }

    const thumb = video.thumbnail_paths[video.chosen_thumbnail ?? 0]
    if (thumb && isValidFile(thumb)) {
      // YouTube limits custom thumbnails to 2 MB; JPEG keeps 1280x720 well under it.
      const jpeg = join(ctx.projectDir, 'thumbs', 'upload.jpg')
      await runTool('ffmpeg', ['-y', '-i', thumb, '-q:v', '3', jpeg], ctx.signal)
      try {
        await setThumbnail(video.youtube_id as string, jpeg)
        ctx.log('Thumbnail enviada')
      } catch (error) {
        // Custom thumbnails need a verified channel (phone verification).
        ctx.log(
          `Thumbnail não enviada: ${(error as Error).message}. Verifique o canal por telefone no YouTube.`,
          'warn'
        )
      }
    }
    ctx.progress(1)
  }
}
