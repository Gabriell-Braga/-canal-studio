import { execFile, spawn } from 'child_process'

let cachedPath: string | null = null

/**
 * Electron inherits PATH from whoever launched it, which can be stale right after
 * a winget install. Merge in the current User and Machine PATH from the registry.
 */
export async function refreshPath(): Promise<void> {
  if (cachedPath) return
  const script =
    "[Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')"
  try {
    const fresh = await run('powershell.exe', ['-NoProfile', '-Command', script], 10000)
    const parts = new Set(
      [...(process.env.PATH ?? '').split(';'), ...fresh.stdout.trim().split(';')].filter(Boolean)
    )
    cachedPath = [...parts].join(';')
    process.env.PATH = cachedPath
  } catch {
    cachedPath = process.env.PATH ?? ''
  }
}

export interface RunResult {
  stdout: string
  stderr: string
}

export function run(file: string, args: string[], timeoutMs = 15000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export function startDetached(file: string, args: string[], cwd?: string): void {
  const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true })
  // Without a listener, a spawn failure (ENOENT) would crash the main process.
  child.on('error', (error) => console.error(`Failed to start ${file}:`, error.message))
  child.unref()
}

export async function fetchJson<T>(url: string, timeoutMs = 3000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}
