import { useState } from 'react'
import Placeholder from './pages/Placeholder'
import Services from './pages/Services'

type PageId = 'production' | 'review' | 'queue' | 'channel' | 'services' | 'settings'

const pages: { id: PageId; label: string; phase?: number }[] = [
  { id: 'production', label: 'Produção', phase: 1 },
  { id: 'review', label: 'Revisão de roteiros', phase: 1 },
  { id: 'queue', label: 'Fila e Worker', phase: 2 },
  { id: 'channel', label: 'Canal', phase: 6 },
  { id: 'services', label: 'Serviços' },
  { id: 'settings', label: 'Configurações', phase: 1 }
]

function App(): React.JSX.Element {
  const [page, setPage] = useState<PageId>('services')
  const current = pages.find((p) => p.id === page)!

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-zinc-800 bg-zinc-900 p-3">
        <div className="mb-4 px-2 pt-1 text-lg font-semibold tracking-tight">Canal Studio</div>
        {pages.map((p) => (
          <button
            key={p.id}
            onClick={() => setPage(p.id)}
            className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
              page === p.id
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto p-8">
        {page === 'services' ? (
          <Services />
        ) : (
          <Placeholder title={current.label} phase={current.phase} />
        )}
      </main>
    </div>
  )
}

export default App
