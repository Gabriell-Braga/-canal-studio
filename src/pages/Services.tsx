import { useCallback, useEffect, useState } from 'react'
import { Download, Play, RefreshCw } from 'lucide-react'
import type { ServiceState, ServiceStatus } from '../../shared/types'
import { Badge, Banner, Button, Card, PageHeader } from '../components/ui'

const stateStyle: Record<ServiceState, { dot: string; label: string }> = {
  ok: { dot: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]', label: 'OK' },
  warning: { dot: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]', label: 'Atenção' },
  missing: { dot: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]', label: 'Falta' }
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
      <PageHeader
        title="Serviços"
        subtitle={loading ? 'Verificando…' : `${okCount} de ${services.length} prontos`}
        actions={
          <Button onClick={refresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Verificar de novo
          </Button>
        }
      />
      {message && <Banner>{message}</Banner>}
      <Card className="overflow-hidden">
        <ul className="divide-y divide-white/[0.05]">
          {services.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.015]"
            >
              <span
                className={`flex h-2.5 w-2.5 shrink-0 rounded-full ${stateStyle[s.state].dot}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-ink-100">{s.name}</span>
                  {s.version && <span className="text-xs text-ink-500">{s.version}</span>}
                </div>
                {s.detail && <div className="text-sm text-ink-400">{s.detail}</div>}
                {s.hint && (
                  <div className="mt-0.5 font-mono text-xs text-amber-300/80">{s.hint}</div>
                )}
              </div>
              <Badge tone={s.state === 'ok' ? 'ok' : s.state === 'warning' ? 'warn' : 'error'}>
                {stateStyle[s.state].label}
              </Badge>
              {s.canStart && (
                <Button size="sm" variant="primary" onClick={() => start(s.id)}>
                  <Play size={13} /> Iniciar
                </Button>
              )}
              {s.canInstall && (
                <Button size="sm" variant="outline" onClick={() => install(s.id)}>
                  <Download size={13} /> Instalar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
