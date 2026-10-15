import { useState } from 'react'
import type { Video } from '../../shared/types'
import { api, errorText } from '../lib/api'
import { Banner, Button, Field, Modal, inputClass } from './ui'

/**
 * Ads on Trial: the real ad for a video whose search found none. A Commons file or an
 * Internet Archive item (public domain, ≤ 1930, checked by the app) or a local image with
 * its source and date. Attaching writes the script from it.
 */
export default function AttachAdModal({
  video,
  onClose,
  onAttached
}: {
  video: Video
  onClose: () => void
  onAttached: () => void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<string | null>(null)
  const [source, setSource] = useState('')
  const [date, setDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function attach(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await api.videos.attachAd(video.id, file ? { file, source, date } : { url: url.trim() })
      onAttached()
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  async function pick(): Promise<void> {
    const chosen = await api.videos.chooseAdImage()
    if (chosen) {
      setFile(chosen)
      setUrl('')
    }
  }

  return (
    <Modal
      title="Anexar anúncio manualmente"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={attach}
            disabled={saving || (!file && !url.trim())}
            data-testid="attach-ad-confirm"
          >
            {saving ? 'Lendo o anúncio…' : 'Anexar e gerar roteiro'}
          </Button>
        </>
      }
    >
      {error && <Banner kind="error">{error}</Banner>}
      <p className="mb-4 text-sm text-ink-400">{video.topic}</p>
      <div className="space-y-5">
        <Field
          label="Link do Commons ou do Internet Archive"
          hint="Ex.: commons.wikimedia.org/wiki/File:… ou archive.org/details/…. Só domínio público até 1930."
        >
          <input
            className={inputClass}
            value={url}
            disabled={!!file}
            placeholder="https://commons.wikimedia.org/wiki/File:…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3 text-xs text-ink-500">
          <span className="h-px flex-1 bg-ink-800" />
          ou
          <span className="h-px flex-1 bg-ink-800" />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={pick}>Escolher imagem local</Button>
          {file && (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-300">{file}</span>
              <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                Remover
              </Button>
            </>
          )}
        </div>
        {file && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fonte" hint="Revista, jornal ou cartão comercial.">
              <input
                className={inputClass}
                value={source}
                placeholder="The Ladies' Home Journal"
                onChange={(e) => setSource(e.target.value)}
              />
            </Field>
            <Field label="Data" hint="AAAA ou AAAA-MM-DD.">
              <input
                className={inputClass}
                value={date}
                placeholder="1905-03-01"
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  )
}
