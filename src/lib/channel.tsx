import { createContext, useContext } from 'react'
import type { ChannelSummary } from '../../shared/types'

export interface ChannelContextValue {
  channel: ChannelSummary
  channels: ChannelSummary[]
  select: (id: number | null) => void
  reload: () => void
}

export const ChannelContext = createContext<ChannelContextValue | null>(null)

/** The channel the user is working on. Only used below the channel picker. */
export function useChannel(): ChannelContextValue {
  const ctx = useContext(ChannelContext)
  if (!ctx) throw new Error('useChannel outside ChannelContext')
  return ctx
}

const KEY = 'canal-studio.lastChannel'

export function rememberChannel(id: number): void {
  try {
    localStorage.setItem(KEY, String(id))
  } catch {
    // storage unavailable: the picker just will not highlight the last channel
  }
}

export function lastChannel(): number | null {
  try {
    return Number(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}
