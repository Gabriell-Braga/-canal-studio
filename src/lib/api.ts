import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api } from '../../shared/types'

export const api: Api = window.api

/**
 * Load data and reload it whenever the main process reports a change on one of `topics`.
 * `deps` restarts the fetch (for example a different video id).
 */
export function useLive<T>(
  fetcher: () => Promise<T>,
  topics: string[],
  deps: unknown[] = [],
  pollMs?: number
): { data: T | undefined; reload: () => void } {
  const [data, setData] = useState<T>()
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })
  const topicKey = topics.join(',')

  const reload = useCallback(() => {
    fetcherRef.current().then(setData, (e) => console.error(e))
  }, [])

  useEffect(() => {
    let alive = true
    const load = (): void => {
      fetcherRef.current().then(
        (d) => alive && setData(d),
        (e) => console.error(e)
      )
    }
    load()
    const off = api.onChanged((topic) => {
      if (topicKey.split(',').includes(topic)) load()
    })
    const timer = pollMs ? setInterval(load, pollMs) : null
    return () => {
      alive = false
      off()
      if (timer) clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey, pollMs, ...deps])

  return { data, reload }
}

export function errorText(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** file path → URL served by the media:// protocol (main process). */
export function mediaUrl(path: string | null | undefined, bust?: string | number): string {
  if (!path) return ''
  return `media://local/${encodeURIComponent(path)}${bust ? `?v=${bust}` : ''}`
}
