import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from './config'
import { run } from './exec'

export interface PythonPaths {
  /** Folder with server.py and requirements.txt */
  serverDir: string
  /** Virtual environment folder */
  venvDir: string
  logFile?: string
}

let paths: PythonPaths | null = null
let child: ChildProcess | null = null
let starting: Promise<void> | null = null
let lastError = ''

export function configurePython(p: PythonPaths): void {
  paths = p
}

function requirePaths(): PythonPaths {
  if (!paths) throw new Error('Python sidecar not configured')
  return paths
}

export function venvPython(): string {
  return join(requirePaths().venvDir, 'Scripts', 'python.exe')
}

export function hasVenv(): boolean {
  return paths !== null && existsSync(venvPython())
}

export function pythonLastError(): string {
  return lastError
}

export async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${config.pythonServerUrl}/health`, {
      signal: AbortSignal.timeout(2000)
    })
    return res.ok
  } catch {
    return false
  }
}

/** Start the sidecar if it is not running, and wait until /health answers. */
export function ensurePython(): Promise<void> {
  starting ??= (async () => {
    if (await isHealthy()) return
    if (!hasVenv()) throw new Error('Servidor Python não instalado. Use Serviços → Instalar.')
    const { serverDir } = requirePaths()
    lastError = ''
    child = spawn(
      venvPython(),
      ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8765'],
      { cwd: serverDir, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } }
    )
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString()
      if (/error|traceback/i.test(text)) lastError = text.slice(-2000)
    })
    child.on('error', (e) => (lastError = e.message))
    child.on('exit', () => (child = null))
    for (let i = 0; i < 120; i++) {
      if (await isHealthy()) return
      if (!child) throw new Error(`Servidor Python encerrou ao iniciar. ${lastError}`)
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error('Servidor Python não respondeu em 60 s')
  })().finally(() => {
    starting = null
  })
  return starting
}

/** Kill the sidecar and any child it spawned. Called when the app quits. */
export function stopPython(): void {
  if (child?.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  }
  child = null
}

export async function pythonPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  await ensurePython()
  const res = await fetch(`${config.pythonServerUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  const data = (await res.json().catch(() => ({}))) as { detail?: string } & T
  if (!res.ok) throw new Error(`Python ${path}: ${data.detail ?? `HTTP ${res.status}`}`)
  return data
}

export async function pythonGet<T>(path: string): Promise<T> {
  await ensurePython()
  const res = await fetch(`${config.pythonServerUrl}${path}`)
  if (!res.ok) throw new Error(`Python ${path}: HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Create the venv and install requirements. Slow (several minutes, ~1.5 GB),
 * so callers run it in the background and report progress through `onLine`.
 */
export async function installPython(onLine: (line: string) => void): Promise<void> {
  const { serverDir, venvDir } = requirePaths()
  mkdirSync(venvDir, { recursive: true })
  if (!existsSync(venvPython())) {
    onLine('Criando venv com Python 3.11…')
    await run('py', ['-3.11', '-m', 'venv', venvDir], 120_000)
  }
  await runStreaming(venvPython(), ['-m', 'pip', 'install', '--upgrade', 'pip'], onLine)
  await runStreaming(
    venvPython(),
    ['-m', 'pip', 'install', '-r', join(serverDir, 'requirements.txt')],
    onLine
  )
  onLine('Baixando pesos do Kokoro e do Whisper (aquecimento)…')
  await runStreaming(venvPython(), [join(serverDir, 'warmup.py')], onLine, serverDir)
}

function runStreaming(
  file: string,
  args: string[],
  onLine: (line: string) => void,
  cwd?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(file, args, { cwd, windowsHide: true })
    const feed = (d: Buffer): void =>
      d
        .toString()
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .forEach(onLine)
    p.stdout.on('data', feed)
    p.stderr.on('data', feed)
    p.on('error', reject)
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${file} saiu com código ${code}`))
    )
  })
}
