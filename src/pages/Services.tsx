import { useCallback, useEffect, useState } from 'react'
import type { ServiceState, ServiceStatus } from '../../shared/types'

const stateStyle: Record<ServiceState, { dot: string; label: string }> = {
  ok: { dot: 'bg-emerald-500', label: 'OK' },
  warning: { dot: 'bg-amber-400', label: 'Atenção' },
  missing: { dot: 'bg-red-500', label: 'Falta' }
}

export default function Services(): React.JSX.Element {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setServices(await window.api.services.check())
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(() => {
    setLoading(true)
    return load()
  }, [load])

  useEffect(() => {
    load()
  }, [load])

  async function start(id: string): Promise<void> {
    const result = await window.api.services.start(id)
    setMessage(result.message)
    if (result.ok) setTimeout(refresh, id === 'comfyui' ? 30000 : 4000)
  }

  async function install(id: string): Promise<void> {
    const result = await window.api.services.install(id)
    setMessage(result.message)
    setTimeout(refresh, 3000)
  }

  const okCount = services.filter((s) => s.state === 'ok').length

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Serviços</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {loading ? 'Verificando…' : `${okCount} de ${services.length} prontos`}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
        >
          Verificar de novo
        </button>
      </div>

      {message && (
        <div className="mt-4 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm">
          {message}
        </div>
      )}

      <ul className="mt-6 divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900">
        {services.map((s) => (
          <li key={s.id} className="flex items-center gap-4 px-4 py-3">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateStyle[s.state].dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{s.name}</span>
                {s.version && <span className="text-xs text-zinc-500">{s.version}</span>}
              </div>
              {s.detail && <div className="text-sm text-zinc-400">{s.detail}</div>}
              {s.hint && <div className="font-mono text-xs text-amber-300/80">{s.hint}</div>}
            </div>
            <span className="text-xs text-zinc-500">{stateStyle[s.state].label}</span>
            {s.canStart && (
              <button
                onClick={() => start(s.id)}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs hover:bg-emerald-600"
              >
                Iniciar
              </button>
            )}
            {s.canInstall && (
              <button
                onClick={() => install(s.id)}
                className="rounded-md bg-sky-700 px-3 py-1.5 text-xs hover:bg-sky-600"
              >
                Instalar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
