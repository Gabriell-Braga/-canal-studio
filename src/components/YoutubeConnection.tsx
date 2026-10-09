import { useState } from 'react'
import { Banner, Button, Card } from './ui'
import { api, errorText, useLive } from '../lib/api'
import { useChannel } from '../lib/channel'

function fmt(n: number): string {
  return n.toLocaleString('pt-BR')
}

/** This channel's YouTube login and today's API quota (Configurações do canal). */
export function YoutubeConnection(): React.JSX.Element {
  const { channel } = useChannel()
  const { data: stats, reload } = useLive(
    () => api.youtube.stats(channel.id),
    ['channel', 'videos'],
    [channel.id]
  )
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: settings } = useLive(() => api.settings.get(channel.id), ['settings'], [channel.id])

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

  const quotaPct = stats ? Math.round((stats.quotaUsedToday / stats.quotaLimit) * 100) : 0
  const uploadsLeft = stats ? Math.floor((stats.quotaLimit - stats.quotaUsedToday) / 1650) : 0

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">YouTube</h2>
          <p className="mt-1 text-sm text-ink-400">
            {stats?.connected
              ? `Conectado a ${stats.channelTitle ?? 'canal'}`
              : 'Não conectado. O Client ID e o secret ficam em Configurações gerais → YouTube.'}
          </p>
        </div>
        {stats?.connected ? (
          <Button
            variant="ghost"
            onClick={() => run(() => api.youtube.disconnect(channel.id), 'Desconectado.')}
          >
            Desconectar
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.youtube.connect(channel.id)
                if (!r.ok) throw new Error(r.message)
              }, 'YouTube conectado.')
            }
          >
            {busy ? 'Esperando o login no navegador…' : 'Conectar YouTube'}
          </Button>
        )}
      </div>
      <div className="mt-5">
        {message && <Banner kind={message.kind}>{message.text}</Banner>}

        <Banner kind="warn">
          <b>Cota da API:</b> {fmt(stats?.quotaUsedToday ?? 0)} de {fmt(stats?.quotaLimit ?? 10000)}{' '}
          unidades usadas hoje ({quotaPct}%). Cada upload gasta ~1.650 unidades (vídeo + thumbnail):
          cabem cerca de {uploadsLeft} upload(s) até a cota zerar (meia-noite do Pacífico).
          {settings && !settings.youtubeAudited && (
            <>
              <br />
              <b>Projeto sem auditoria:</b> enquanto o projeto do Google Cloud não passar pela
              auditoria da API, o YouTube pode travar os uploads como privados e ignorar o
              agendamento. Os vídeos sobem normalmente; a página Publicados mostra se cada um ficou
              público ou privado no YouTube. Quando a auditoria for aprovada, marque a opção em
              Configurações gerais → YouTube.
            </>
          )}
        </Banner>
      </div>
    </Card>
  )
}

/** Step-by-step Google Cloud setup, folded (Configurações gerais → YouTube). */
export function YoutubeGuide(): React.JSX.Element {
  const [guide, setGuide] = useState(false)
  return (
    <div className="md:col-span-2">
      <button
        className="text-left text-sm font-medium text-ink-200"
        onClick={() => setGuide(!guide)}
      >
        {guide ? '▾' : '▸'} Guia: configurar o Google Cloud (uma vez, ~15 min)
      </button>
      {guide && (
        <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm text-ink-300">
          <li>
            Abra <span className="font-mono">console.cloud.google.com</span> com a conta Google dona
            do canal. No topo, clique no seletor de projeto → <b>Novo projeto</b> → nome “Canal
            Studio” → Criar.
          </li>
          <li>
            Menu ☰ → <b>APIs e serviços → Biblioteca</b>. Ative <b>YouTube Data API v3</b> e{' '}
            <b>YouTube Analytics API</b>.
          </li>
          <li>
            <b>APIs e serviços → Tela de consentimento OAuth</b> (ou “Google Auth Platform”): tipo{' '}
            <b>Externo</b>, nome do app “Canal Studio”, seu e-mail como suporte e contato. Em{' '}
            <b>Público-alvo / Usuários de teste</b>, adicione o e-mail do canal. Deixe o app em modo{' '}
            <b>Teste</b>.
          </li>
          <li>
            <b>APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth</b>. Tipo de
            aplicativo: <b>App para computador</b>. Copie o <b>Client ID</b> e o{' '}
            <b>Client secret</b>.
          </li>
          <li>
            No Canal Studio: <b>Configurações → YouTube</b>, cole os dois valores e salve. Depois,
            em <b>Configurações do canal</b>, clique em <b>Conectar YouTube</b>. O navegador abre;
            escolha a conta do canal e aceite. O Google mostra “app não verificado”: clique em{' '}
            <b>Avançado → Acessar Canal Studio</b>. Para uso próprio, você não precisa verificar o
            app.
          </li>
          <li>
            <b>Login que não expira:</b> em modo Teste, o login vence a cada 7 dias. Em{' '}
            <b>Tela de consentimento OAuth → Público-alvo</b>, clique em <b>Publicar app</b> (status
            “Em produção”) e reconecte cada canal uma vez. O aviso de “app não verificado” continua,
            mas o login não vence mais.
          </li>
          <li>
            <b>Uploads públicos (auditoria da API):</b> sem ela, todo vídeo enviado fica travado
            como privado. Peça no formulário “YouTube API Services – Audit and Quota Extension”. As
            respostas prontas, a política de privacidade e o roteiro do vídeo de tela estão em{' '}
            <span className="font-mono">docs/youtube-audit.md</span> no projeto. A resposta leva de
            semanas a meses; até lá, publique pelo YouTube Studio.
          </li>
          <li>
            Para thumbnails personalizadas, o canal precisa estar verificado por telefone em{' '}
            <span className="font-mono">youtube.com/verify</span>.
          </li>
        </ol>
      )}
    </div>
  )
}
