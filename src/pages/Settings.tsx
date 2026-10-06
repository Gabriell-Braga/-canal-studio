import { useEffect, useState, type ReactNode } from 'react'
import type { PublishSlot, Settings as SettingsT } from '../../shared/types'
import { Banner, Button, Card, Field, inputClass, PageHeader } from '../components/ui'
import { api, errorText, mediaUrl } from '../lib/api'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const TEMPLATE_NAMES: Record<string, string> = {
  documentary: 'Documentário (serifada, legenda embaixo)',
  bold: 'Impacto (fonte pesada, legenda no centro)',
  minimal: 'Minimalista (sem caixa, legenda embaixo)'
}

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </Card>
  )
}

export default function Settings(): React.JSX.Element {
  const [s, setS] = useState<SettingsT | null>(null)
  const [dataDir, setDataDir] = useState('')
  const [voices, setVoices] = useState<string[]>([])
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [sample, setSample] = useState<string | null>(null)
  const [sampling, setSampling] = useState(false)

  useEffect(() => {
    api.settings.get().then(setS)
    api.settings.dataDir().then(setDataDir)
    api.settings.voices().then(setVoices, () => setVoices([]))
  }, [])

  if (!s) return <p className="text-zinc-500">Carregando…</p>

  function set<K extends keyof SettingsT>(key: K, value: SettingsT[K]): void {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function save(): Promise<void> {
    try {
      setS(await api.settings.set(s!))
      setMessage({ kind: 'info', text: 'Configurações salvas.' })
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) })
    }
  }

  async function playSample(): Promise<void> {
    setSampling(true)
    try {
      await api.settings.set({ voice: s!.voice, voiceSpeed: s!.voiceSpeed })
      setSample(mediaUrl(await api.settings.voiceSample(), Date.now()))
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
    <div className="max-w-5xl space-y-5 pb-16">
      <PageHeader
        title="Configurações"
        actions={
          <Button variant="primary" onClick={save} data-testid="save-settings">
            Salvar
          </Button>
        }
      />
      {message && <Banner kind={message.kind}>{message.text}</Banner>}

      <Section title="Roteiro">
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

      <Section title="Fila e madrugada">
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

      <Section title="Voz">
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
            className="w-full accent-emerald-600"
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

      <Section title="Legendas (faster-whisper)">
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

      <Section title="Imagens e vídeos de banco">
        <Field label="Chave da Pexels API" hint="Grátis em pexels.com/api (veja o README).">
          <input
            className={inputClass}
            type="password"
            value={s.pexelsApiKey}
            onChange={(e) => set('pexelsApiKey', e.target.value)}
          />
        </Field>
        <Field
          label={`Proporção de imagens IA: ${Math.round(s.aiImageRatio * 100)}%`}
          hint="O resto usa vídeo de banco; sem resultado bom, cai para IA."
        >
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            className="w-full accent-emerald-600"
            value={s.aiImageRatio}
            onChange={(e) => set('aiImageRatio', Number(e.target.value))}
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

      <Section title="Vídeo">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-emerald-600"
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
            className="w-full accent-emerald-600"
            value={s.musicVolume}
            onChange={(e) => set('musicVolume', Number(e.target.value))}
          />
        </Field>
        <div className="md:col-span-2">
          <div className="mb-1 text-sm font-medium text-zinc-300">Templates em rodízio</div>
          <div className="flex flex-wrap gap-4">
            {Object.entries(TEMPLATE_NAMES).map(([id, name]) => (
              <label key={id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-600"
                  checked={s.templates.includes(id)}
                  onChange={(e) =>
                    set(
                      'templates',
                      e.target.checked ? [...s.templates, id] : s.templates.filter((t) => t !== id)
                    )
                  }
                />
                {name}
              </label>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Publicação">
        <div className="md:col-span-2">
          <div className="mb-2 text-sm font-medium text-zinc-300">Horários de publicação</div>
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
            className="h-4 w-4 accent-emerald-600"
            checked={s.syntheticDefault}
            onChange={(e) => set('syntheticDefault', e.target.checked)}
          />
          Marcar novos vídeos como conteúdo alterado/sintético
        </label>
      </Section>

      <Section title="YouTube (Google Cloud)">
        <Field label="Client ID OAuth" hint="Tipo: App para computador. Veja o guia na tela Canal.">
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

      <Section title="Sistema">
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
            className="h-4 w-4 accent-emerald-600"
            checked={s.startWithWindows}
            onChange={(e) => set('startWithWindows', e.target.checked)}
          />
          Iniciar com o Windows (minimizado na bandeja)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-emerald-600"
            checked={s.minimizeToTray}
            onChange={(e) => set('minimizeToTray', e.target.checked)}
          />
          Fechar a janela minimiza para a bandeja
        </label>
      </Section>
    </div>
  )
}
