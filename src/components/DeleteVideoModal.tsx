import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Video } from '../../shared/types'
import { api, errorText } from '../lib/api'
import { Banner, Button, Modal } from './ui'

interface Props {
  video: Video
  onClose: () => void
  onDeleted: () => void
}

/** Confirmation before deleting a video (and its shorts). Files go to the Recycle Bin. */
export default function DeleteVideoModal({ video, onClose, onDeleted }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(): Promise<void> {
    setBusy(true)
    try {
      await api.videos.remove(video.id)
      onDeleted()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={video.kind === 'short' ? 'Excluir short?' : 'Excluir vídeo?'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={remove} disabled={busy} data-testid="confirm-delete">
            <Trash2 size={15} /> {busy ? 'Excluindo…' : 'Excluir'}
          </Button>
        </>
      }
    >
      {error && <Banner kind="error">{error}</Banner>}
      <p className="text-sm text-ink-200">
        <span className="font-medium text-white">{video.title ?? video.topic}</span>
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-400">
        <li>Tarefas na fila deste vídeo são canceladas.</li>
        {video.kind === 'long' && <li>Os shorts gerados a partir dele também são excluídos.</li>}
        <li>Áudio, imagens e vídeos renderizados vão para a Lixeira do Windows.</li>
        {video.youtube_id && (
          <li className="text-amber-200">
            Ele já foi enviado ao YouTube: isso não apaga de lá. Exclua também no YouTube Studio se
            quiser.
          </li>
        )}
      </ul>
    </Modal>
  )
}
