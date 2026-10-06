import { run } from './exec'

export async function readVram(): Promise<{ used: number; total: number } | null> {
  try {
    const { stdout } = await run(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
      5000
    )
    const [used, total] = stdout
      .trim()
      .split(/\r?\n/)[0]
      .split(',')
      .map((s) => Number(s.trim()))
    return { used, total }
  } catch {
    return null
  }
}
