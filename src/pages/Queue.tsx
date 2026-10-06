import { useEffect, useRef, useState } from 'react'
import { JOB_LABELS, type Job, type LogEntry, type Video } from '../../shared/types'
import { Button, Card, PageHeader } from '../components/ui'
import { api, formatDate, useLive } from '../lib/api'

function JobRow({
  job,
  video,
  onCancel
}: {
  job: Job
  video?: Video
  onCancel?: () => void
}): React.JSX.Element {
  const waiting = job.run_after && new Date(job.run_after) > new Date()
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm" data-testid={`job-${job.status}`}>
      <span className="w-24 shrink-0 font-medium">{JOB_LABELS[job.type]}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-300">
        {video?.title ?? video?.topic ?? `#${job.video_id}`}
      </span>
      {job.status === 'running' && (
        <div className="h-1.5 w-32 overflow-hidden rounded bg-zinc-800">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}
      <span className="w-20 text-right text-xs text-zinc-500">{job.gpu ? 'GPU' : 'CPU'}</span>
      <span className="w-24 text-right text-xs text-zinc-500">
        {job.run_mode === 'night' ? 'madrugada' : 'agora'}
      </span>
      <span className="w-40 text-right text-xs text-zinc-500">
        {job.status === 'pending'
          ? waiting
            ? `nova tentativa ${formatDate(job.run_after)}`
            : job.attempts
              ? `tentativa ${job.attempts + 1}/${job.max_attempts}`
              : 'aguardando'
          : job.status === 'running'
            ? `desde ${formatDate(job.started_at)}`
            : `${job.status} ${formatDate(job.finished_at)}`}
      </span>
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      )}
    </li>
  )
}

export default function Queue(): React.JSX.Element {
  const { data: state } = useLive(() => api.queue.state(), ['jobs', 'settings'], [], 3000)
  const { data: videos = [] } = useLive(() => api.videos.list(), ['videos'])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const lastId = useRef(0)
  const logBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const fresh = await api.queue.logs(lastId.current)
      if (!alive || !fresh.length) return
      lastId.current = fresh[fresh.length - 1].id
      setLogs((prev) => [...prev, ...fresh].slice(-500))
    }
    load()
    const off = api.onChanged((t) => t === 'logs' && load())
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight })
  }, [logs])

  if (!state) return <p className="text-zinc-500">Carregando…</p>
  const byId = new Map(videos.map((v) => [v.id, v]))
  const vramPct = state.vram ? Math.round((state.vram.used / state.vram.total) * 100) : 0

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Fila e Worker"
        subtitle={
          <span data-testid="queue-status">
            {state.paused
              ? 'Pausada'
              : state.forceRun
                ? 'Rodando agora (janela ignorada)'
                : 'Ativa'}{' '}
            · janela {state.nightWindow} ({state.inNightWindow ? 'aberta' : 'fechada'}) ·{' '}
            {state.videosStartedTonight}/{state.maxVideosPerNight} vídeos nesta noite
          </span>
        }
        actions={
          <>
            <Button variant="primary" onClick={() => api.queue.runNow()} data-testid="run-now">
              Rodar agora
            </Button>
            {state.paused ? (
              <Button onClick={() => api.queue.resume()} data-testid="resume">
                Retomar
              </Button>
            ) : (
              <Button onClick={() => api.queue.pause()} data-testid="pause">
                Pausar fila
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">VRAM</div>
          {state.vram ? (
            <>
              <div className="mt-1 text-xl font-semibold">
                {(state.vram.used / 1024).toFixed(1)} / {(state.vram.total / 1024).toFixed(1)} GB
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded bg-zinc-800">
                <div
                  className={`h-full ${vramPct > 90 ? 'bg-red-500' : vramPct > 70 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                  style={{ width: `${vramPct}%` }}
                />
              </div>
            </>
          ) : (
            <div className="mt-1 text-zinc-500">nvidia-smi indisponível</div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Rodando</div>
          <div className="mt-1 text-xl font-semibold">{state.running.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Na fila</div>
          <div className="mt-1 text-xl font-semibold">{state.pending.length}</div>
        </Card>
      </div>

      <h2 className="mb-2 font-semibold">Em execução</h2>
      <Card className="mb-6">
        <ul className="divide-y divide-zinc-800">
          {state.running.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              video={byId.get(j.video_id)}
              onCancel={() => api.queue.cancelJob(j.id)}
            />
          ))}
          {!state.running.length && (
            <li className="px-4 py-3 text-sm text-zinc-500">Nada rodando.</li>
          )}
        </ul>
      </Card>

      <h2 className="mb-2 font-semibold">Próximas</h2>
      <Card className="mb-6">
        <ul className="divide-y divide-zinc-800">
          {state.pending.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              video={byId.get(j.video_id)}
              onCancel={() => api.queue.cancelJob(j.id)}
            />
          ))}
          {!state.pending.length && (
            <li className="px-4 py-3 text-sm text-zinc-500">Fila vazia.</li>
          )}
        </ul>
      </Card>

      <h2 className="mb-2 font-semibold">Logs</h2>
      <Card className="mb-6">
        <div ref={logBox} className="h-72 overflow-y-auto p-3 font-mono text-xs" data-testid="logs">
          {logs.map((l) => (
            <div
              key={l.id}
              className={
                l.level === 'error'
                  ? 'text-red-400'
                  : l.level === 'warn'
                    ? 'text-amber-300'
                    : 'text-zinc-400'
              }
            >
              {new Date(l.created_at).toLocaleTimeString('pt-BR')} {l.job_id ? `#${l.job_id} ` : ''}
              {l.message}
            </div>
          ))}
        </div>
      </Card>

      <h2 className="mb-2 font-semibold">Recentes</h2>
      <Card>
        <ul className="divide-y divide-zinc-800">
          {state.recent.map((j) => (
            <JobRow key={j.id} job={j} video={byId.get(j.video_id)} />
          ))}
        </ul>
      </Card>
    </div>
  )
}
