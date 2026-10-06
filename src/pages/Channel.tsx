import { useState } from 'react'
import { Banner, Button, Card, PageHeader } from '../components/ui'
import { api, errorText, formatDate, useLive } from '../lib/api'

function fmt(n: number): string {
  return n.toLocaleString('pt-BR')
}

function duration(sec: number): string {
  const m = Math.floor(sec / 60)
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`
}

export default function Channel(): React.JSX.Element {
  const { data: stats, reload } = useLive(() => api.youtube.stats(), ['channel', 'videos'])
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [guide, setGuide] = useState(false)

  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    setBusy(true)
    try {
      await fn()
      setMessage({ kind: 'info', text: ok })
      reload()
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const totals = (stats?.videos ?? []).reduce(
    (t, v) => ({
      views: t.views + v.views,
      watch: t.watch + v.watchMinutes,
      subs: t.subs + v.subscribersGained
    }),
    { views: 0, watch: 0, subs: 0 }
  )
  const quotaPct = stats ? Math.round((stats.quotaUsedToday / stats.quotaLimit) * 100) : 0
  const uploadsLeft = stats ? Math.floor((stats.quotaLimit - stats.quotaUsedToday) / 1650) : 0

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Canal"
        subtitle={
          stats?.connected
            ? `Conectado: ${stats.channelTitle ?? 'canal'} · métricas de ${formatDate(stats.updatedAt)}`
            : 'YouTube não conectado'
        }
        actions={
          stats?.connected ? (
            <>
              <Button
                disabled={busy}
                onClick={() => run(() => api.youtube.stats(true), 'Métricas atualizadas.')}
              >
                Atualizar métricas
              </Button>
              <Button
                variant="ghost"
                onClick={() => run(() => api.youtube.disconnect(), 'Desconectado.')}
              >
                Desconectar
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api.youtube.connect()
                  if (!r.ok) throw new Error(r.message)
                }, 'YouTube conectado.')
              }
            >
              {busy ? 'Esperando o login no navegador…' : 'Conectar YouTube'}
            </Button>
          )
        }
      />
      {message && <Banner kind={message.kind}>{message.text}</Banner>}

      <Banner kind="warn">
        <b>Cota da API:</b> {fmt(stats?.quotaUsedToday ?? 0)} de {fmt(stats?.quotaLimit ?? 10000)}{' '}
        unidades usadas hoje ({quotaPct}%). Cada upload gasta ~1.650 unidades (vídeo + thumbnail):
        cabem cerca de {uploadsLeft} upload(s) até a cota zerar (meia-noite do Pacífico).
        <br />
        <b>Projeto não verificado:</b> enquanto o app do Google Cloud não passar pela auditoria, o
        YouTube trava os uploads como privados. Os vídeos sobem e agendam normalmente, mas você
        precisa torná-los públicos no YouTube Studio (ou pedir a auditoria). Veja o guia abaixo.
      </Banner>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Visualizações</div>
          <div className="mt-1 text-2xl font-semibold">{fmt(totals.views)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Tempo de exibição</div>
          <div className="mt-1 text-2xl font-semibold">{fmt(Math.round(totals.watch / 60))} h</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Inscritos ganhos</div>
          <div className="mt-1 text-2xl font-semibold">{fmt(totals.subs)}</div>
        </Card>
      </div>

      <Card className="mb-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-2">Vídeo</th>
              <th className="px-4 py-2 text-right">Views</th>
              <th className="px-4 py-2 text-right">Exibição (min)</th>
              <th className="px-4 py-2 text-right">Duração média</th>
              <th className="px-4 py-2 text-right">CTR impressões</th>
              <th className="px-4 py-2 text-right">Inscritos</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.videos ?? []).map((v) => (
              <tr key={v.video_id} className="border-b border-zinc-800/60">
                <td className="px-4 py-2">
                  <a
                    href={`https://youtu.be/${v.youtube_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {v.title}
                  </a>
                </td>
                <td className="px-4 py-2 text-right">{fmt(v.views)}</td>
                <td className="px-4 py-2 text-right">{fmt(Math.round(v.watchMinutes))}</td>
                <td className="px-4 py-2 text-right">{duration(v.avgViewDurationSec)}</td>
                <td
                  className="px-4 py-2 text-right text-zinc-500"
                  title="A API pública não fornece CTR; veja no YouTube Studio"
                >
                  {v.impressionsCtr === null
                    ? 'só no Studio'
                    : `${(v.impressionsCtr * 100).toFixed(1)}%`}
                </td>
                <td className="px-4 py-2 text-right">{fmt(v.subscribersGained)}</td>
              </tr>
            ))}
            {!stats?.videos.length && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-zinc-500">
                  Nenhum vídeo enviado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="p-5">
        <button className="text-left font-semibold" onClick={() => setGuide(!guide)}>
          {guide ? '▾' : '▸'} Guia: configurar o Google Cloud (uma vez, ~15 min)
        </button>
        {guide && (
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm text-zinc-300">
            <li>
              Abra <span className="font-mono">console.cloud.google.com</span> com a conta Google
              dona do canal. No topo, clique no seletor de projeto → <b>Novo projeto</b> → nome
              “Canal Studio” → Criar.
            </li>
            <li>
              Menu ☰ → <b>APIs e serviços → Biblioteca</b>. Ative <b>YouTube Data API v3</b> e{' '}
              <b>YouTube Analytics API</b>.
            </li>
            <li>
              <b>APIs e serviços → Tela de consentimento OAuth</b> (ou “Google Auth Platform”): tipo{' '}
              <b>Externo</b>, nome do app “Canal Studio”, seu e-mail como suporte e contato. Em{' '}
              <b>Público-alvo / Usuários de teste</b>, adicione o e-mail do canal. Deixe o app em
              modo <b>Teste</b>.
            </li>
            <li>
              <b>APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth</b>. Tipo
              de aplicativo: <b>App para computador</b>. Copie o <b>Client ID</b> e o{' '}
              <b>Client secret</b>.
            </li>
            <li>
              No Canal Studio: <b>Configurações → YouTube</b>, cole os dois valores e salve. Volte
              aqui e clique em <b>Conectar YouTube</b>. O navegador abre; escolha a conta do canal e
              aceite. Como o app está em teste, o Google mostra “app não verificado”: clique em{' '}
              <b>Avançado → Acessar Canal Studio</b>.
            </li>
            <li>
              <b>Limites do modo teste:</b> o refresh token de apps em teste expira em 7 dias
              (reconecte quando o upload falhar com erro de autenticação). Para tirar esse limite e
              destravar uploads públicos, publique o app e peça a <b>auditoria da API do YouTube</b>{' '}
              (formulário “YouTube API Services – Audit and Quota Extension”).
            </li>
            <li>
              Para thumbnails personalizadas, o canal precisa estar verificado por telefone em{' '}
              <span className="font-mono">youtube.com/verify</span>.
            </li>
          </ol>
        )}
      </Card>
    </div>
  )
}
