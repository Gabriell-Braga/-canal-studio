import { useState } from 'react'
import { Plus, MonitorPlay } from 'lucide-react'
import type { ChannelSummary } from '../../shared/types'
import logo from '../assets/logo.svg'
import NewChannelModal from '../components/NewChannelModal'
import { Badge, ChannelAvatar } from '../components/ui'
import { lastChannel } from '../lib/channel'

interface Props {
  channels: ChannelSummary[]
  onSelect: (id: number) => void
  onCreated: () => void
}

/** First screen: pick the channel to work on, or add a new one. */
export default function ChannelPicker({ channels, onSelect, onCreated }: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const last = lastChannel()

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-8 pb-16 pt-12">
      <div className="flex w-full max-w-4xl animate-fade-in flex-col items-center text-center">
        <img
          src={logo}
          alt=""
          className="h-16 w-16 drop-shadow-[0_10px_30px_rgba(159,234,249,0.25)]"
        />
        <h1 className="mt-5 text-3xl font-semibold text-white">Qual canal hoje?</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-400">
          Cada canal tem roteiros, voz, templates, horários e YouTube próprios. A fila da GPU é
          compartilhada entre todos.
        </p>

        <div className="mt-10 grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((c, i) => {
            const pending = c.scriptReview + c.finalReview
            return (
              <button
                key={c.id}
                data-testid="channel-card"
                onClick={() => onSelect(c.id)}
                style={{ animationDelay: `${i * 40}ms` }}
                className={`relative flex animate-fade-in flex-col rounded-2xl border bg-ink-900 p-5 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-brand-400/40 hover:bg-ink-850 hover:shadow-[0_18px_40px_-20px_rgba(159,234,249,0.35)] ${
                  c.id === last ? 'border-brand-400/30' : 'border-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <ChannelAvatar name={c.name} color={c.color} size={44} />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-white">{c.name}</div>
                    <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-400">
                      <MonitorPlay
                        size={13}
                        className={c.youtubeTitle ? 'text-red-400' : 'text-ink-600'}
                      />
                      {c.youtubeTitle ?? 'YouTube não conectado'}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  <Badge>{c.videos} vídeo(s)</Badge>
                  {pending > 0 && <Badge tone="warn">{pending} para revisar</Badge>}
                  {c.scheduled > 0 && <Badge tone="brand">{c.scheduled} agendado(s)</Badge>}
                  {c.errors > 0 && <Badge tone="error">{c.errors} com erro</Badge>}
                </div>
                {c.id === last && (
                  <span className="absolute right-4 top-4 text-[10px] font-semibold uppercase tracking-wider text-brand-300">
                    Último usado
                  </span>
                )}
              </button>
            )
          })}

          <button
            data-testid="add-channel"
            onClick={() => setCreating(true)}
            className="group flex min-h-[148px] animate-fade-in flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-600 text-ink-400 transition-all duration-200 hover:border-brand-400/60 hover:bg-brand-400/[0.04] hover:text-brand-200"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-800 transition-colors duration-200 group-hover:bg-brand-400/15">
              <Plus size={22} />
            </span>
            <span className="text-sm font-medium">Adicionar canal</span>
          </button>
        </div>
      </div>

      {creating && (
        <NewChannelModal
          channels={channels}
          defaultCopyFrom={last}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false)
            onCreated()
            onSelect(c.id)
          }}
        />
      )}
    </div>
  )
}
