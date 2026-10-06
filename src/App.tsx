import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  Check,
  ChevronsUpDown,
  Clapperboard,
  FileCheck2,
  LayoutGrid,
  ListOrdered,
  Plus,
  Settings2,
  SlidersHorizontal,
  MonitorPlay,
  type LucideIcon
} from 'lucide-react'
import type { ChannelSummary } from '../shared/types'
import logo from './assets/logo.svg'
import NewChannelModal from './components/NewChannelModal'
import { ChannelAvatar } from './components/ui'
import { api, useLive } from './lib/api'
import { ChannelContext, rememberChannel } from './lib/channel'
import Channel from './pages/Channel'
import ChannelPicker from './pages/ChannelPicker'
import Production from './pages/Production'
import Queue from './pages/Queue'
import Review from './pages/Review'
import Services from './pages/Services'
import Settings from './pages/Settings'
import VideoDetail from './pages/VideoDetail'

type PageId =
  'production' | 'review' | 'channel' | 'channelSettings' | 'queue' | 'services' | 'settings'

const CHANNEL_PAGES: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: 'production', label: 'Produção', icon: Clapperboard },
  { id: 'review', label: 'Revisão de roteiros', icon: FileCheck2 },
  { id: 'channel', label: 'YouTube', icon: MonitorPlay },
  { id: 'channelSettings', label: 'Configurações do canal', icon: SlidersHorizontal }
]

const APP_PAGES: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: 'queue', label: 'Fila e Worker', icon: ListOrdered },
  { id: 'services', label: 'Serviços', icon: Activity },
  { id: 'settings', label: 'Configurações gerais', icon: Settings2 }
]

function TitleBar({ channel }: { channel?: ChannelSummary }): React.JSX.Element {
  return (
    <div className="app-drag flex h-9 shrink-0 items-center gap-2.5 border-b border-white/[0.05] bg-ink-950 pl-3.5 pr-[140px] text-xs text-ink-400">
      <img src={logo} alt="" className="h-[18px] w-[18px]" />
      <span className="font-medium text-ink-200">Canal Studio</span>
      {channel && (
        <>
          <span className="text-ink-600">/</span>
          <span className="truncate text-ink-300">{channel.name}</span>
        </>
      )}
    </div>
  )
}

function ChannelSwitcher({
  channel,
  channels,
  onSelect,
  onAll,
  onCreate
}: {
  channel: ChannelSummary
  channels: ChannelSummary[]
  onSelect: (id: number) => void
  onAll: () => void
  onCreate: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="channel-switcher"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-all duration-150 ${
          open
            ? 'border-brand-400/40 bg-ink-800'
            : 'border-white/[0.06] bg-ink-850 hover:border-white/10 hover:bg-ink-800'
        }`}
      >
        <ChannelAvatar
          name={channel.name}
          color={channel.color}
          avatar={channel.avatar_path}
          size={34}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{channel.name}</div>
          <div className="truncate text-[11px] text-ink-400">
            {channel.youtubeTitle ?? 'YouTube não conectado'}
          </div>
        </div>
        <ChevronsUpDown size={15} className="shrink-0 text-ink-500" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 animate-pop-in overflow-hidden rounded-xl border border-white/[0.08] bg-ink-850 p-1.5 shadow-2xl">
          <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Canais
          </div>
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setOpen(false)
                onSelect(c.id)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-ink-200 transition-colors hover:bg-ink-700"
            >
              <ChannelAvatar name={c.name} color={c.color} avatar={c.avatar_path} size={24} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.scriptReview + c.finalReview > 0 && (
                <span className="rounded-full bg-amber-400/15 px-1.5 text-[10px] font-semibold text-amber-200">
                  {c.scriptReview + c.finalReview}
                </span>
              )}
              {c.id === channel.id && <Check size={15} className="text-brand-300" />}
            </button>
          ))}
          <div className="my-1.5 h-px bg-white/[0.06]" />
          <button
            onClick={() => {
              setOpen(false)
              onCreate()
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink-200 transition-colors hover:bg-ink-700"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-700">
              <Plus size={14} />
            </span>
            Adicionar canal
          </button>
          <button
            onClick={() => {
              setOpen(false)
              onAll()
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink-200 transition-colors hover:bg-ink-700"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-700">
              <LayoutGrid size={14} />
            </span>
            Ver todos os canais
          </button>
        </div>
      )}
    </div>
  )
}

function NavItem({
  id,
  label,
  icon: Icon,
  active,
  badge,
  onClick
}: {
  id: PageId
  label: string
  icon: LucideIcon
  active: boolean
  badge?: number
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      data-testid={`nav-${id}`}
      onClick={onClick}
      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] transition-all duration-150 ${
        active
          ? 'bg-brand-400/10 font-medium text-white'
          : 'text-ink-400 hover:bg-ink-800/70 hover:text-ink-100'
      }`}
    >
      {active && (
        <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-brand-300" />
      )}
      <Icon
        size={17}
        className={`shrink-0 transition-colors ${
          active ? 'text-brand-300' : 'text-ink-500 group-hover:text-ink-300'
        }`}
      />
      <span className="flex-1 truncate">{label}</span>
      {!!badge && (
        <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-ink-950">
          {badge}
        </span>
      )}
    </button>
  )
}

function App(): React.JSX.Element {
  const { data: channels, reload } = useLive(() => api.channels.list(), ['channels', 'videos'])
  const [channelId, setChannelId] = useState<number | null>(null)
  const [page, setPage] = useState<PageId>('production')
  const [videoId, setVideoId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const channel = channels?.find((c) => c.id === channelId)

  const select = useCallback((id: number | null) => {
    setChannelId(id)
    setVideoId(null)
    setPage('production')
    if (id) rememberChannel(id)
  }, [])

  if (!channels) return <div className="h-full bg-ink-950" />

  if (!channel) {
    return (
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="min-h-0 flex-1">
          <ChannelPicker channels={channels} onSelect={select} onCreated={reload} />
        </div>
      </div>
    )
  }

  function go(id: PageId): void {
    setPage(id)
    setVideoId(null)
  }

  const badges: Partial<Record<PageId, number>> = {
    review: channel.scriptReview,
    production: channel.finalReview + channel.errors
  }

  function render(): React.JSX.Element {
    if (videoId !== null) {
      return (
        <VideoDetail
          key={videoId}
          id={videoId}
          onBack={() => setVideoId(null)}
          onOpen={setVideoId}
        />
      )
    }
    switch (page) {
      case 'production':
        return <Production onOpen={setVideoId} onReview={() => go('review')} />
      case 'review':
        return <Review onOpen={setVideoId} />
      case 'channel':
        return <Channel />
      case 'channelSettings':
        return <Settings scope="channel" />
      case 'queue':
        return <Queue onOpen={setVideoId} />
      case 'services':
        return <Services />
      case 'settings':
        return <Settings scope="global" />
    }
  }

  return (
    <ChannelContext.Provider value={{ channel, channels, select, reload }}>
      <div className="flex h-full flex-col">
        <TitleBar channel={channel} />
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-64 shrink-0 flex-col gap-6 border-r border-white/[0.05] bg-ink-900/60 px-3 py-4">
            <ChannelSwitcher
              channel={channel}
              channels={channels}
              onSelect={select}
              onAll={() => select(null)}
              onCreate={() => setCreating(true)}
            />
            <div className="space-y-0.5">
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Canal
              </div>
              {CHANNEL_PAGES.map((p) => (
                <NavItem
                  key={p.id}
                  {...p}
                  active={page === p.id && videoId === null}
                  badge={badges[p.id]}
                  onClick={() => go(p.id)}
                />
              ))}
            </div>
            <div className="space-y-0.5">
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Estúdio
              </div>
              {APP_PAGES.map((p) => (
                <NavItem
                  key={p.id}
                  {...p}
                  active={page === p.id && videoId === null}
                  onClick={() => go(p.id)}
                />
              ))}
            </div>
          </nav>
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div key={`${channel.id}-${page}-${videoId}`} className="animate-fade-in px-10 py-8">
              {render()}
            </div>
          </main>
        </div>
      </div>
      {creating && (
        <NewChannelModal
          channels={channels}
          defaultCopyFrom={channel.id}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false)
            reload()
            select(c.id)
          }}
        />
      )}
    </ChannelContext.Provider>
  )
}

export default App
