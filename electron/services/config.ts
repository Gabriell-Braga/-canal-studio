import { getSettings } from '../db/settings'

/** Live view of the service settings; values change when the user edits Configurações. */
export const config = {
  get ollamaUrl(): string {
    return getSettings().ollamaUrl
  },
  get ollamaModel(): string {
    return getSettings().ollamaModel
  },
  get comfyUrl(): string {
    return getSettings().comfyUrl
  },
  get comfyPath(): string {
    return getSettings().comfyPath
  },
  pythonServerUrl: 'http://127.0.0.1:8765'
}
