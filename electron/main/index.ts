import {
  app,
  shell,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  nativeImage,
  powerSaveBlocker
} from 'electron'
import { existsSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import windowIcon from '../../resources/icon.ico?asset'
import type { Settings } from '../../shared/types'
import { closeDb, openDb } from '../db'
import {
  changes,
  deleteVideo,
  findVideo,
  listChannels,
  listShorts,
  updateVideo,
  videosByStatus
} from '../db/repo'
import { getSettings, getState, setState } from '../db/settings'
import { Pipeline } from '../pipeline'
import { Scheduler, type QueueEvent } from '../queue/scheduler'
import { refreshPath } from '../services/exec'
import { readVram } from '../services/gpu'
import { steps } from '../steps'
import { configurePython, ensurePython, hasVenv, stopPython } from '../services/python'
import { configureRemotion } from '../services/remotion'
import { configureMusic } from '../steps/render'
import { configureStockCache } from '../services/stock'
import { configureLlm } from '../services/llm'
import {
  configureYoutube,
  isConnected as isYoutubeConnected,
  readStats,
  refreshLive,
  refreshStats
} from '../services/youtube'
import { registerIpc } from './ipc'
import { handleMedia, registerMediaScheme } from './media'
import { appRoot, channelDir, channelMusicDir, dataDir, projectDir } from './paths'

const isE2E = process.env.CANAL_E2E === '1'
const startHidden = process.argv.includes('--hidden')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let powerBlockId: number | null = null
let scheduler: Scheduler

/** When this build was made; a newer build started later takes over from this one. */
const BUILD_ID = (() => {
  try {
    return statSync(__filename).mtimeMs
  } catch {
    return 0
  }
})()

if (!isE2E && !app.requestSingleInstanceLock({ buildId: BUILD_ID })) {
  app.quit()
}
registerMediaScheme()
if (isE2E && process.env.CANAL_DATA_DIR) {
  // Keep test runs away from the real profile (and from a running dev instance).
  app.setPath('userData', join(process.env.CANAL_DATA_DIR, 'electron-profile'))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Canal Studio',
    // .ico carries hand-made 16-32 px sizes, which stay sharp in the title bar and taskbar.
    icon: process.platform === 'win32' ? windowIcon : icon,
    backgroundColor: '#15161d',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#15161d', symbolColor: '#9feaf9', height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // E2E runs must not steal focus from whatever the user is doing.
    if (isE2E) mainWindow?.showInactive()
    else if (!startHidden) mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (!quitting && !isE2E && getSettings().minimizeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow) createWindow()
  mainWindow?.show()
  mainWindow?.focus()
}

function quit(): void {
  quitting = true
  app.quit()
}

function buildTray(): void {
  if (isE2E) return
  tray = new Tray(
    process.platform === 'win32'
      ? windowIcon
      : nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  )
  tray.setToolTip('Canal Studio')
  tray.on('click', showWindow)
  refreshTrayMenu()
}

function refreshTrayMenu(): void {
  if (!tray) return
  const paused = scheduler?.paused ?? false
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Canal Studio', click: showWindow },
      { type: 'separator' },
      paused
        ? { label: 'Retomar fila', click: () => (scheduler.resume(), refreshTrayMenu()) }
        : { label: 'Pausar fila', click: () => (scheduler.pause(), refreshTrayMenu()) },
      { label: 'Rodar agora', click: () => scheduler.runNow() },
      { type: 'separator' },
      { label: 'Sair', click: quit }
    ])
  )
}

function notify(title: string, body: string): void {
  if (isE2E || !Notification.isSupported()) return
  const n = new Notification({ title, body, icon })
  n.on('click', showWindow)
  n.show()
}

function onQueueEvent(event: QueueEvent): void {
  switch (event.type) {
    case 'scripts-ready':
      notify('Roteiros prontos', `${event.count} roteiro(s) esperando revisão.`)
      break
    case 'final-ready':
      notify('Vídeo pronto', `"${event.title}" está pronto para a revisão final.`)
      break
    case 'error':
      notify('Erro na produção', event.message.slice(0, 200))
      break
    case 'night-summary':
      if (event.finalReady || event.errors) {
        notify(
          'Resumo da madrugada',
          `${event.finalReady} vídeo(s) prontos para revisão final` +
            (event.errors ? `, ${event.errors} com erro.` : '.')
        )
      }
      break
  }
}

function onBusyChange(busy: boolean): void {
  if (busy && powerBlockId === null) {
    powerBlockId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!busy && powerBlockId !== null) {
    powerSaveBlocker.stop(powerBlockId)
    powerBlockId = null
  }
}

function applySettings(s: Settings): void {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: s.startWithWindows, args: ['--hidden'] })
  }
  refreshTrayMenu()
}

/** Coalesce DB change bursts into one message per topic for the UI. */
function forwardChanges(): void {
  const pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  changes.on('change', (topic: string) => {
    pending.add(topic)
    timer ??= setTimeout(() => {
      timer = null
      for (const t of pending) {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('changed', t)
      }
      pending.clear()
    }, 150)
  })
}

/** Live view counts every hour, full analytics once a day, while the app is open. */
function scheduleStatsRefresh(): void {
  if (isE2E) return
  const check = (): void => {
    for (const channel of listChannels()) {
      if (!isYoutubeConnected(channel.id)) continue
      const last = readStats(channel.id).updatedAt
      if (!last || Date.now() - new Date(last).getTime() > 24 * 3600_000) {
        refreshStats(channel.id).catch((e) => console.error('Analytics:', e.message))
      } else {
        refreshLive(channel.id).catch((e) => console.error('Live stats:', e.message))
      }
    }
  }
  setTimeout(check, 60_000)
  setInterval(check, 3600_000)
}

app.on('second-instance', (_event, _argv, _cwd, data) => {
  const newer = (data as { buildId?: number } | undefined)?.buildId ?? 0
  if (newer > BUILD_ID) {
    // The shortcut was opened after an update: restart on the new build instead of
    // bringing back this old window. Running jobs go back to the queue on restart.
    quitting = true
    scheduler?.stop()
    stopPython()
    app.relaunch()
    app.exit(0)
    return
  }
  showWindow()
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('app.canalstudio')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Tools installed after Windows started this process (winget) are only on the registry PATH.
  await refreshPath()
  openDb(join(dataDir(), 'canal.db'))
  handleMedia(() => [dataDir()])
  configureRemotion(appRoot())
  configureMusic(channelMusicDir)
  configureStockCache(join(dataDir(), 'cache', 'stock'))
  configureYoutube({ channelDir })
  configureLlm({
    skillFile: join(appRoot(), '.claude', 'skills', 'documentary-scriptwriter', 'SKILL.md')
  })
  configurePython({
    serverDir: join(appRoot(), 'python'),
    venvDir: app.isPackaged
      ? join(app.getPath('userData'), 'python-venv')
      : join(appRoot(), 'python', 'venv')
  })
  // The sidecar starts with the app and stops with it.
  if (hasVenv() && process.env.CANAL_FAKE_STEPS !== '1') {
    ensurePython().catch((e) => console.error('Python sidecar:', e.message))
  }
  scheduler = new Scheduler({
    steps,
    projectDir,
    onBusyChange,
    onEvent: onQueueEvent,
    onShortsDone: (id) => pipeline.approveShorts(id),
    onThumbnails: (id) => pipeline.refreshShortThumbs(id),
    getVram: readVram,
    tickMs: Number(process.env.CANAL_TICK_MS) || 5000
  })
  const pipeline = new Pipeline(scheduler)
  pipeline.approveAllShorts()
  // Once: every video not public yet is made again with the teaser and channel intro.
  if (!getState('reprocess.teaser', false) && process.env.CANAL_FAKE_STEPS !== '1') {
    const done = pipeline.reprocessAll()
    console.log(`Reprocess: ${done.videos} video(s), ${done.replaced} to replace on YouTube`)
    setState('reprocess.teaser', true)
  }
  // Once: videos in final review render again with checked company values and no gap
  // after the channel intro. Scenes stay as they are.
  if (!getState('reprocess.badges3', false) && process.env.CANAL_FAKE_STEPS !== '1') {
    const videos = [...videosByStatus('FINAL_REVIEW'), ...videosByStatus('RENDERING')].filter(
      (v) => v.kind === 'long' && v.script && v.thumbnail_paths.length
    )
    for (const v of videos) {
      updateVideo(v.id, { script: { ...v.script!, companiesChecked: false } })
      pipeline.rerender(v.id)
    }
    console.log(`Re-render for badges: ${videos.length} video(s)`)
    setState('reprocess.badges3', true)
  }
  // Once: unpublished videos that drew a dark track (now moved to musica/_sombrias)
  // get a new track and render again.
  if (!getState('reprocess.music', false) && process.env.CANAL_FAKE_STEPS !== '1') {
    let count = 0
    for (const v of [...videosByStatus('FINAL_REVIEW'), ...videosByStatus('RENDERING')]) {
      const dark = join(channelMusicDir(v.channel_id), '_sombrias')
      const music = join(projectDir(v.id), 'music.mp3')
      if (v.kind !== 'long' || !existsSync(dark) || !existsSync(music)) continue
      const size = statSync(music).size
      if (!readdirSync(dark).some((f) => statSync(join(dark, f)).size === size)) continue
      rmSync(music)
      pipeline.rerender(v.id)
      count++
    }
    console.log(`Re-render for music: ${count} video(s)`)
    setState('reprocess.music', true)
  }
  // Once: every full video not public yet renders again with the logo fix and music in
  // parts (opening, dramatic, closing). The old single track is dropped so every part is
  // picked and leveled the same way. Scheduled copies were deleted on YouTube by hand, so
  // they lose their id and go back to final review for a new upload.
  if (!getState('reprocess.music3', false) && process.env.CANAL_FAKE_STEPS !== '1') {
    const videos = ['FINAL_REVIEW', 'RENDERING', 'SCHEDULED'] as const
    let count = 0
    for (const v of videos.flatMap((s) => videosByStatus(s))) {
      if (v.kind !== 'long' || !v.script || !v.thumbnail_paths.length) continue
      const dir = projectDir(v.id)
      for (const f of readdirSync(dir)) if (/^music[.-]/.test(f)) rmSync(join(dir, f))
      if (v.youtube_id) updateVideo(v.id, { youtube_id: null, scheduled_at: null })
      pipeline.rerender(v.id)
      count++
    }
    console.log(`Re-render for music in parts: ${count} video(s)`)
    setState('reprocess.music3', true)
  }
  // Once: MySpace showed Meta's logo for Google (logos were kept by position, so the old
  // company's file stayed after the list changed) and Xerox's video listed only Apple.
  // Both render again; Xerox gets its companies checked again.
  if (!getState('reprocess.logos', false) && process.env.CANAL_FAKE_STEPS !== '1') {
    for (const id of [9, 11]) {
      const v = findVideo(id)
      if (!v || v.kind !== 'long' || v.status === 'PUBLISHED' || !v.script) continue
      if (id === 11) updateVideo(id, { script: { ...v.script, companiesChecked: false } })
      pipeline.rerender(id)
    }
    setState('reprocess.logos', true)
  }
  // Once: scene images are now cropped around the subject. Full videos not on YouTube yet
  // render again and keep their slot; their shorts render again via refreshAllShortThumbs.
  if (!getState('reprocess.focus', false) && process.env.CANAL_FAKE_STEPS !== '1') {
    let count = 0
    for (const v of [...videosByStatus('FINAL_REVIEW'), ...videosByStatus('SCHEDULED')]) {
      if (v.kind !== 'long' || v.youtube_id || !v.video_path) continue
      if (v.status === 'SCHEDULED') setState(`keepSchedule.${v.id}`, true)
      pipeline.rerender(v.id)
      count++
    }
    console.log(`Re-render for framing: ${count} video(s)`)
    setState('reprocess.focus', true)
  }
  // A short whose render failed and that a later cut already replaced is left over: drop it.
  for (const v of videosByStatus('ERROR')) {
    const siblings = v.kind === 'short' && v.parent_id ? listShorts(v.parent_id) : []
    if (!v.video_path && siblings.some((s) => s.id !== v.id && s.created_at > v.created_at)) {
      deleteVideo(v.id)
    }
  }
  pipeline.refreshAllShortThumbs()
  registerIpc(pipeline, scheduler, applySettings)
  forwardChanges()

  createWindow()
  buildTray()
  applySettings(getSettings())
  scheduler.start()
  scheduleStatsRefresh()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
  scheduler?.stop()
})

app.on('will-quit', () => {
  stopPython()
  closeDb()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
