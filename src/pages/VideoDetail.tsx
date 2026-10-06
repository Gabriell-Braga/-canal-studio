import { useState } from 'react'
import { JOB_LABELS, STATUS_LABELS, type JobType } from '../../shared/types'
import ScriptEditor from '../components/ScriptEditor'
import { Banner, Button, Card, PageHeader } from '../components/ui'
import { api, errorText, formatDate, useLive } from '../lib/api'

interface Props {
  id: number
  onBack: () => void
}

export default function VideoDetail({ id, onBack }: Props): React.JSX.Element {
  const { data } = useLive(() => api.videos.get(id), ['videos', 'jobs', 'logs'], [id])
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  if (data === undefined) return <p className="text-zinc-500">Carregando…</p>
  if (data === null) {
    return (
      <div>
        <p className="text-zinc-400">Vídeo não encontrado.</p>
        <Button onClick={onBack}>Voltar</Button>
      </div>
    )
  }
  const { video, jobs, logs } = data

  async function act(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try {
      await fn()
      setMessage({ kind: 'info', text: ok })
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={video.title ?? video.topic}
        subtitle={`${STATUS_LABELS[video.status]} · ${video.topic}`}
        actions={
          <>
            <Button onClick={onBack}>Voltar</Button>
            <Button
              variant="danger"
              onClick={() => act(() => api.videos.remove(id).then(onBack), 'Removido')}
            >
              Excluir
            </Button>
          </>
        }
      />
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      {video.status === 'ERROR' && (
        <Banner kind="error">
          Erro em {video.error_step ? JOB_LABELS[video.error_step] : 'etapa desconhecida'}:{' '}
          {video.error_message}
          {video.error_step && (
            <Button
              size="sm"
              className="ml-3"
              onClick={() =>
                act(
                  () => api.videos.retryFrom(id, video.error_step as JobType),
                  'Etapa enviada para a fila.'
                )
              }
            >
              Tentar de novo a partir desta etapa
            </Button>
          )}
        </Banner>
      )}

      {video.script && (
        <Card className="mb-6 p-5">
          <ScriptEditor
            key={video.updated_at}
            video={video}
            onDone={() => setMessage({ kind: 'info', text: 'Roteiro salvo.' })}
          />
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Tarefas</h2>
        <ul className="space-y-1 text-sm">
          {jobs.map((j) => (
            <li key={j.id} className="flex justify-between text-zinc-300">
              <span>
                {JOB_LABELS[j.type]} · {j.status} · tentativa {j.attempts}/{j.max_attempts}
              </span>
              <span className="text-zinc-500">
                {formatDate(j.finished_at ?? j.started_at ?? j.created_at)}
              </span>
            </li>
          ))}
        </ul>
        <h2 className="mb-2 mt-5 font-semibold">Logs</h2>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs text-zinc-400">
          {logs
            .map(
              (l) =>
                `${new Date(l.created_at).toLocaleTimeString('pt-BR')} [${l.level}] ${l.message}`
            )
            .join('\n')}
        </pre>
      </Card>
    </div>
  )
}
