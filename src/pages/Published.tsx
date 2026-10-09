import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import {
  channelDaily,
  firstWeek,
  lastDay,
  weekOverWeek,
  type Daily
} from '../../shared/performance'
import { Banner, Button, Card, PageHeader } from '../components/ui'
import { api, errorText, formatDate, mediaUrl, useLive } from '../lib/api'
import { useChannel } from '../lib/channel'

const BRAND = 'var(--color-brand-300)'

function fmt(n: number): string {
  return Math.round(n).toLocaleString('pt-BR')
}

function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit'
  })
}

function duration(sec: number): string {
  const m = Math.floor(sec / 60)
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`
}

/** +12% green / −8% red, with an arrow so the sign never depends on color alone. */
function Change({ value }: { value: number | null }): React.JSX.Element {
  if (value === null) return <span className="text-ink-500">—</span>
  const pct = Math.round(value * 100)
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus
  const color = pct > 0 ? 'text-emerald-300' : pct < 0 ? 'text-red-300' : 'text-ink-400'
  return (
    <span className={`inline-flex items-center gap-0.5 ${color}`}>
      <Icon size={13} />
      {pct > 0 ? '+' : ''}
      {pct}%
    </span>
  )
}

function Tile({
  label,
  value,
  note
}: {
  label: string
  value: string
  note?: React.ReactNode
}): React.JSX.Element {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-xs text-ink-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-400">{note}</div>}
    </Card>
  )
}

/** Channel views per day: area line with a crosshair and tooltip on hover. */
function DailyChart({ data }: { data: Daily }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const W = 560
  const H = 220
  const pad = { l: 48, r: 8, t: 10, b: 26 }
  const max = Math.max(1, ...data.map(([, v]) => v))
  const step = (W - pad.l - pad.r) / Math.max(1, data.length - 1)
  const x = (i: number): number => pad.l + i * step
  const y = (v: number): number => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const line = data.map(([, v], i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  const ticks = [0, max / 2, max]
  const labelEvery = Math.ceil(data.length / 6)
  const h = hover === null ? null : data[hover]
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - box.left) / box.width) * W
          setHover(Math.min(data.length - 1, Math.max(0, Math.round((px - pad.l) / step))))
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="fill-ink-500 text-[13px]">
              {fmt(t)}
            </text>
          </g>
        ))}
        {data.map(([d], i) =>
          i % labelEvery === 0 ? (
            <text
              key={d}
              x={x(i)}
              y={H - 4}
              textAnchor="middle"
              className="fill-ink-500 text-[13px]"
            >
              {shortDate(d)}
            </text>
          ) : null
        )}
        <path
          d={`${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
          fill={BRAND}
          opacity={0.1}
        />
        <path d={line} fill="none" stroke={BRAND} strokeWidth={2} strokeLinejoin="round" />
        {h && hover !== null && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.t}
              y2={H - pad.b}
              stroke="rgba(255,255,255,0.25)"
            />
            <circle
              cx={x(hover)}
              cy={y(h[1])}
              r={4.5}
              fill={BRAND}
              stroke="var(--color-ink-900)"
              strokeWidth={2}
            />
          </>
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-white/10 bg-ink-850 px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <div className="text-ink-400">{shortDate(h[0])}</div>
          <div className="font-semibold text-white">{fmt(h[1])} views</div>
        </div>
      )}
    </div>
  )
}

interface Row {
  id: number
  youtubeId: string
  title: string
  thumb: string | null
  release: string
  views: number
  avgViewDurationSec: number
  subscribersGained: number
  week: ReturnType<typeof weekOverWeek>
  first: ReturnType<typeof firstWeek>
}

/** First-week views per video against the channel average: who did better or worse. */
function FirstWeekChart({ rows, average }: { rows: Row[]; average: number }): React.JSX.Element {
  const max = Math.max(1, average, ...rows.map((r) => r.first.views))
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[minmax(0,14rem)_1fr_4.5rem] items-center gap-3">
          <div className="truncate text-xs text-ink-300" title={r.title}>
            {r.title}
          </div>
          <div className="relative h-5" title={`${fmt(r.first.views)} views nos 7 primeiros dias`}>
            <div
              className="h-full rounded-r-[4px]"
              style={{
                width: `${(r.first.views / max) * 100}%`,
                minWidth: 2,
                background: BRAND,
                opacity: r.first.complete ? 1 : 0.4
              }}
            />
            {average > 0 && (
              <div
                className="absolute bottom-[-3px] top-[-3px] w-px bg-ink-300"
                style={{ left: `${(average / max) * 100}%` }}
              />
            )}
          </div>
          <div className="text-right text-xs tabular-nums text-ink-200">
            {fmt(r.first.views)}
            {!r.first.complete && <span className="text-ink-500"> …</span>}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-4 pt-1 text-[11px] text-ink-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-px bg-ink-300" /> média do canal ({fmt(average)})
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-3 rounded-sm"
            style={{ background: BRAND, opacity: 0.4 }}
          />
          ainda nos 7 primeiros dias
        </span>
      </div>
    </div>
  )
}

export default function Published({ onOpen }: { onOpen: (id: number) => void }): React.JSX.Element {
  const { channel } = useChannel()
  const { data: stats, reload } = useLive(
    () => api.youtube.stats(channel.id),
    ['channel', 'videos'],
    [channel.id]
  )
  const { data: videos = [] } = useLive(() => api.videos.list(channel.id), ['videos'], [channel.id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byId = new Map((stats?.videos ?? []).map((s) => [s.video_id, s]))
  const published = videos.filter((v) => v.kind === 'long' && v.status === 'PUBLISHED')
  const end = lastDay((stats?.videos ?? []).map((s) => s.daily))
  const rows: Row[] = published
    .map((v) => {
      const s = byId.get(v.id)
      const daily = s?.daily ?? []
      const release = v.scheduled_at ?? v.created_at
      return {
        id: v.id,
        youtubeId: v.youtube_id ?? '',
        title: v.title ?? v.topic,
        thumb: v.thumbnail_paths[v.chosen_thumbnail ?? 0] ?? null,
        release,
        views: s?.views ?? 0,
        avgViewDurationSec: s?.avgViewDurationSec ?? 0,
        subscribersGained: s?.subscribersGained ?? 0,
        week: end ? weekOverWeek(daily, end) : { current: 0, previous: 0, change: null },
        first: end ? firstWeek(daily, release, end) : { views: 0, complete: false }
      }
    })
    .sort((a, b) => b.release.localeCompare(a.release))

  const complete = rows.filter((r) => r.first.complete)
  const average = complete.length
    ? complete.reduce((t, r) => t + r.first.views, 0) / complete.length
    : 0
  const allDaily = (stats?.videos ?? []).map((s) => s.daily)
  const channelWeek = end ? weekOverWeek(channelDaily(allDaily, end, 14), end) : null
  const totals = (stats?.videos ?? []).reduce(
    (t, v) => ({
      views: t.views + v.views,
      watch: t.watch + v.watchMinutes,
      subs: t.subs + v.subscribersGained
    }),
    { views: 0, watch: 0, subs: 0 }
  )

  async function refresh(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.youtube.stats(channel.id, true)
      reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Publicados"
        subtitle={
          stats?.connected
            ? `${published.length} vídeo(s) no ar · métricas de ${formatDate(stats.updatedAt)}`
            : 'YouTube não conectado: conecte na página YouTube para ver as métricas'
        }
        actions={
          stats?.connected && (
            <Button disabled={busy} onClick={refresh}>
              {busy ? 'Atualizando…' : 'Atualizar métricas'}
            </Button>
          )
        }
      />
      {error && <Banner kind="error">{error}</Banner>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Views nos últimos 7 dias"
          value={fmt(channelWeek?.current ?? 0)}
          note={
            <>
              <Change value={channelWeek?.change ?? null} /> vs. 7 dias antes
            </>
          }
        />
        <Tile label="Views no total" value={fmt(totals.views)} />
        <Tile label="Tempo de exibição" value={`${fmt(totals.watch / 60)} h`} />
        <Tile label="Inscritos ganhos" value={fmt(totals.subs)} />
      </div>

      {end && (
        <div className="mb-6 grid gap-4 xl:grid-cols-2">
          <Card className="p-5">
            <div className="mb-1 text-sm font-medium text-ink-200">Views por dia (60 dias)</div>
            <div className="mb-3 text-xs text-ink-500">
              Soma de todos os vídeos. O YouTube entrega os dados com 2–3 dias de atraso.
            </div>
            <DailyChart data={channelDaily(allDaily, end, 60)} />
          </Card>
          <Card className="p-5">
            <div className="mb-1 text-sm font-medium text-ink-200">
              Views nos 7 primeiros dias de cada vídeo
            </div>
            <div className="mb-3 text-xs text-ink-500">
              Compara vídeos lançados em datas diferentes na mesma base.
            </div>
            {rows.length ? (
              <FirstWeekChart rows={rows} average={average} />
            ) : (
              <div className="py-6 text-xs text-ink-500">Nenhum vídeo publicado ainda.</div>
            )}
          </Card>
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-500">
            <tr className="border-b border-ink-800">
              <th className="px-4 py-2.5 font-medium">Vídeo</th>
              <th className="px-4 py-2.5 text-right font-medium">Views</th>
              <th className="px-4 py-2.5 text-right font-medium">7 primeiros dias</th>
              <th className="px-4 py-2.5 text-right font-medium">Últimos 7 dias</th>
              <th className="px-4 py-2.5 text-right font-medium">Tendência</th>
              <th className="px-4 py-2.5 text-right font-medium">Duração média</th>
              <th className="px-4 py-2.5 text-right font-medium">Inscritos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                data-testid="published-row"
                onClick={() => onOpen(r.id)}
                className="cursor-pointer border-b border-ink-800/60 transition-colors hover:bg-ink-850"
              >
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    {r.thumb && (
                      <img
                        src={mediaUrl(r.thumb)}
                        alt=""
                        className="aspect-video w-24 shrink-0 rounded object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-ink-100">{r.title}</div>
                      <div className="mt-0.5 flex gap-2 text-xs text-ink-500">
                        <span>{formatDate(r.release)}</span>
                        {r.youtubeId && (
                          <a
                            href={`https://youtu.be/${r.youtubeId}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-brand-300 hover:underline"
                          >
                            abrir no YouTube
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(r.views)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmt(r.first.views)}
                  {r.first.complete && average > 0 && (
                    <div className="text-xs">
                      <Change value={r.first.views / average - 1} />{' '}
                      <span className="text-ink-500">vs. média</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(r.week.current)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  <Change value={r.week.change} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {duration(r.avgViewDurationSec)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(r.subscribersGained)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-ink-500">
                  Nenhum vídeo publicado ainda. Os agendados aparecem aqui quando entram no ar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
