export type ServiceId =
  | 'node'
  | 'python'
  | 'git'
  | 'ffmpeg'
  | 'gpu'
  | 'ollama'
  | 'ollamaModel'
  | 'comfyui'
  | 'pythonServer'
  | 'espeak'

export type ServiceState = 'ok' | 'warning' | 'missing'

export interface ServiceStatus {
  id: ServiceId
  name: string
  state: ServiceState
  version?: string
  detail?: string
  hint?: string
  canStart?: boolean
}

export interface StartResult {
  ok: boolean
  message: string
}

export interface Api {
  services: {
    check: () => Promise<ServiceStatus[]>
    start: (id: string) => Promise<StartResult>
  }
}
