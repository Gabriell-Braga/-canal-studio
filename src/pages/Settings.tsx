import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'
import {
  CHANNEL_SETTING_KEYS,
  type PublishSlot,
  type Settings as SettingsT
} from '../../shared/types'
import {
  Banner,
  Button,
  Card,
  ChannelAvatar,
  Field,
  inputClass,
  PageHeader
} from '../components/ui'
import { CHANNEL_COLORS } from '../lib/colors'
import { api, errorText, mediaUrl } from '../lib/api'
import { useChannel } from '../lib/channel'

type Scope = 'channel' | 'global'
const ScopeContext = createContext<Scope>('global')
const CHANNEL_KEYS = new Set<string>(CHANNEL_SETTING_KEYS)

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const TEMPLATE_NAMES: Record<string, string> = {
  documentary: 'Documentário (serifada, legenda embaixo)',
  bold: 'Impacto (fonte pesada, legenda no centro)',
  minimal: 'Minimalista (sem caixa, legenda embaixo)'
}

/** A settings card; it only shows on the page of its scope (this channel or the whole app). */
function Section({
  title,
  description,
  scope,
  children
}: {
  title: string
  description?: string
  scope: Scope
  children: ReactNode
}): React.JSX.Element | null {
  if (useContext(ScopeContext) !== scope) return null
  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-400">{description}</p>}
      <div className="mt-5 grid gap-5 md:grid-cols-2">{children}</div>
    </Card>
  )
}

function ChannelManagement(): React.JSX.Element {
  const { channel, channels, select, reload } = useChannel()
  const [name, setName] = useState(channel.name)
  const [musicDir, setMusicDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    api.channels.musicDir(channel.id).then(setMusicDir)
  }, [channel.id])

  async function update(patch: { name?: string; color?: string }): Promise<void> {
    try {
      await api.channels.update(channel.id, patch)
      reload()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function remove(): Promise<void> {
    try {
      await api.channels.remove(channel.id)
      reload()
      select(null)
    } catch (e) {
      setError(errorText(e))
      setConfirmDelete(false)
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-white">Canal</h2>
      {error && (
        <div className="mt-3">
          <Banner kind="error">{error}</Banner>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-end gap-5">
        <ChannelAvatar name={name || '?'} color={channel.color} size={52} />
        <div className="min-w-64 flex-1">
          <Field label="Nome">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name !== channel.name) update({ name })
              }}
            />
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-200">Cor</span>
          <div className="flex h-[38px] items-center gap-2">
            {CHANNEL_COLORS.map((c) => (
              <button
                key={c}
                aria-label={'Cor ' + c}
                onClick={() => update({ color: c })}
                className={
                  'h-6 w-6 rounded-full transition-transform duration-150 hover:scale-110 ' +
                  (channel.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-900' : '')
                }
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5">
        <Field
          label="Pasta de músicas deste canal"
          hint="Coloque aqui as faixas da Biblioteca de Áudio do YouTube."
        >
          <div className="flex gap-2">
            <input className={inputClass} value={musicDir} readOnly />
            <Button onClick={() => api.channels.openMusicDir(channel.id)}>
              <FolderOpen size={15} /> Abrir
            </Button>
          </div>
        </Field>
      </div>
      {channels.length > 1 && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-4 py-3">
          <div className="text-sm text-ink-300">
            Excluir este canal e as configurações dele. Só é possível quando ele não tem vídeos.
          </div>
          {confirmDelete ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </Button>
              <Button size="sm" variant="danger" onClick={remove}>
                Confirmar exclusão
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} /> Excluir canal
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

export default function Settings({ scope }: { scope: Scope }): React.JSX.Element {
  const { channel } = useChannel()
  const channelId = scope === 'channel' ? channel.id : undefined
  const [s, setS] = useState<SettingsT | null>(null)
  const [dataDir, setDataDir] = useState('')
  const [voices, setVoices] = useState<string[]>([])
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [sample, setSample] = useState<string | null>(null)
  const [sampling, setSampling] = useState(false)

  useEffect(() => {
    api.settings.get(channelId).then(setS)
    api.settings.dataDir().then(setDataDir)
    if (scope === 'channel') api.settings.voices().then(setVoices, () => setVoices([]))
  }, [channelId, scope])

  if (!s) return <p className="text-ink-500">Carregando…</p>

  function set<K extends keyof SettingsT>(key: K, value: SettingsT[K]): void {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function save(): Promise<void> {
    try {
      // Each page saves only its own keys, so a channel never overwrites the shared ones.
      const patch = Object.fromEntries(
        Object.entries(s!).filter(([k]) => CHANNEL_KEYS.has(k) === (scope === 'channel'))
      ) as Partial<SettingsT>
      setS(await api.settings.set(patch, channelId))
      setMessage({ kind: 'info', text: 'Configurações salvas.' })
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    }
  }

  async function playSample(): Promise<void> {
    setSampling(true)
    try {
      await api.settings.set({ voice: s!.voice, voiceSpeed: s!.voiceSpeed }, channel.id)
      setSample(mediaUrl(await api.settings.voiceSample(channel.id), Date.now()))
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    } finally {
      setSampling(false)
    }
  }

  async function chooseDir(): Promise<void> {
    const dir = await api.settings.chooseDataDir()
    if (dir) {
      setDataDir(dir)
      setMessage({ kind: 'info', text: 'Pasta alterada. Reinicie o app para usar a nova pasta.' })
    }
  }

  function setSlot(i: number, patch: Partial<PublishSlot>): void {
    set(
      'publishSlots',
      s!.publishSlots.map((slot, j) => (j === i ? { ...slot, ...patch } : slot))
    )
  }

  const num = (v: string): number => (v === '' ? 0 : Number(v))

  return (
    <ScopeContext.Provider value={scope}>
      <div className="max-w-5xl space-y-5 pb-16">
        <PageHeader
          title={scope === 'channel' ? 'Configurações do canal' : 'Configurações gerais'}
          subtitle={
            scope === 'channel'
              ? 'Valem só para ' + channel.name + '. Os outros canais não mudam.'
              : 'Valem para todos os canais: modelos, fila, GPU e contas.'
          }
          actions={
            <Button variant="primary" onClick={save} data-testid="save-settings">
              Salvar
            </Button>
          }
        />
        {message && <Banner kind={message.kind}>{message.text}</Banner>}

        {scope === 'channel' && <ChannelManagement key={channel.id} />}

        <Section title="Modelo de linguagem" scope="global">
          <Field label="Modelo do Ollama" hint="Padrão: qwen3:14b. Alternativa: gemma3:12b.">
            <input
              className={inputClass}
              value={s.ollamaModel}
              onChange={(e) => set('ollamaModel', e.target.value)}
            />
          </Field>
          <Field label="Endereço do Ollama">
            <input
              className={inputClass}
              value={s.ollamaUrl}
              onChange={(e) => set('ollamaUrl', e.target.value)}
            />
          </Field>
        </Section>

        <Section title="Roteiro" scope="channel">
          <Field label="Duração padrão (minutos)">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={s.defaultDurationMin}
              onChange={(e) => set('defaultDurationMin', num(e.target.value))}
            />
          </Field>
          <Field
            label="Nicho do canal"
            hint="Ex.: history mysteries. Vai junto com o tema no prompt."
          >
            <input
              className={inputClass}
              value={s.defaultNiche}
              onChange={(e) => set('defaultNiche', e.target.value)}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Prompt do roteiro" hint="Variáveis: {topic} {minutes} {words} {scenes}">
              <textarea
                className={`${inputClass} h-56 font-mono text-xs`}
                value={s.scriptPrompt}
                onChange={(e) => set('scriptPrompt', e.target.value)}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Prompt da auto-revisão" hint="Variáveis: {topic} {script}">
              <textarea
                className={`${inputClass} h-40 font-mono text-xs`}
                value={s.reviewPrompt}
                onChange={(e) => set('reviewPrompt', e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Fila e madrugada"
          scope="global"
          description="A GPU é uma só: a fila é compartilhada por todos os canais."
        >
          <Field label="Início da janela noturna">
            <input
              className={inputClass}
              type="time"
              value={s.nightStart}
              onChange={(e) => set('nightStart', e.target.value)}
            />
          </Field>
          <Field label="Fim da janela noturna">
            <input
              className={inputClass}
              type="time"
              value={s.nightEnd}
              onChange={(e) => set('nightEnd', e.target.value)}
            />
          </Field>
          <Field label="Limite de vídeos por noite">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={s.maxVideosPerNight}
              onChange={(e) => set('maxVideosPerNight', num(e.target.value))}
            />
          </Field>
        </Section>

        <Section title="Voz" scope="channel">
          <Field
            label="Voz do Kokoro"
            hint="Prefixo am_/af_ = inglês americano, bm_/bf_ = britânico."
          >
            {voices.length ? (
              <select
                className={inputClass}
                value={s.voice}
                onChange={(e) => set('voice', e.target.value)}
              >
                {voices.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            ) : (
              <input
                className={inputClass}
                value={s.voice}
                onChange={(e) => set('voice', e.target.value)}
              />
            )}
          </Field>
          <Field label={`Velocidade: ${s.voiceSpeed.toFixed(2)}x`}>
            <input
              type="range"
              min={0.7}
              max={1.3}
              step={0.05}
              className="w-full"
              value={s.voiceSpeed}
              onChange={(e) => set('voiceSpeed', Number(e.target.value))}
            />
          </Field>
          <Field label="Pausa entre cenas (segundos)">
            <input
              className={inputClass}
              type="number"
              min={0}
              step={0.05}
              value={s.scenePauseSec}
              onChange={(e) => set('scenePauseSec', num(e.target.value))}
            />
          </Field>
          <div className="flex items-end gap-3">
            <Button onClick={playSample} disabled={sampling}>
              {sampling ? 'Gerando…' : 'Ouvir amostra'}
            </Button>
            {sample && <audio src={sample} controls autoPlay className="h-9" />}
          </div>
        </Section>

        <Section title="Legendas (faster-whisper)" scope="global">
          <Field label="Modelo do Whisper" hint="small.en é rápido e bom para narração limpa.">
            <select
              className={inputClass}
              value={s.whisperModel}
              onChange={(e) => set('whisperModel', e.target.value)}
            >
              {['tiny.en', 'base.en', 'small.en', 'medium.en', 'large-v3'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Dispositivo"
            hint="Automático tenta CUDA e cai para CPU (int8) se faltar DLL."
          >
            <select
              className={inputClass}
              value={s.whisperDevice}
              onChange={(e) => set('whisperDevice', e.target.value as SettingsT['whisperDevice'])}
            >
              <option value="auto">Automático</option>
              <option value="cuda">GPU (CUDA)</option>
              <option value="cpu">CPU</option>
            </select>
          </Field>
        </Section>

        <Section title="Imagens" scope="channel">
          <Field
            label={`Proporção de imagens IA: ${Math.round(s.aiImageRatio * 100)}%`}
            hint="O resto usa vídeo de banco; sem resultado bom, cai para IA."
          >
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              className="w-full"
              value={s.aiImageRatio}
              onChange={(e) => set('aiImageRatio', Number(e.target.value))}
            />
          </Field>
        </Section>

        <Section title="Imagens e vídeos de banco" scope="global">
          <Field label="Chave da Pexels API" hint="Grátis em pexels.com/api (veja o README).">
            <input
              className={inputClass}
              type="password"
              value={s.pexelsApiKey}
              onChange={(e) => set('pexelsApiKey', e.target.value)}
            />
          </Field>
          <Field label="Pasta do ComfyUI">
            <input
              className={inputClass}
              value={s.comfyPath}
              onChange={(e) => set('comfyPath', e.target.value)}
            />
          </Field>
          <Field label="Endereço do ComfyUI">
            <input
              className={inputClass}
              value={s.comfyUrl}
              onChange={(e) => set('comfyUrl', e.target.value)}
            />
          </Field>
          <Field label="Checkpoint" hint="Arquivo em ComfyUI\models\checkpoints">
            <input
              className={inputClass}
              value={s.comfyCheckpoint}
              onChange={(e) => set('comfyCheckpoint', e.target.value)}
            />
          </Field>
        </Section>

        <Section title="Vídeo" scope="channel">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={s.captionsEnabled}
              onChange={(e) => set('captionsEnabled', e.target.checked)}
            />
            Legendas animadas palavra por palavra
          </label>
          <Field
            label={`Volume da música: ${Math.round(s.musicVolume * 100)}%`}
            hint="Coloque as músicas em dados/musica."
          >
            <input
              type="range"
              min={0}
              max={0.4}
              step={0.01}
              className="w-full"
              value={s.musicVolume}
              onChange={(e) => set('musicVolume', Number(e.target.value))}
            />
          </Field>
          <div className="md:col-span-2">
            <div className="mb-1 text-sm font-medium text-ink-300">Templates em rodízio</div>
            <div className="flex flex-wrap gap-4">
              {Object.entries(TEMPLATE_NAMES).map(([id, name]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={s.templates.includes(id)}
                    onChange={(e) =>
                      set(
                        'templates',
                        e.target.checked
                          ? [...s.templates, id]
                          : s.templates.filter((t) => t !== id)
                      )
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Publicação" scope="channel">
          <div className="md:col-span-2">
            <div className="mb-2 text-sm font-medium text-ink-300">Horários de publicação</div>
            <div className="space-y-2">
              {s.publishSlots.map((slot, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className={`${inputClass} max-w-28`}
                    value={slot.weekday}
                    onChange={(e) => setSlot(i, { weekday: Number(e.target.value) })}
                  >
                    {WEEKDAYS.map((d, n) => (
                      <option key={d} value={n}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input
                    className={`${inputClass} max-w-32`}
                    type="time"
                    value={slot.time}
                    onChange={(e) => setSlot(i, { time: e.target.value })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      set(
                        'publishSlots',
                        s.publishSlots.filter((_, j) => j !== i)
                      )
                    }
                  >
                    Remover
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                onClick={() =>
                  set('publishSlots', [...s.publishSlots, { weekday: 1, time: '14:00' }])
                }
              >
                + Horário
              </Button>
            </div>
          </div>
          <Field label="Fuso horário dos horários" hint="Ex.: America/New_York, America/Sao_Paulo">
            <input
              className={inputClass}
              value={s.publishTimezone}
              onChange={(e) => set('publishTimezone', e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={s.syntheticDefault}
              onChange={(e) => set('syntheticDefault', e.target.checked)}
            />
            Marcar novos vídeos como conteúdo alterado/sintético
          </label>
        </Section>

        <Section
          title="YouTube (Google Cloud)"
          scope="global"
          description="Um projeto do Google Cloud serve para todos os canais. Cada canal conecta a própria conta na tela YouTube."
        >
          <Field
            label="Client ID OAuth"
            hint="Tipo: App para computador. Veja o guia na tela Canal."
          >
            <input
              className={inputClass}
              value={s.googleClientId}
              onChange={(e) => set('googleClientId', e.target.value)}
            />
          </Field>
          <Field label="Client secret">
            <input
              className={inputClass}
              type="password"
              value={s.googleClientSecret}
              onChange={(e) => set('googleClientSecret', e.target.value)}
            />
          </Field>
        </Section>

        <Section title="Sistema" scope="global">
          <div className="md:col-span-2">
            <Field
              label="Pasta de dados"
              hint="Banco, projetos e músicas. Mudar exige reiniciar o app."
            >
              <div className="flex gap-2">
                <input className={inputClass} value={dataDir} readOnly />
                <Button onClick={chooseDir}>Alterar…</Button>
              </div>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={s.startWithWindows}
              onChange={(e) => set('startWithWindows', e.target.checked)}
            />
            Iniciar com o Windows (minimizado na bandeja)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={s.minimizeToTray}
              onChange={(e) => set('minimizeToTray', e.target.checked)}
            />
            Fechar a janela minimiza para a bandeja
          </label>
        </Section>
      </div>
    </ScopeContext.Provider>
  )
}
