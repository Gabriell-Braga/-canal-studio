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
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import windowIcon from '../../resources/icon.ico?asset'
import type { Settings } from '../../shared/types'
import { closeDb, openDb } from '../db'
import { changes, listChannels } from '../db/repo'
import { getSettings } from '../db/settings'
import { Pipeline } from '../pipeline'
import { Scheduler, type QueueEvent } from '../queue/scheduler'
import { refreshPath } from '../services/exec'
import { readVram } from '../services/gpu'
import { steps } from '../steps'
import { configurePython, ensurePython, hasVenv, stopPython } from '../services/python'
import { configureRemotion } from '../services/remotion'
import { configureMusic } from '../steps/render'
import { isConnected as isYoutubeConnected, readStats, refreshStats } from '../services/youtube'
import { registerIpc } from './ipc'
import { handleMedia, registerMediaScheme } from './media'
import { appRoot, channelMusicDir, dataDir, projectDir } from './paths'

const isE2E = process.env.CANAL_E2E === '1'
const startHidden = process.argv.includes('--hidden')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let powerBlockId: number | null = null
let scheduler: Scheduler

if (!isE2E && !app.requestSingleInstanceLock()) {
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

/** Channel analytics once a day (checked hourly) while the app is open. */
function scheduleStatsRefresh(): void {
  if (isE2E) return
  const check = (): void => {
    for (const channel of listChannels()) {
      if (!isYoutubeConnected(channel.id)) continue
      const last = readStats(channel.id).updatedAt
      if (!last || Date.now() - new Date(last).getTime() > 24 * 3600_000) {
        refreshStats(channel.id).catch((e) => console.error('Analytics:', e.message))
      }
    }
  }
  setTimeout(check, 60_000)
  setInterval(check, 3600_000)
}

app.on('second-instance', showWindow)

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
    getVram: readVram,
    tickMs: Number(process.env.CANAL_TICK_MS) || 5000
  })
  const pipeline = new Pipeline(scheduler)
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
