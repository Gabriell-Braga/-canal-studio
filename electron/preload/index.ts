import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Api } from '../../shared/types'

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const api: Api = {
  channels: {
    list: invoke('channels:list'),
    create: invoke('channels:create'),
    update: invoke('channels:update'),
    remove: invoke('channels:remove'),
    musicDir: invoke('channels:musicDir'),
    openMusicDir: invoke('channels:openMusicDir')
  },
  services: {
    check: invoke('services:check'),
    start: invoke('services:start'),
    install: invoke('services:install')
  },
  videos: {
    list: invoke('videos:list'),
    get: invoke('videos:get'),
    addTopics: invoke('videos:addTopics'),
    generateScripts: invoke('videos:generateScripts'),
    approveScripts: invoke('videos:approveScripts'),
    redoScript: invoke('videos:redoScript'),
    update: invoke('videos:update'),
    remove: invoke('videos:remove'),
    retryFrom: invoke('videos:retryFrom'),
    approveFinal: invoke('videos:approveFinal'),
    rerender: invoke('videos:rerender'),
    rejectFinal: invoke('videos:rejectFinal'),
    nextSlot: invoke('videos:nextSlot')
  },
  scenes: {
    update: invoke('scenes:update'),
    nextStock: invoke('scenes:nextStock'),
    generateAi: invoke('scenes:generateAi'),
    pickFile: invoke('scenes:pickFile'),
    unlock: invoke('scenes:unlock')
  },
  queue: {
    state: invoke('queue:state'),
    runNow: invoke('queue:runNow'),
    pause: invoke('queue:pause'),
    resume: invoke('queue:resume'),
    cancelJob: invoke('queue:cancelJob'),
    logs: invoke('queue:logs')
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
    voiceSample: invoke('settings:voiceSample'),
    voices: invoke('settings:voices'),
    dataDir: invoke('settings:dataDir'),
    chooseDataDir: invoke('settings:chooseDataDir')
  },
  youtube: {
    connect: invoke('youtube:connect'),
    disconnect: invoke('youtube:disconnect'),
    stats: invoke('youtube:stats')
  },
  onChanged: (callback) => {
    const listener = (_: unknown, topic: string): void => callback(topic)
    ipcRenderer.on('changed', listener)
    return () => ipcRenderer.removeListener('changed', listener)
  }
} as Api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
