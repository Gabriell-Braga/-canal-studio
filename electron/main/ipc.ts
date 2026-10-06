import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { JobType, Script, Settings, VideoPatch } from '../../shared/types'
import {
  deleteVideo,
  notify,
  findVideo,
  getScene,
  jobsForVideo,
  listScenes,
  listVideos,
  logsAfter,
  logsForVideo,
  replaceScenes,
  updateScene,
  updateVideo,
  cancelPendingJobs
} from '../db/repo'
import { getSettings, setSettings } from '../db/settings'
import type { Pipeline } from '../pipeline'
import type { Scheduler } from '../queue/scheduler'
import { checkAll, installService, startService } from '../services/checks'
import { dataDir, projectDir, setDataDir } from './paths'
import { assignAi, assignStock, prepareComfy, useLocalFile } from '../steps/scenes'
import { freeComfy } from '../services/comfy'
import {
  connect as connectYoutube,
  disconnect as disconnectYoutube,
  readStats,
  refreshStats
} from '../services/youtube'
import { pythonGet, pythonPost } from '../services/python'
import { join } from 'path'

type Handler = (...args: never[]) => unknown

export const handlers: Record<string, Handler> = {}

/** Later phases add handlers through this, so each feature registers its own channels. */
export function handle(channel: string, fn: Handler): void {
  handlers[channel] = fn
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (_event, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
}

export function registerIpc(
  pipeline: Pipeline,
  scheduler: Scheduler,
  onSettingsChanged: (s: Settings) => void
): void {
  handle('services:check', () => checkAll())
  handle('services:start', (id: string) => startService(id))
  handle('services:install', (id: string) => installService(id))

  handle('videos:list', () => listVideos())
  handle('videos:get', (id: number) => {
    const video = findVideo(id)
    if (!video) return null
    return { video, scenes: listScenes(id), jobs: jobsForVideo(id), logs: logsForVideo(id) }
  })
  handle('videos:addTopics', (topics: string[], durationMin?: number) =>
    pipeline.addTopics(topics, durationMin)
  )
  handle('videos:generateScripts', (ids?: number[]) => pipeline.generateScripts(ids))
  handle('videos:approveScripts', (ids: number[]) => pipeline.approveScripts(ids))
  handle('videos:redoScript', (id: number) => pipeline.redoScript(id))
  handle('videos:update', (id: number, patch: VideoPatch) => {
    const allowed: (keyof VideoPatch)[] = [
      'title',
      'description',
      'tags',
      'script',
      'scheduled_at',
      'synthetic_content',
      'chosen_thumbnail',
      'template',
      'niche',
      'duration_target_min'
    ]
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([k]) => allowed.includes(k as keyof VideoPatch))
    )
    const video = updateVideo(id, clean)
    // Scenes mirror the script; asset choices are rebuilt by the scenes step.
    if (clean.script) replaceScenes(id, clean.script as Script)
    return video
  })
  handle('videos:remove', (id: number) => {
    for (const job of jobsForVideo(id)) if (job.status === 'running') scheduler.cancel(job.id)
    cancelPendingJobs(id)
    deleteVideo(id)
  })
  handle('videos:retryFrom', (id: number, step: JobType) => pipeline.retryFrom(id, step))
  handle('videos:approveFinal', (id: number) => pipeline.approveFinal(id))
  handle('videos:rejectFinal', (id: number, step: JobType) => pipeline.rejectFinal(id, step))
  handle('videos:nextSlot', () => pipeline.nextSlot())
  handle('videos:rerender', (id: number) => pipeline.rerender(id))

  // Scene actions on the detail screen. GPU ones refuse while the queue uses the GPU.
  const sceneDir = (sceneId: number): string =>
    join(projectDir(getScene(sceneId).video_id), 'scenes')
  handle('scenes:nextStock', async (id: number) => {
    const s = getSettings()
    if (!s.pexelsApiKey) throw new Error('Configure a chave da Pexels em Configurações')
    const scene = getScene(id)
    const tried = scene.asset_source ? [scene.asset_source] : []
    const ok = await assignStock(scene, sceneDir(id), s, tried)
    if (!ok) throw new Error('Nenhum outro resultado na Pexels para estas palavras-chave')
    return getScene(id)
  })
  handle('scenes:generateAi', async (id: number) => {
    if (scheduler.gpuBusy())
      throw new Error('A GPU está ocupada com a fila. Pause a fila ou espere terminar.')
    const s = getSettings()
    await prepareComfy(s)
    try {
      await assignAi(getScene(id), sceneDir(id), s)
    } finally {
      await freeComfy(s.comfyUrl)
    }
    return getScene(id)
  })
  handle('scenes:pickFile', async (id: number) => {
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'Escolha uma imagem ou vídeo para a cena',
      properties: ['openFile'] as 'openFile'[],
      filters: [
        {
          name: 'Imagens e vídeos',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm']
        }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return useLocalFile(id, result.filePaths[0], projectDir(getScene(id).video_id))
  })

  handle(
    'scenes:update',
    (id: number, patch: { narration?: string; visual_keywords?: string; image_prompt?: string }) =>
      updateScene(id, {
        narration: patch.narration,
        visual_keywords: patch.visual_keywords,
        image_prompt: patch.image_prompt
      })
  )
  handle('scenes:unlock', (id: number) => updateScene(id, { locked: false }))

  handle('queue:state', () => scheduler.state())
  handle('queue:runNow', () => scheduler.runNow())
  handle('queue:pause', () => scheduler.pause())
  handle('queue:resume', () => scheduler.resume())
  handle('queue:cancelJob', (id: number) => scheduler.cancel(id))
  handle('queue:logs', (afterId?: number) => logsAfter(afterId ?? 0))

  handle('settings:get', () => getSettings())
  handle('settings:set', (patch: Partial<Settings>) => {
    const next = setSettings(patch)
    onSettingsChanged(next)
    scheduler.kick()
    return next
  })
  handle('youtube:connect', async () => {
    try {
      const title = await connectYoutube()
      notify('channel')
      return { ok: true, message: `Conectado ao canal ${title}` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })
  handle('youtube:disconnect', () => {
    disconnectYoutube()
    notify('channel')
  })
  handle('youtube:stats', async (refresh?: boolean) => {
    if (refresh) await refreshStats()
    return readStats()
  })

  handle('settings:dataDir', () => dataDir())
  handle('settings:voices', async () => (await pythonGet<{ voices: string[] }>('/voices')).voices)
  handle('settings:voiceSample', async () => {
    const s = getSettings()
    const out = join(dataDir(), 'amostra-voz.wav')
    await pythonPost('/tts', {
      text: 'In 1872, a ship was found drifting in the Atlantic. Her crew had vanished without a trace.',
      voice: s.voice,
      speed: s.voiceSpeed,
      out_path: out
    })
    return out
  })
  handle('settings:chooseDataDir', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'Escolha a pasta de dados',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    setDataDir(result.filePaths[0])
    return result.filePaths[0]
  })
}
