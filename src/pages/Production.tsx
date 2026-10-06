import { useState } from 'react'
import { STATUS_LABELS, type Video, type VideoStatus } from '../../shared/types'
import { api, errorText, formatDate, useLive } from '../lib/api'
import { Banner, Button, Card, inputClass, PageHeader } from '../components/ui'

const COLUMNS: { title: string; statuses: VideoStatus[]; attention?: boolean }[] = [
  { title: 'Temas', statuses: ['TOPIC_QUEUED', 'SCRIPT_GENERATING'] },
  { title: 'Revisar roteiro', statuses: ['SCRIPT_REVIEW'], attention: true },
  { title: 'Fila de produção', statuses: ['PRODUCTION_QUEUED'] },
  { title: 'Produzindo', statuses: ['AUDIO', 'SCENES', 'RENDERING', 'THUMBNAIL'] },
  { title: 'Revisão final', statuses: ['FINAL_REVIEW'], attention: true },
  { title: 'Agendado / publicado', statuses: ['SCHEDULED', 'PUBLISHED'] },
  { title: 'Erro', statuses: ['ERROR'], attention: true }
]

interface Props {
  onOpen: (id: number) => void
  onReview: () => void
}

export default function Production({ onOpen, onReview }: Props): React.JSX.Element {
  const { data: videos = [] } = useLive(() => api.videos.list(), ['videos'])
  const [text, setText] = useState('')
  const [duration, setDuration] = useState('')
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const count = (statuses: VideoStatus[]): number =>
    videos.filter((v) => statuses.includes(v.status)).length
  const topicsQueued = count(['TOPIC_QUEUED'])

  async function addTopics(): Promise<void> {
    const topics = text
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (!topics.length) return
    setBusy(true)
    try {
      const minutes = Number(duration) || undefined
      const created = await api.videos.addTopics(topics, minutes)
      setText('')
      setMessage({ kind: 'info', text: `${created.length} tema(s) adicionado(s).` })
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  async function generate(): Promise<void> {
    try {
      const n = await api.videos.generateScripts()
      setMessage({ kind: 'info', text: `${n} roteiro(s) na fila de geração.` })
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    }
  }

  return (
    <div>
      <PageHeader
        title="Produção"
        subtitle={
          <>
            {videos.length} vídeo(s) · {count(['SCRIPT_REVIEW'])} roteiro(s) para revisar ·{' '}
            {count(['FINAL_REVIEW'])} para revisão final · {count(['ERROR'])} com erro
          </>
        }
        actions={
          <>
            <Button onClick={onReview} disabled={!count(['SCRIPT_REVIEW'])}>
              Revisar roteiros ({count(['SCRIPT_REVIEW'])})
            </Button>
            <Button
              variant="primary"
              onClick={generate}
              disabled={!topicsQueued}
              data-testid="generate-scripts"
            >
              Gerar roteiros ({topicsQueued})
            </Button>
          </>
        }
      />

      {message && <Banner kind={message.kind}>{message.text}</Banner>}

      <Card className="mb-6 p-4">
        <div className="mb-2 text-sm font-medium text-zinc-300">Adicionar temas (um por linha)</div>
        <textarea
          data-testid="topics-input"
          className={`${inputClass} h-24 resize-y font-mono`}
          placeholder={'The mystery of the Mary Celeste\nHow the Dutch tulip bubble really ended'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-3 flex items-center gap-3">
          <input
            data-testid="duration-input"
            className={`${inputClass} max-w-40`}
            type="number"
            min={1}
            max={60}
            step={0.5}
            placeholder="Minutos (padrão)"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
          <Button data-testid="add-topics" onClick={addTopics} disabled={busy || !text.trim()}>
            Adicionar
          </Button>
        </div>
      </Card>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const items = videos.filter((v) => col.statuses.includes(v.status))
          return (
            <div key={col.title} className="flex w-60 shrink-0 flex-col">
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                <span>{col.title}</span>
                <span className={items.length && col.attention ? 'text-amber-400' : ''}>
                  {items.length}
                </span>
              </div>
              <div className="flex min-h-24 flex-col gap-2 rounded-lg bg-zinc-900/50 p-2">
                {items.map((v) => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    attention={col.attention}
                    onOpen={() => onOpen(v.id)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VideoCard({
  video,
  attention,
  onOpen
}: {
  video: Video
  attention?: boolean
  onOpen: () => void
}): React.JSX.Element {
  const isError = video.status === 'ERROR'
  return (
    <button
      data-testid="video-card"
      onClick={onOpen}
      className={`rounded-md border p-3 text-left text-sm transition-colors hover:border-zinc-500 ${
        isError
          ? 'border-red-800 bg-red-950/40'
          : attention
            ? 'border-amber-600/60 bg-amber-950/20'
            : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      <div className="line-clamp-2 font-medium">{video.title ?? video.topic}</div>
      {video.title && (
        <div className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{video.topic}</div>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
        <span>{STATUS_LABELS[video.status]}</span>
        <span>{video.duration_target_min} min</span>
      </div>
      {video.scheduled_at && (
        <div className="mt-1 text-xs text-emerald-400">{formatDate(video.scheduled_at)}</div>
      )}
      {isError && video.error_message && (
        <div className="mt-1 line-clamp-2 text-xs text-red-300">{video.error_message}</div>
      )}
    </button>
  )
}
