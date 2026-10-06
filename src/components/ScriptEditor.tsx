import { useState } from 'react'
import type { Script, Video } from '../../shared/types'
import { api, errorText } from '../lib/api'
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

  const words = [script.hook, ...script.scenes.map((s) => s.narration), script.outro]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length

  function setScene(i: number, key: keyof Script['scenes'][number], value: string): void {
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
      scenes.splice(after + 1, 0, { narration: '', visual_keywords: '', image_prompt: '' })
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
          <div className="mt-2 grid grid-cols-3 gap-2">
            <input
              className={inputClass}
              placeholder="visual keywords"
              value={scene.visual_keywords}
              onChange={(e) => setScene(i, 'visual_keywords', e.target.value)}
            />
            <input
              className={`${inputClass} col-span-2`}
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
