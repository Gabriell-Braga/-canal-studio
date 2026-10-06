import { existsSync } from 'fs'
import { join } from 'path'
import type { ServiceStatus, StartResult } from '../../shared/types'
import { config } from './config'
import { fetchJson, refreshPath, run, startDetached } from './exec'
import { addLog } from '../db/repo'
import { ensurePython, hasVenv, installPython, pythonLastError, venvPython } from './python'

let installing: string | null = null

async function firstLine(file: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await run(file, args)
  return (stdout || stderr).trim().split(/\r?\n/)[0]
}

async function checkNode(): Promise<ServiceStatus> {
  const base = { id: 'node', name: 'Node.js' } as const
  try {
    const version = await firstLine('node', ['-v'])
    const major = Number(version.replace(/^v/, '').split('.')[0])
    if (major < 20) {
      return {
        ...base,
        state: 'warning',
        version,
        hint: 'Atualize: winget install OpenJS.NodeJS.LTS'
      }
    }
    return { ...base, state: 'ok', version }
  } catch {
    return { ...base, state: 'missing', hint: 'winget install OpenJS.NodeJS.LTS' }
  }
}

async function checkPython(): Promise<ServiceStatus> {
  const base = { id: 'python', name: 'Python 3.11' } as const
  try {
    const version = await firstLine('py', ['-3.11', '--version'])
    return { ...base, state: 'ok', version: version.replace('Python ', '') }
  } catch {
    return { ...base, state: 'missing', hint: 'winget install Python.Python.3.11' }
  }
}

async function checkGit(): Promise<ServiceStatus> {
  const base = { id: 'git', name: 'Git' } as const
  try {
    const version = await firstLine('git', ['--version'])
    return { ...base, state: 'ok', version: version.replace('git version ', '') }
  } catch {
    return { ...base, state: 'missing', hint: 'winget install Git.Git' }
  }
}

async function checkFfmpeg(): Promise<ServiceStatus> {
  const base = { id: 'ffmpeg', name: 'FFmpeg' } as const
  try {
    const line = await firstLine('ffmpeg', ['-version'])
    const version = line.match(/ffmpeg version (\S+)/)?.[1] ?? line
    await firstLine('ffprobe', ['-version'])
    return { ...base, state: 'ok', version }
  } catch {
    return { ...base, state: 'missing', hint: 'winget install Gyan.FFmpeg' }
  }
}

async function checkGpu(): Promise<ServiceStatus> {
  const base = { id: 'gpu', name: 'GPU (NVIDIA)' } as const
  try {
    const line = await firstLine('nvidia-smi', [
      '--query-gpu=name,memory.used,memory.total,driver_version',
      '--format=csv,noheader,nounits'
    ])
    const [name, used, total, driver] = line.split(',').map((s) => s.trim())
    return {
      ...base,
      state: Number(total) >= 11000 ? 'ok' : 'warning',
      version: `driver ${driver}`,
      detail: `${name} · VRAM ${used}/${total} MiB em uso`
    }
  } catch {
    return {
      ...base,
      state: 'missing',
      hint: 'nvidia-smi não encontrado. Instale o driver NVIDIA.'
    }
  }
}

async function checkOllama(): Promise<ServiceStatus[]> {
  const base = { id: 'ollama', name: 'Ollama' } as const
  const modelBase = { id: 'ollamaModel', name: `Modelo ${config.ollamaModel}` } as const
  let cliVersion: string | undefined
  try {
    const out = await run('ollama', ['--version'])
    cliVersion = (out.stdout + out.stderr).match(/version is (\S+)/)?.[1]
  } catch {
    return [
      { ...base, state: 'missing', hint: 'winget install Ollama.Ollama' },
      { ...modelBase, state: 'missing', hint: 'Instale o Ollama primeiro.' }
    ]
  }
  try {
    const { version } = await fetchJson<{ version: string }>(`${config.ollamaUrl}/api/version`)
    const { models } = await fetchJson<{ models: { name: string; size: number }[] }>(
      `${config.ollamaUrl}/api/tags`
    )
    const model = models.find((m) => m.name === config.ollamaModel)
    return [
      { ...base, state: 'ok', version, detail: `Rodando em ${config.ollamaUrl}` },
      model
        ? { ...modelBase, state: 'ok', detail: `${(model.size / 1e9).toFixed(1)} GB` }
        : { ...modelBase, state: 'missing', hint: `ollama pull ${config.ollamaModel} (~9 GB)` }
    ]
  } catch {
    return [
      {
        ...base,
        state: 'warning',
        version: cliVersion,
        detail: 'Instalado, mas o serviço não está rodando.',
        canStart: true
      },
      { ...modelBase, state: 'warning', detail: 'Inicie o Ollama para verificar.' }
    ]
  }
}

async function checkComfy(): Promise<ServiceStatus> {
  const base = { id: 'comfyui', name: 'ComfyUI' } as const
  try {
    const stats = await fetchJson<{ system: { comfyui_version?: string } }>(
      `${config.comfyUrl}/system_stats`
    )
    return {
      ...base,
      state: 'ok',
      version: stats.system.comfyui_version,
      detail: `Rodando em ${config.comfyUrl}`
    }
  } catch {
    if (existsSync(join(config.comfyPath, 'ComfyUI', 'main.py'))) {
      return {
        ...base,
        state: 'warning',
        detail: `Instalado em ${config.comfyPath}, mas não está rodando.`,
        canStart: true
      }
    }
    return { ...base, state: 'missing', hint: `Não encontrado em ${config.comfyPath}` }
  }
}

async function checkPythonServer(): Promise<ServiceStatus> {
  const base = { id: 'pythonServer', name: 'Servidor Python (voz e legendas)' } as const
  try {
    await fetchJson(`${config.pythonServerUrl}/health`)
    return { ...base, state: 'ok', detail: `Rodando em ${config.pythonServerUrl}` }
  } catch {
    if (installing) {
      return { ...base, state: 'warning', detail: `Instalando… ${installing}` }
    }
    if (hasVenv()) {
      const err = pythonLastError()
      return {
        ...base,
        state: 'warning',
        detail: err
          ? `Parado. Último erro: ${err.slice(-200)}`
          : 'Instalado, parado. Inicia sozinho quando precisar.',
        canStart: true
      }
    }
    return {
      ...base,
      state: 'missing',
      detail: 'venv não criado. Instalar baixa ~1,5 GB (Kokoro, faster-whisper, CUDA).',
      canInstall: true
    }
  }
}

/** Kokoro ships eSpeak NG through the espeakng-loader wheel, so a system install is optional. */
async function checkEspeak(): Promise<ServiceStatus> {
  const base = { id: 'espeak', name: 'eSpeak NG' } as const
  if (
    hasVenv() &&
    existsSync(join(venvPython(), '..', '..', 'Lib', 'site-packages', 'espeakng_loader'))
  ) {
    return { ...base, state: 'ok', detail: 'Embutido no Kokoro (espeakng-loader)' }
  }
  try {
    const line = await firstLine('espeak-ng', ['--version'])
    return { ...base, state: 'ok', version: line.match(/(d+.d+[w.-]*)/)?.[1] }
  } catch {
    return { ...base, state: 'warning', detail: 'Vem junto com o servidor Python (Kokoro).' }
  }
}

export async function checkAll(): Promise<ServiceStatus[]> {
  await refreshPath()
  const results = await Promise.all([
    checkNode(),
    checkPython(),
    checkGit(),
    checkFfmpeg(),
    checkGpu(),
    checkOllama(),
    checkComfy(),
    checkPythonServer(),
    checkEspeak()
  ])
  return results.flat()
}

export async function startService(id: string): Promise<StartResult> {
  await refreshPath()
  if (id === 'ollama') {
    const appExe = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama app.exe')
    if (existsSync(appExe)) startDetached(appExe, [])
    else startDetached('ollama', ['serve'])
    return { ok: true, message: 'Iniciando Ollama…' }
  }
  if (id === 'comfyui') {
    const pythonExe = join(config.comfyPath, 'python_embeded', 'python.exe')
    if (!existsSync(pythonExe)) return { ok: false, message: 'ComfyUI não encontrado.' }
    startDetached(
      pythonExe,
      ['-s', join('ComfyUI', 'main.py'), '--windows-standalone-build', '--disable-auto-launch'],
      config.comfyPath
    )
    return { ok: true, message: 'Iniciando ComfyUI (pode levar ~30 s)…' }
  }
  if (id === 'pythonServer') {
    try {
      await ensurePython()
      return { ok: true, message: 'Servidor Python rodando.' }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }
  return { ok: false, message: 'Este serviço não pode ser iniciado por aqui.' }
}

export async function installService(id: string): Promise<StartResult> {
  await refreshPath()
  if (id === 'pythonServer') {
    if (installing) return { ok: false, message: 'Instalação já em andamento.' }
    installing = 'iniciando'
    addLog(null, 'info', 'Instalando servidor Python (veja o progresso aqui)…')
    installPython((line) => {
      installing = line.slice(0, 120)
      if (/^(Collecting|Successfully|Criando|Baixando|Kokoro|Whisper|ERROR)/.test(line))
        addLog(null, 'info', line)
    })
      .then(() => addLog(null, 'info', 'Servidor Python instalado.'))
      .catch((e) => addLog(null, 'error', `Instalação do Python falhou: ${e.message}`))
      .finally(() => (installing = null))
    return {
      ok: true,
      message: 'Instalação iniciada. Acompanhe em Fila e Worker → Logs (leva alguns minutos).'
    }
  }
  return { ok: false, message: `Instalação automática de "${id}" não disponível.` }
}
