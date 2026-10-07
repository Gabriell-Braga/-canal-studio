import { spawn } from 'child_process'
import { existsSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Run ffmpeg/ffprobe; abort kills the process. Resolves with stderr+stdout text. */
export function runTool(
  tool: 'ffmpeg' | 'ffprobe',
  args: string[],
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(tool, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-20000)))
    const onAbort = (): void => {
      p.kill()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    p.on('error', reject)
    p.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) reject(new Error('Cancelado'))
      else if (code === 0) resolve({ stdout, stderr })
      else
        reject(
          new Error(
            `${tool} falhou (${code}): ${stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')}`
          )
        )
    })
  })
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await runTool('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file
  ])
  const d = Number(stdout.trim())
  if (!Number.isFinite(d)) throw new Error(`Duração inválida para ${file}`)
  return d
}

export function isValidFile(file: string | null | undefined, minBytes = 1024): file is string {
  return !!file && existsSync(file) && statSync(file).size >= minBytes
}

/**
 * Join WAV files with silence between them (`pauses[i]` seconds after file i, or the same
 * pause everywhere), then apply two-pass loudnorm to -14 LUFS. Output is 48 kHz mono 16-bit WAV.
 */
export async function concatAndNormalize(
  files: string[],
  pauses: number | number[],
  out: string,
  workDir: string,
  signal?: AbortSignal
): Promise<void> {
  const gaps = files.map((_, i) => (typeof pauses === 'number' ? pauses : (pauses[i] ?? 0)))
  const silences = new Map<number, string>()
  for (const sec of new Set(gaps)) {
    if (sec <= 0) continue
    const silence = join(workDir, `silence_${Math.round(sec * 1000)}ms.wav`)
    silences.set(sec, silence)
    if (isValidFile(silence, 44)) continue
    await runTool(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=24000:cl=mono',
        '-t',
        String(sec),
        '-c:a',
        'pcm_s16le',
        silence
      ],
      signal
    )
  }
  const list = join(workDir, 'concat.txt')
  const lines: string[] = []
  files.forEach((f, i) => {
    lines.push(`file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    const silence = silences.get(gaps[i])
    if (silence && i < files.length - 1) lines.push(`file '${silence.replace(/\\/g, '/')}'`)
  })
  writeFileSync(list, lines.join('\n'))
  const joined = join(workDir, 'joined.wav')
  await runTool(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', joined],
    signal
  )

  const target = 'I=-14:TP=-1.5:LRA=11'
  // Kokoro output is very peaky (~21 dB peak-to-loudness). A gentle compressor first lets
  // linear loudnorm reach -14 LUFS without hitting the true-peak ceiling.
  const compressor = 'acompressor=threshold=-30dB:ratio=4:attack=3:release=60:makeup=8dB'
  const pass1 = await runTool(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      joined,
      '-af',
      `${compressor},loudnorm=${target}:print_format=json`,
      '-f',
      'null',
      '-'
    ],
    signal
  )
  const json = pass1.stderr.slice(pass1.stderr.lastIndexOf('{'), pass1.stderr.lastIndexOf('}') + 1)
  const m = JSON.parse(json) as Record<string, string>
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`
  await runTool(
    'ffmpeg',
    [
      '-y',
      '-i',
      joined,
      '-af',
      `${compressor},loudnorm=${target}:${measured}:linear=true`,
      '-ar',
      '48000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      out
    ],
    signal
  )
}
