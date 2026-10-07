import { useEffect, useState } from 'react'
import {
  JOB_LABELS,
  STATUS_LABELS,
  type JobType,
  type Scene,
  type Video,
  type VideoDetail as Detail
} from '../../shared/types'
import { THUMB_KIND_LABELS, thumbKindOf } from '../../shared/render'
import ScriptEditor from '../components/ScriptEditor'
import {
  Banner,
  Button,
  Card,
  Field,
  inlineCheckClass,
  inputClass,
  PageHeader
} from '../components/ui'
import { api, errorText, formatDate, mediaUrl, useLive } from '../lib/api'
import { Smartphone, Sparkles, Trash2 } from 'lucide-react'
import DeleteVideoModal from '../components/DeleteVideoModal'
import { Badge } from '../components/ui'

type Tab = 'script' | 'audio' | 'scenes' | 'video' | 'shorts' | 'publish' | 'log'

const TABS: { id: Tab; label: string }[] = [
  { id: 'script', label: 'Roteiro' },
  { id: 'audio', label: 'Áudio' },
  { id: 'scenes', label: 'Cenas' },
  { id: 'video', label: 'Vídeo' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'publish', label: 'Publicação' },
  { id: 'log', label: 'Tarefas e logs' }
]

const REDO_STEPS: JobType[] = ['script', 'audio', 'scenes', 'render', 'thumbnail', 'metadata']

const ASSET_LABEL: Record<string, string> = {
  stock_video: 'Vídeo de banco',
  stock_photo: 'Foto de banco',
  ai_image: 'Imagem IA',
  ai_video: 'Vídeo IA'
}

/** A short only has its video, publishing and logs; the rest belongs to the full video. */
const SHORT_TABS: Tab[] = ['video', 'publish', 'log']

interface Props {
  id: number
  onBack: () => void
  onOpen?: (id: number) => void
}

export default function VideoDetail({ id, onBack, onOpen }: Props): React.JSX.Element {
  const { data } = useLive(() => api.videos.get(id), ['videos', 'jobs', 'logs'], [id])
  const [tab, setTab] = useState<Tab | null>(null)
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [redoStep, setRedoStep] = useState<JobType>('render')
  const [deleting, setDeleting] = useState(false)

  if (data === undefined) return <p className="text-ink-500">Carregando…</p>
  if (data === null) {
    return (
      <div>
        <p className="mb-3 text-ink-400">Vídeo não encontrado.</p>
        <Button onClick={onBack}>Voltar</Button>
      </div>
    )
  }
  const { video } = data
  const isShort = video.kind === 'short'
  const tabs = isShort ? TABS.filter((t) => SHORT_TABS.includes(t.id)) : TABS
  const fallbackTab: Tab =
    video.status === 'FINAL_REVIEW' ? 'publish' : video.video_path || isShort ? 'video' : 'script'
  const activeTab: Tab = tab && tabs.some((t) => t.id === tab) ? tab : fallbackTab
  const running = data.jobs.find((j) => j.status === 'running')

  async function act(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try {
      await fn()
      setMessage({ kind: 'info', text: ok })
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={video.title ?? video.topic}
        subtitle={
          <>
            {STATUS_LABELS[video.status]}
            {running &&
              ` · ${JOB_LABELS[running.type]} ${Math.round((running.progress ?? 0) * 100)}%`}{' '}
            · {video.topic}
          </>
        }
        actions={
          <>
            <Button onClick={onBack}>Voltar</Button>
            <Button variant="danger" onClick={() => setDeleting(true)} data-testid="delete-video">
              <Trash2 size={15} /> Excluir
            </Button>
            {video.status === 'FINAL_REVIEW' && (
              <Button
                variant="primary"
                data-testid="approve-final"
                onClick={() =>
                  act(
                    () => api.videos.approveFinal(id),
                    'Aprovado e agendado. O upload roda na madrugada.'
                  )
                }
              >
                Aprovar e agendar
              </Button>
            )}
          </>
        }
      />
      {deleting && (
        <DeleteVideoModal video={video} onClose={() => setDeleting(false)} onDeleted={onBack} />
      )}
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      {isShort && video.parent_id && (
        <Banner>
          <span className="inline-flex items-center gap-2">
            <Smartphone size={15} /> Short vertical cortado do vídeo completo. No fim ele recomenda
            o original, e a descrição leva o link.
          </span>
          {onOpen && (
            <Button
              size="sm"
              variant="outline"
              className="ml-3"
              onClick={() => onOpen(video.parent_id!)}
            >
              Abrir vídeo completo
            </Button>
          )}
        </Banner>
      )}
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

      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-ink-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              activeTab === t.id
                ? 'border-brand-500 text-white'
                : 'border-transparent text-ink-400 hover:text-ink-200'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className={`ml-auto flex items-center gap-2 pb-1 ${isShort ? 'hidden' : ''}`}>
          <select
            className={`${inputClass} h-9 max-w-44 py-0`}
            value={redoStep}
            onChange={(e) => setRedoStep(e.target.value as JobType)}
          >
            {REDO_STEPS.map((s) => (
              <option key={s} value={s}>
                {JOB_LABELS[s]}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() =>
              act(
                () => api.videos.retryFrom(id, redoStep),
                `Refazendo a partir de ${JOB_LABELS[redoStep]}.`
              )
            }
            disabled={!!running}
          >
            Refazer a partir desta etapa
          </Button>
        </div>
      </div>

      {activeTab === 'script' && (
        <ScriptTab
          video={video}
          onSaved={() => setMessage({ kind: 'info', text: 'Roteiro salvo.' })}
        />
      )}
      {activeTab === 'audio' && <AudioTab video={video} />}
      {activeTab === 'scenes' && <ScenesTab data={data} act={act} />}
      {activeTab === 'video' && <VideoTab video={video} act={act} busy={!!running} />}
      {activeTab === 'shorts' && <ShortsTab video={video} act={act} busy={!!running} />}
      {activeTab === 'publish' && <PublishTab video={video} act={act} />}
      {activeTab === 'log' && <LogTab data={data} />}
    </div>
  )
}

function ScriptTab({ video, onSaved }: { video: Video; onSaved: () => void }): React.JSX.Element {
  if (!video.script) return <p className="text-ink-500">O roteiro ainda não foi gerado.</p>
  const produced = !['TOPIC_QUEUED', 'SCRIPT_GENERATING', 'SCRIPT_REVIEW'].includes(video.status)
  return (
    <Card className="p-5">
      {produced && (
        <Banner kind="warn">
          Este vídeo já entrou em produção. Depois de salvar, use “Refazer a partir de Áudio” para
          aplicar as mudanças.
        </Banner>
      )}
      <ScriptEditor key={video.updated_at} video={video} onDone={onSaved} />
    </Card>
  )
}

function AudioTab({ video }: { video: Video }): React.JSX.Element {
  if (!video.audio_path) return <p className="text-ink-500">Áudio ainda não gerado.</p>
  return (
    <Card className="p-5">
      <audio controls src={mediaUrl(video.audio_path, video.updated_at)} className="w-full" />
      <p className="mt-2 text-xs text-ink-500">{video.audio_path}</p>
    </Card>
  )
}

function SceneThumb({ scene }: { scene: Scene }): React.JSX.Element {
  if (!scene.asset_path) {
    return (
      <div className="flex aspect-video items-center justify-center bg-ink-800 text-xs text-ink-500">
        sem mídia
      </div>
    )
  }
  const src = mediaUrl(scene.asset_path)
  return scene.asset_type === 'stock_video' || scene.asset_type === 'ai_video' ? (
    <video
      src={src}
      muted
      loop
      className="aspect-video w-full bg-black object-cover"
      onMouseEnter={(e) => e.currentTarget.play()}
      onMouseLeave={(e) => e.currentTarget.pause()}
    />
  ) : (
    <img src={src} className="aspect-video w-full bg-black object-cover" />
  )
}

function ScenesTab({
  data,
  act
}: {
  data: Detail
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState<number | null>(null)
  const [changed, setChanged] = useState(false)
  const run = async (sceneId: number, fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(sceneId)
    await act(fn, ok)
    setBusy(null)
    setChanged(true)
  }
  if (!data.scenes.length) return <p className="text-ink-500">Sem cenas.</p>
  return (
    <div>
      {changed && data.video.video_path && (
        <Banner kind="warn">
          Cenas alteradas.{' '}
          <Button
            size="sm"
            variant="primary"
            data-testid="rerender"
            onClick={() =>
              act(() => api.videos.rerender(data.video.id), 'Re-render na fila (roda agora).')
            }
          >
            Re-renderizar o vídeo
          </Button>
        </Banner>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {data.scenes.map((s) => (
          <Card key={s.id} className="overflow-hidden" data-testid="scene-card">
            <SceneThumb scene={s} />
            <div className="p-3">
              <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
                <span>
                  Cena {s.index + 1}
                  {s.start_sec !== null &&
                    ` · ${s.start_sec.toFixed(1)}–${s.end_sec?.toFixed(1)} s`}
                </span>
                <span>
                  {s.asset_type ? ASSET_LABEL[s.asset_type] : '—'}
                  {s.locked && ' · 🔒'}
                </span>
              </div>
              <p className="line-clamp-3 text-sm text-ink-300">{s.narration}</p>
              <p className="mt-1 truncate text-xs text-ink-500">[{s.visual_keywords}]</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    run(s.id, () => api.scenes.nextStock(s.id), 'Cena trocada por outro resultado.')
                  }
                >
                  Outro resultado
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run(s.id, () => api.scenes.generateAi(s.id), 'Imagem IA gerada.')}
                >
                  {busy === s.id ? 'Gerando…' : 'Gerar imagem IA'}
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    run(s.id, () => api.scenes.pickFile(s.id), 'Arquivo aplicado e cena travada.')
                  }
                >
                  Arquivo do PC
                </Button>
                {s.locked && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => run(s.id, () => api.scenes.unlock(s.id), 'Cena destravada.')}
                  >
                    Destravar
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function VideoTab({
  video,
  act,
  busy
}: {
  video: Video
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  if (!video.video_path) return <p className="text-ink-500">Vídeo ainda não renderizado.</p>
  return (
    <Card className="p-5">
      <video
        controls
        src={mediaUrl(video.video_path, video.updated_at)}
        className={
          video.kind === 'short'
            ? 'mx-auto aspect-[9/16] max-h-[70vh] bg-black'
            : 'aspect-video w-full bg-black'
        }
      />
      <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
        <span>{video.video_path}</span>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => act(() => api.videos.rerender(video.id), 'Re-render na fila.')}
        >
          Re-renderizar
        </Button>
      </div>
    </Card>
  )
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function PublishTab({
  video,
  act
}: {
  video: Video
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>
}): React.JSX.Element {
  const [title, setTitle] = useState(video.title ?? '')
  const [description, setDescription] = useState(video.description ?? '')
  const [tags, setTags] = useState(video.tags.join(', '))
  const [when, setWhen] = useState(toLocalInput(video.scheduled_at))
  const [synthetic, setSynthetic] = useState(video.synthetic_content)
  const [chosen, setChosen] = useState(video.chosen_thumbnail ?? 0)

  useEffect(() => {
    if (!video.scheduled_at)
      api.videos.suggestedSlot(video.id).then(
        (s) => setWhen(toLocalInput(s)),
        () => undefined
      )
  }, [video.scheduled_at, video.id])

  const locked = ['SCHEDULED', 'PUBLISHED'].includes(video.status) && !!video.youtube_id

  /** Uses the thumbnail picked here; a warning from YouTube shows as an error with its reason. */
  function resend(): Promise<void> {
    return act(async () => {
      await api.videos.update(video.id, { chosen_thumbnail: chosen })
      const lines = await api.videos.resendExtras(video.id)
      const problems = lines.filter((l) => l.level !== 'info').map((l) => l.message)
      if (problems.length) throw new Error(problems.join(' · '))
    }, 'Thumbnail e legendas enviadas ao YouTube.')
  }

  function save(): Promise<void> {
    return act(
      () =>
        api.videos.update(video.id, {
          title: title.trim(),
          description,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          scheduled_at: when ? new Date(when).toISOString() : null,
          synthetic_content: synthetic,
          chosen_thumbnail: chosen
        }),
      'Publicação salva.'
    )
  }

  return (
    <div className="space-y-5">
      {locked && (
        <Banner kind="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Já enviado ao YouTube ({video.youtube_id}). Mudanças aqui não são reenviadas, exceto a
              thumbnail e as legendas pelo botão ao lado.
            </span>
            {video.kind === 'long' && (
              <Button size="sm" data-testid="resend-extras" onClick={resend}>
                Reenviar thumbnail e legendas
              </Button>
            )}
          </div>
        </Banner>
      )}
      {video.kind === 'short' && (
        <Banner>
          O link do vídeo completo e #shorts entram na descrição na hora do upload. O YouTube não
          deixa definir thumbnail de short pela API. Depois do envio, no YouTube Studio, ligue o
          short ao vídeo completo em “Vídeo relacionado” para aparecer um botão clicável.
        </Banner>
      )}
      <Card className={`p-5 ${video.kind === 'short' ? 'hidden' : ''}`}>
        <div className="mb-2 text-sm font-medium text-ink-300">Thumbnail</div>
        {video.thumbnail_paths.length ? (
          <div className="grid grid-cols-3 gap-3">
            {video.thumbnail_paths.map((p, i) => (
              <button
                key={p}
                data-testid="thumb-option"
                onClick={() => setChosen(i)}
                className={`relative overflow-hidden rounded-md border-2 ${chosen === i ? 'border-brand-500' : 'border-transparent'}`}
              >
                <img
                  src={mediaUrl(p, video.updated_at)}
                  className="aspect-video w-full object-cover"
                />
                {thumbKindOf(p) && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
                    {THUMB_KIND_LABELS[thumbKindOf(p) ?? 'ai']}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-500">Thumbnails ainda não geradas.</p>
        )}
      </Card>
      <Card className="grid gap-4 p-5">
        <Field label="Título" hint={`${title.length}/70 caracteres`}>
          <input
            className={inputClass}
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Descrição (com capítulos)">
          <textarea
            className={`${inputClass} h-56 font-mono text-xs`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Tags (separadas por vírgula)">
          <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Data de publicação (horário local)"
            hint={
              video.scheduled_at
                ? `Agendado: ${formatDate(video.scheduled_at)}`
                : video.kind === 'short'
                  ? 'Sugestão: 30 min depois do vídeo completo'
                  : 'Sugestão: próximo horário livre'
            }
          >
            <input
              className={inputClass}
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
          <label className={inlineCheckClass}>
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={synthetic}
              onChange={(e) => setSynthetic(e.target.checked)}
            />
            Conteúdo alterado ou sintético (divulgação do YouTube)
          </label>
        </div>
        <div className="flex gap-2">
          <Button onClick={save}>Salvar</Button>
          {video.status === 'FINAL_REVIEW' && (
            <Button
              variant="primary"
              onClick={async () => {
                await save()
                await act(
                  () => api.videos.approveFinal(video.id),
                  'Aprovado e agendado. O upload roda na madrugada.'
                )
              }}
            >
              Salvar, aprovar e agendar
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}

function LogTab({ data }: { data: Detail }): React.JSX.Element {
  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold">Tarefas</h2>
      <ul className="space-y-1 text-sm">
        {data.jobs.map((j) => (
          <li key={j.id} className="flex justify-between text-ink-300">
            <span>
              {JOB_LABELS[j.type]} · {j.status} · tentativa {j.attempts}/{j.max_attempts}
            </span>
            <span className="text-ink-500">
              {formatDate(j.finished_at ?? j.started_at ?? j.created_at)}
            </span>
          </li>
        ))}
      </ul>
      <h2 className="mb-2 mt-5 font-semibold">Logs</h2>
      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-xs text-ink-400">
        {data.logs
          .map(
            (l) => `${new Date(l.created_at).toLocaleTimeString('pt-BR')} [${l.level}] ${l.message}`
          )
          .join('\n')}
      </pre>
    </Card>
  )
}

function ShortsTab({
  video,
  act,
  busy
}: {
  video: Video
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const { data: shorts = [] } = useLive(() => api.videos.shorts(video.id), ['videos'], [video.id])
  const [count, setCount] = useState(2)
  const [deleting, setDeleting] = useState<Video | null>(null)
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-64 flex-1">
          <div className="font-medium text-ink-100">Gerar shorts deste vídeo</div>
          <p className="mt-1 text-sm text-ink-400">
            A IA escolhe os trechos mais fortes (18–52 s), monta em vertical 9:16 com legendas e
            fecha com uma tela “assista ao vídeo completo” narrada na voz do canal. Os shorts saem
            no mesmo dia do vídeo completo: o primeiro meia hora depois dele, os outros de meia em
            meia hora. Eles são aprovados junto com o vídeo, sem revisão separada.
          </p>
        </div>
        <select
          className={`${inputClass} h-9 max-w-28 py-0`}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} short{n > 1 ? 's' : ''}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          data-testid="generate-shorts"
          disabled={!video.video_path || busy}
          onClick={() =>
            act(() => api.videos.generateShorts(video.id, count), 'Shorts na fila (rodam agora).')
          }
        >
          <Sparkles size={15} /> Gerar shorts
        </Button>
      </Card>
      {shorts.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {shorts.map((s) => (
            <Card key={s.id} className="overflow-hidden" data-testid="short-card">
              {s.video_path ? (
                <video
                  src={mediaUrl(s.video_path, s.updated_at)}
                  controls
                  className="aspect-[9/16] w-full bg-black object-cover"
                />
              ) : (
                <div className="flex aspect-[9/16] items-center justify-center bg-ink-950 text-xs text-ink-500">
                  {s.status === 'ERROR' ? 'falhou' : 'renderizando…'}
                </div>
              )}
              <div className="space-y-2 p-3">
                <div className="line-clamp-2 text-sm font-medium text-ink-100">{s.title}</div>
                <div className="flex items-center justify-between">
                  <Badge
                    tone={
                      s.status === 'ERROR'
                        ? 'error'
                        : s.status === 'SCHEDULED' || s.status === 'PUBLISHED'
                          ? 'ok'
                          : 'neutral'
                    }
                  >
                    {s.status === 'FINAL_REVIEW' ? 'Pronto' : STATUS_LABELS[s.status]}
                  </Badge>
                  <span className="text-xs text-ink-500">
                    {Math.round((s.short_end ?? 0) - (s.short_start ?? 0))} s
                  </span>
                </div>
                <div className="text-xs text-ink-400" data-testid="short-when">
                  {s.scheduled_at
                    ? `Publica em ${formatDate(s.scheduled_at)}`
                    : s.status === 'FINAL_REVIEW'
                      ? 'Aprovado junto com o vídeo'
                      : ''}
                </div>
                {s.error_message && s.status === 'ERROR' && (
                  <div className="line-clamp-2 text-xs text-red-300">{s.error_message}</div>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={!!s.youtube_id || busy}
                    title="Cortar outro trecho no lugar deste"
                    onClick={() =>
                      act(() => api.videos.retryFrom(s.id, 'short'), 'Novo short na fila.')
                    }
                  >
                    Refazer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Excluir short"
                    title="Excluir"
                    onClick={() => setDeleting(s)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-500">Nenhum short gerado ainda.</p>
      )}
      {deleting && (
        <DeleteVideoModal
          video={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
