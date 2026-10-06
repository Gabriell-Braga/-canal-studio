import { useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Clapperboard,
  FileCheck2,
  Plus,
  Sparkles,
  Trash2
} from 'lucide-react'
import DeleteVideoModal from '../components/DeleteVideoModal'
import { STATUS_LABELS, type Video, type VideoStatus } from '../../shared/types'
import { Banner, Button, Card, inputClass, PageHeader } from '../components/ui'
import { api, errorText, formatDate, mediaUrl, useLive } from '../lib/api'
import { useChannel } from '../lib/channel'

const COLUMNS: { title: string; statuses: VideoStatus[]; attention?: boolean }[] = [
  { title: 'Temas', statuses: ['TOPIC_QUEUED', 'SCRIPT_GENERATING'] },
  { title: 'Revisar roteiro', statuses: ['SCRIPT_REVIEW'], attention: true },
  {
    title: 'Em produção',
    statuses: ['PRODUCTION_QUEUED', 'AUDIO', 'SCENES', 'RENDERING', 'THUMBNAIL']
  },
  { title: 'Revisão final', statuses: ['FINAL_REVIEW'], attention: true },
  { title: 'Agendado / publicado', statuses: ['SCHEDULED', 'PUBLISHED'] }
]

interface Props {
  onOpen: (id: number) => void
  onReview: () => void
}

function Stat({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof Clapperboard
  label: string
  value: number
  tone?: 'warn' | 'error'
}): React.JSX.Element {
  const color =
    tone === 'error' && value
      ? 'text-red-300'
      : tone === 'warn' && value
        ? 'text-amber-200'
        : 'text-white'
  return (
    <Card className="flex items-center gap-3.5 px-4 py-3.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-800 text-brand-300">
        <Icon size={18} />
      </span>
      <div>
        <div className={`text-xl font-semibold leading-tight ${color}`}>{value}</div>
        <div className="text-xs text-ink-400">{label}</div>
      </div>
    </Card>
  )
}

export default function Production({ onOpen, onReview }: Props): React.JSX.Element {
  const { channel } = useChannel()
  const { data: videos = [] } = useLive(() => api.videos.list(channel.id), ['videos'], [channel.id])
  const [text, setText] = useState('')
  const [duration, setDuration] = useState('')
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const count = (statuses: VideoStatus[]): number =>
    videos.filter((v) => statuses.includes(v.status)).length
  const topicsQueued = count(['TOPIC_QUEUED'])
  const errors = videos.filter((v) => v.status === 'ERROR')

  async function addTopics(): Promise<void> {
    const topics = text
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (!topics.length) return
    setBusy(true)
    try {
      const minutes = Number(duration) || undefined
      const created = await api.videos.addTopics(channel.id, topics, minutes)
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
      const n = await api.videos.generateScripts(channel.id)
      setMessage({ kind: 'info', text: `${n} roteiro(s) na fila de geração.` })
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    }
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Produção"
        subtitle={`${videos.length} vídeo(s) em ${channel.name}`}
        actions={
          <>
            <Button onClick={onReview} disabled={!count(['SCRIPT_REVIEW'])}>
              <FileCheck2 size={16} /> Revisar roteiros ({count(['SCRIPT_REVIEW'])})
            </Button>
            <Button
              variant="primary"
              onClick={generate}
              disabled={!topicsQueued}
              data-testid="generate-scripts"
            >
              <Sparkles size={16} /> Gerar roteiros ({topicsQueued})
            </Button>
          </>
        }
      />

      {message && <Banner kind={message.kind}>{message.text}</Banner>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={FileCheck2}
          label="Roteiros para revisar"
          value={count(['SCRIPT_REVIEW'])}
          tone="warn"
        />
        <Stat
          icon={Clapperboard}
          label="Em produção"
          value={count(['PRODUCTION_QUEUED', 'AUDIO', 'SCENES', 'RENDERING', 'THUMBNAIL'])}
        />
        <Stat
          icon={Sparkles}
          label="Prontos para revisão final"
          value={count(['FINAL_REVIEW'])}
          tone="warn"
        />
        <Stat icon={CalendarClock} label="Agendados" value={count(['SCHEDULED'])} />
      </div>

      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-ink-200">Adicionar temas</div>
          <div className="text-xs text-ink-500">Um por linha. Cole uma lista inteira.</div>
        </div>
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
            className={`${inputClass} max-w-44`}
            type="number"
            min={1}
            max={60}
            step={0.5}
            placeholder="Minutos (padrão)"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
          <Button data-testid="add-topics" onClick={addTopics} disabled={busy || !text.trim()}>
            <Plus size={16} /> Adicionar
          </Button>
        </div>
      </Card>

      {errors.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-300">
            <AlertTriangle size={14} /> Com erro ({errors.length})
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {errors.map((v) => (
              <VideoCard key={v.id} video={v} onOpen={() => onOpen(v.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(176px,1fr))] gap-3">
        {COLUMNS.map((col) => {
          const items = videos.filter((v) => col.statuses.includes(v.status))
          return (
            <div key={col.title} className="flex min-w-0 flex-col">
              <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                <span>{col.title}</span>
                <span
                  className={`rounded-full px-1.5 ${
                    items.length && col.attention
                      ? 'bg-amber-400/15 text-amber-200'
                      : 'text-ink-500'
                  }`}
                >
                  {items.length}
                </span>
              </div>
              <div className="flex min-h-28 flex-col gap-2 rounded-xl border border-white/[0.04] bg-ink-900/50 p-2">
                {items.map((v) => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    attention={col.attention}
                    onOpen={() => onOpen(v.id)}
                  />
                ))}
                {!items.length && (
                  <div className="flex flex-1 items-center justify-center py-6 text-xs text-ink-600">
                    vazio
                  </div>
                )}
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
  const thumb = video.thumbnail_paths[video.chosen_thumbnail ?? 0]
  const [deleting, setDeleting] = useState(false)
  return (
    <div className="group/card relative">
      <button
        data-testid="video-card"
        onClick={onOpen}
        className={`group overflow-hidden rounded-lg border text-left text-sm transition-all duration-150 hover:-translate-y-px hover:shadow-lg ${
          isError
            ? 'border-red-500/30 bg-red-500/[0.06] hover:border-red-400/50'
            : attention
              ? 'border-amber-400/30 bg-ink-850 hover:border-amber-300/60'
              : 'border-white/[0.06] bg-ink-850 hover:border-brand-400/40'
        }`}
      >
        {thumb && (
          <img
            src={mediaUrl(thumb)}
            alt=""
            className="aspect-video w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
          />
        )}
        <div className="p-3">
          <div className="line-clamp-2 font-medium text-ink-100">
            {video.kind === 'short' && (
              <span className="mr-1.5 inline-flex -translate-y-px items-center rounded bg-brand-400/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-brand-200">
                Short
              </span>
            )}
            {video.title ?? video.topic}
          </div>
          {video.title && (
            <div className="mt-0.5 line-clamp-1 text-xs text-ink-500">{video.topic}</div>
          )}
          <div className="mt-2 flex items-center justify-between text-xs text-ink-400">
            <span>{STATUS_LABELS[video.status]}</span>
            <span>{video.duration_target_min} min</span>
          </div>
          {video.scheduled_at && (
            <div className="mt-1 text-xs text-brand-300">{formatDate(video.scheduled_at)}</div>
          )}
          {isError && video.error_message && (
            <div className="mt-1 line-clamp-2 text-xs text-red-300">{video.error_message}</div>
          )}
        </div>
      </button>
      <button
        aria-label="Excluir vídeo"
        title="Excluir"
        data-testid="delete-video-card"
        onClick={() => setDeleting(true)}
        className="absolute right-1.5 top-1.5 rounded-md bg-ink-950/80 p-1.5 text-ink-400 opacity-0 backdrop-blur transition-all duration-150 hover:bg-red-500/20 hover:text-red-300 focus-visible:opacity-100 group-hover/card:opacity-100"
      >
        <Trash2 size={14} />
      </button>
      {deleting && (
        <DeleteVideoModal
          video={video}
          onClose={() => setDeleting(false)}
          onDeleted={() => setDeleting(false)}
        />
      )}
    </div>
  )
}
