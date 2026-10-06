import { useState } from 'react'
import { api, useLive } from './lib/api'
import Placeholder from './pages/Placeholder'
import Production from './pages/Production'
import Review from './pages/Review'
import Services from './pages/Services'
import Settings from './pages/Settings'
import VideoDetail from './pages/VideoDetail'

type PageId = 'production' | 'review' | 'queue' | 'channel' | 'services' | 'settings'

const pages: { id: PageId; label: string }[] = [
  { id: 'production', label: 'Produção' },
  { id: 'review', label: 'Revisão de roteiros' },
  { id: 'queue', label: 'Fila e Worker' },
  { id: 'channel', label: 'Canal' },
  { id: 'services', label: 'Serviços' },
  { id: 'settings', label: 'Configurações' }
]

function App(): React.JSX.Element {
  const [page, setPage] = useState<PageId>('production')
  const [videoId, setVideoId] = useState<number | null>(null)
  const { data: videos = [] } = useLive(() => api.videos.list(), ['videos'])
  const badges: Partial<Record<PageId, number>> = {
    review: videos.filter((v) => v.status === 'SCRIPT_REVIEW').length,
    production: videos.filter((v) => ['FINAL_REVIEW', 'ERROR'].includes(v.status)).length
  }

  function go(id: PageId): void {
    setPage(id)
    setVideoId(null)
  }

  function render(): React.JSX.Element {
    if (videoId !== null) return <VideoDetail id={videoId} onBack={() => setVideoId(null)} />
    switch (page) {
      case 'production':
        return <Production onOpen={setVideoId} onReview={() => go('review')} />
      case 'review':
        return <Review onOpen={setVideoId} />
      case 'services':
        return <Services />
      case 'settings':
        return <Settings />
      case 'queue':
        return <Placeholder title="Fila e Worker" phase={2} />
      case 'channel':
        return <Placeholder title="Canal" phase={6} />
    }
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-zinc-800 bg-zinc-900 p-3">
        <div className="mb-4 px-2 pt-1 text-lg font-semibold tracking-tight">Canal Studio</div>
        {pages.map((p) => (
          <button
            key={p.id}
            data-testid={`nav-${p.id}`}
            onClick={() => go(p.id)}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
              page === p.id && videoId === null
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
            }`}
          >
            {p.label}
            {!!badges[p.id] && (
              <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-zinc-950">
                {badges[p.id]}
              </span>
            )}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto p-8">{render()}</main>
    </div>
  )
}

export default App
