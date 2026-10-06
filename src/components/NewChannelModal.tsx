import { useState } from 'react'
import type { Channel, ChannelSummary } from '../../shared/types'
import { CHANNEL_COLORS } from '../lib/colors'
import { api, errorText } from '../lib/api'
import { Banner, Button, ChannelAvatar, Field, Modal, inputClass } from './ui'

interface Props {
  channels: ChannelSummary[]
  defaultCopyFrom?: number | null
  onClose: () => void
  onCreated: (channel: Channel) => void
}

export default function NewChannelModal({
  channels,
  defaultCopyFrom,
  onClose,
  onCreated
}: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [color, setColor] = useState(CHANNEL_COLORS[(channels.length + 1) % CHANNEL_COLORS.length])
  const [copyFrom, setCopyFrom] = useState<number | null>(
    defaultCopyFrom ?? channels[0]?.id ?? null
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function create(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      onCreated(await api.channels.create({ name, color, copyFromId: copyFrom }))
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Novo canal"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={create}
            disabled={saving || !name.trim()}
            data-testid="create-channel"
          >
            Criar canal
          </Button>
        </>
      }
    >
      {error && <Banner kind="error">{error}</Banner>}
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <ChannelAvatar name={name || '?'} color={color} size={52} />
          <div className="flex-1">
            <Field label="Nome do canal">
              <input
                autoFocus
                data-testid="channel-name"
                className={inputClass}
                placeholder="Ex.: Dark History"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()}
              />
            </Field>
          </div>
        </div>
        <div>
          <span className="mb-2 block text-[13px] font-medium text-ink-200">Cor</span>
          <div className="flex gap-2">
            {CHANNEL_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Cor ${c}`}
                className={`h-7 w-7 rounded-full transition-transform duration-150 hover:scale-110 ${
                  color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-900' : ''
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <Field
          label="Começar com as configurações de"
          hint="Prompts, voz, templates e horários. Depois você ajusta o que quiser; o canal de origem não muda."
        >
          <select
            className={inputClass}
            value={copyFrom ?? ''}
            onChange={(e) => setCopyFrom(e.target.value ? Number(e.target.value) : null)}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="">Padrão do app</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}
