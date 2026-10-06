import { useState } from 'react'
import type { ReviewAlert, Video } from '../../shared/types'
import ScriptEditor from '../components/ScriptEditor'
import { Banner, Button, Card, PageHeader } from '../components/ui'
import { api, errorText, useLive } from '../lib/api'

const ALERT_STYLE: Record<ReviewAlert['kind'], { label: string; className: string }> = {
  dubious_fact: { label: 'Checar fato', className: 'border-red-700 bg-red-950/50 text-red-200' },
  hook: { label: 'Gancho', className: 'border-amber-700 bg-amber-950/40 text-amber-200' },
  pacing: { label: 'Ritmo', className: 'border-amber-700 bg-amber-950/40 text-amber-200' },
  repetition: { label: 'Repetição', className: 'border-zinc-600 bg-zinc-800/60 text-zinc-200' },
  other: { label: 'Nota', className: 'border-zinc-600 bg-zinc-800/60 text-zinc-200' }
}

function wordCount(v: Video): number {
  if (!v.script) return 0
  return [v.script.hook, ...v.script.scenes.map((s) => s.narration), v.script.outro]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
}

export default function Review({ onOpen }: { onOpen: (id: number) => void }): React.JSX.Element {
  const { data: videos = [] } = useLive(
    async () => (await api.videos.list()).filter((v) => v.status === 'SCRIPT_REVIEW'),
    ['videos']
  )
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  const visibleSelected = [...selected].filter((id) => videos.some((v) => v.id === id))
  const allSelected = videos.length > 0 && visibleSelected.length === videos.length

  function toggle(id: number): void {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function approve(): Promise<void> {
    try {
      const n = await api.videos.approveScripts(visibleSelected)
      setSelected(new Set())
      setMessage({
        kind: 'info',
        text: `${n} roteiro(s) aprovado(s) e enviado(s) para a fila de produção.`
      })
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    }
  }

  async function redo(id: number): Promise<void> {
    try {
      await api.videos.redoScript(id)
      setMessage({ kind: 'info', text: 'Roteiro enviado para nova geração.' })
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Revisão de roteiros"
        subtitle={`${videos.length} roteiro(s) esperando aprovação`}
        actions={
          <>
            <Button
              data-testid="select-all"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(videos.map((v) => v.id)))
              }
              disabled={!videos.length}
            >
              {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
            </Button>
            <Button
              data-testid="approve-selected"
              variant="primary"
              onClick={approve}
              disabled={!visibleSelected.length}
            >
              Aprovar selecionados ({visibleSelected.length})
            </Button>
          </>
        }
      />
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      {!videos.length && <p className="text-zinc-500">Nenhum roteiro esperando revisão.</p>}

      <div className="space-y-4">
        {videos.map((v) => {
          const words = wordCount(v)
          const isOpen = expanded.has(v.id)
          return (
            <Card key={v.id} className="p-4">
              <div className="flex items-start gap-3" data-testid="review-item">
                <input
                  type="checkbox"
                  className="mt-1.5 h-4 w-4 accent-emerald-600"
                  checked={selected.has(v.id)}
                  onChange={() => toggle(v.id)}
                  data-testid="review-checkbox"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <button
                      className="text-left text-lg font-medium hover:underline"
                      onClick={() => onOpen(v.id)}
                    >
                      {v.title ?? v.topic}
                    </button>
                    <span className="text-xs text-zinc-500">
                      {v.script?.scenes.length ?? 0} cenas · {words} palavras · ~
                      {(words / 150).toFixed(1)} min (meta {v.duration_target_min})
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">{v.topic}</div>

                  {editing === v.id ? (
                    <div className="mt-4">
                      <ScriptEditor
                        video={v}
                        onDone={() => setEditing(null)}
                        onCancel={() => setEditing(null)}
                      />
                    </div>
                  ) : (
                    <>
                      <p className="mt-3 text-sm text-zinc-200">
                        <span className="text-zinc-500">Gancho: </span>
                        {v.script?.hook}
                      </p>
                      {isOpen && (
                        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
                          {v.script?.scenes.map((s, i) => (
                            <li key={i}>
                              {s.narration}
                              <span className="ml-2 text-xs text-zinc-500">
                                [{s.visual_keywords}]
                              </span>
                            </li>
                          ))}
                          <li className="list-none text-zinc-400">
                            <span className="text-zinc-500">Encerramento: </span>
                            {v.script?.outro}
                          </li>
                        </ol>
                      )}
                      {v.review_alerts.length > 0 && (
                        <ul className="mt-3 space-y-1.5">
                          {v.review_alerts.map((a, i) => (
                            <li
                              key={i}
                              className={`rounded border px-3 py-1.5 text-xs ${ALERT_STYLE[a.kind]?.className ?? ALERT_STYLE.other.className}`}
                            >
                              <span className="font-semibold">
                                {ALERT_STYLE[a.kind]?.label ?? 'Nota'}:{' '}
                              </span>
                              {a.message}
                              {a.quote && (
                                <span className="mt-0.5 block italic opacity-80">“{a.quote}”</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setExpanded((s) => {
                              const n = new Set(s)
                              if (n.has(v.id)) n.delete(v.id)
                              else n.add(v.id)
                              return n
                            })
                          }
                        >
                          {isOpen ? 'Recolher' : 'Ver roteiro completo'}
                        </Button>
                        <Button size="sm" onClick={() => setEditing(v.id)}>
                          Editar
                        </Button>
                        <Button size="sm" onClick={() => redo(v.id)}>
                          Refazer
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
