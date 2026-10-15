import { useEffect, useState } from 'react'
import type { AdEvidence, Script, Video } from '../../shared/types'
import { quoteInText, type AnnouncerPlan } from '../../shared/formats/vintage-ads'
import { api, errorText, mediaUrl } from '../lib/api'
import { Banner, Button, Field, inputClass } from './ui'

interface Props {
  video: Video
  onDone: () => void
  onCancel?: () => void
}

/** Edit title, hook, every scene and the outro. Saving rewrites the scenes table. */
export default function ScriptEditor({ video, onDone, onCancel }: Props): React.JSX.Element {
  const [title, setTitle] = useState(video.title ?? '')
  const [script, setScript] = useState<Script>(
    video.script ?? { title_options: [], hook: '', scenes: [], outro: '' }
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [evidence, setEvidence] = useState<AdEvidence | null>(null)

  const [plan, setPlan] = useState<AnnouncerPlan | null>(null)
  const [preview, setPreview] = useState<{ scene: number; src: string | null } | null>(null)

  useEffect(() => {
    api.videos.evidence(video.id).then(setEvidence, () => undefined)
  }, [video.id])

  // The announcer plan follows every edit (debounced): which lines he reads and when.
  useEffect(() => {
    if (!evidence) return
    const timer = setTimeout(
      () => api.videos.announcerPlan(video.id, script).then(setPlan, () => undefined),
      400
    )
    return () => clearTimeout(timer)
  }, [evidence, script, video.id])

  async function listen(scene: number, quote: string): Promise<void> {
    setPreview({ scene, src: null })
    try {
      const file = await api.videos.announcerPreview(video.id, quote)
      setPreview({ scene, src: mediaUrl(file, Date.now()) })
    } catch (e) {
      setPreview(null)
      setError(errorText(e))
    }
  }

  const words = [script.hook, ...script.scenes.map((s) => s.narration), script.outro]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length

  function setScene(
    i: number,
    key: keyof Script['scenes'][number],
    value: string | number | boolean | null
  ): void {
    setScript((s) => ({
      ...s,
      scenes: s.scenes.map((scene, j) => (j === i ? { ...scene, [key]: value } : scene))
    }))
  }

  function removeScene(i: number): void {
    setScript((s) => ({ ...s, scenes: s.scenes.filter((_, j) => j !== i) }))
  }

  function addScene(after: number): void {
    setScript((s) => {
      const scenes = [...s.scenes]
      scenes.splice(after + 1, 0, {
        narration: '',
        visual_keywords: '',
        image_prompt: '',
        year: s.scenes[after]?.year ?? null
      })
      return { ...s, scenes }
    })
  }

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const clean = { ...script, scenes: script.scenes.filter((s) => s.narration.trim()) }
      await api.videos.update(video.id, { title: title.trim() || null, script: clean })
      onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Banner kind="error">{error}</Banner>}
      <Field label="Título" hint={`${title.length}/70 caracteres`}>
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {script.title_options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {script.title_options.map((t) => (
            <button
              key={t}
              onClick={() => setTitle(t)}
              className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-300 hover:border-brand-600"
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {evidence && (
        <div className="space-y-2 rounded-md border border-ink-700 p-3">
          <div className="text-sm font-medium text-ink-300">
            Texto do anúncio (OCR) · {evidence.newspaper}, {evidence.date}
          </div>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-ink-400">
            {evidence.text || 'OCR sem texto confiável: confira as citações no scan.'}
          </p>
          <label className="flex items-center gap-2 text-xs">
            <span
              className="w-24 shrink-0 text-ink-500"
              title="Destacada no scan da abertura e lida pela narradora"
            >
              Abertura
            </span>
            <span
              className={
                quoteInText(String(script.hook_ad_quote ?? ''), evidence.text)
                  ? 'text-emerald-400'
                  : 'text-red-400'
              }
            >
              {script.hook_ad_quote
                ? quoteInText(String(script.hook_ad_quote), evidence.text)
                  ? '✓'
                  : '✗'
                : '·'}
            </span>
            <input
              className={inputClass}
              value={String(script.hook_ad_quote ?? '')}
              onChange={(e) => setScript((s) => ({ ...s, hook_ad_quote: e.target.value }))}
            />
          </label>
          <div className="pt-2 text-sm font-medium text-ink-300">
            Locutor de época: {plan?.segments.length ?? 0} trecho(s)
            {plan?.segments.length
              ? ` · entra em ${plan.segments.map((p) => clock(p.start)).join(', ')} (estimado)`
              : ''}
          </div>
          <div className="text-xs text-ink-500">
            Só nos Claim Checks, depois de 1 min, no máximo 3 e com 90 s entre eles. Só a promessa
            do anúncio, literal (✓ confere com o OCR), de 6 a 20 palavras. Sem trecho aprovado, a
            cena fica só com a narradora.
          </div>
          {announcerRows(script).map(({ scene, fallback }) => {
            const sc = script.scenes[scene - 1]
            const value = String(sc.ad_quote ?? '')
            const quote = value.trim() || fallback
            const seg = plan?.segments.find((p) => p.scene === scene)
            const drop = plan?.dropped.find((d) => d.scene === scene)
            return (
              <div key={scene} className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-ink-500">Cena {scene}</span>
                  <input
                    className={inputClass}
                    value={value}
                    placeholder={fallback}
                    onChange={(e) => setScene(scene - 1, 'ad_quote', e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!quote || (preview?.scene === scene && !preview.src)}
                    onClick={() => listen(scene, quote)}
                  >
                    {preview?.scene === scene && !preview.src ? 'Gerando…' : 'Ouvir'}
                  </Button>
                  <label className="flex shrink-0 items-center gap-1 text-ink-400">
                    <input
                      type="checkbox"
                      checked={!sc.ad_quote_off}
                      onChange={(e) => setScene(scene - 1, 'ad_quote_off', !e.target.checked)}
                    />
                    ligado
                  </label>
                </div>
                <div className={`pl-26 ${seg ? 'text-emerald-400' : 'text-ink-500'}`}>
                  {seg
                    ? `✓ entra em ${clock(seg.start)}, depois de “${seg.bridge}”`
                    : `Fora: ${drop?.reason ?? '—'}`}
                </div>
                {preview?.scene === scene && preview.src && (
                  <audio src={preview.src} controls autoPlay className="h-8" />
                )}
              </div>
            )
          })}
        </div>
      )}
      <Field label="Gancho (primeiros 15 segundos)">
        <textarea
          className={`${inputClass} h-20`}
          value={script.hook}
          onChange={(e) => setScript({ ...script, hook: e.target.value })}
        />
      </Field>

      <div className="text-sm text-ink-400">
        {script.scenes.length} cenas · {words} palavras · ~{(words / 150).toFixed(1)} min
      </div>

      {script.scenes.map((scene, i) => (
        <div key={i} className="rounded-md border border-ink-800 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-ink-500">
            <span>Cena {i + 1}</span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => addScene(i)}>
                + depois
              </Button>
              <Button size="sm" variant="ghost" onClick={() => removeScene(i)}>
                Remover
              </Button>
            </span>
          </div>
          <textarea
            className={`${inputClass} h-20`}
            value={scene.narration}
            onChange={(e) => setScene(i, 'narration', e.target.value)}
          />
          <div className="mt-2 grid grid-cols-[6rem_1fr_2fr] gap-2">
            <input
              className={inputClass}
              type="number"
              placeholder="ano"
              title="Ano da cena: quando muda, o vídeo mostra um cartão preto com o novo ano"
              value={scene.year ?? ''}
              onChange={(e) => setScene(i, 'year', e.target.value ? Number(e.target.value) : null)}
            />
            <input
              className={inputClass}
              placeholder="visual keywords"
              value={scene.visual_keywords}
              onChange={(e) => setScene(i, 'visual_keywords', e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="image prompt"
              value={scene.image_prompt}
              onChange={(e) => setScene(i, 'image_prompt', e.target.value)}
            />
          </div>
        </div>
      ))}

      <Field label="Encerramento">
        <textarea
          className={`${inputClass} h-20`}
          value={script.outro}
          onChange={(e) => setScript({ ...script, outro: e.target.value })}
        />
      </Field>

      <div className="flex gap-2">
        <Button variant="primary" onClick={save} disabled={saving}>
          Salvar roteiro
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
      </div>
    </div>
  )
}

/** "1:05" */
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Scenes that may carry an announcer line: each Claim Check scene, and any scene with one. */
function announcerRows(script: Script): { scene: number; fallback: string }[] {
  const claims = Array.isArray(script.claims)
    ? (script.claims as { scene?: number; quote?: string }[])
    : []
  const rows = new Map<number, string>()
  for (const c of claims) {
    const scene = Number(c.scene)
    if (script.scenes[scene - 1] && !rows.has(scene)) rows.set(scene, String(c.quote ?? ''))
  }
  script.scenes.forEach((sc, i) => {
    if (String(sc.ad_quote ?? '').trim() && !rows.has(i + 1)) rows.set(i + 1, '')
  })
  return [...rows].sort((a, b) => a[0] - b[0]).map(([scene, fallback]) => ({ scene, fallback }))
}
