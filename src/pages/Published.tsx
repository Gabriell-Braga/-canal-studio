import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import {
  anchored,
  channelDaily,
  daysBetween,
  growthCurve,
  lastDay,
  liveDaily,
  mergeDaily,
  recentGain,
  viewsAtAge,
  weekOverWeek,
  type Daily
} from '../../shared/performance'
import type { VideoKind } from '../../shared/types'
import { Banner, Button, Card, PageHeader } from '../components/ui'
import { api, errorText, formatDate, mediaUrl, useLive } from '../lib/api'
import { useChannel } from '../lib/channel'

const BRAND = 'var(--color-brand-300)'
/** Categorical slots for the dark surface, in fixed order (dataviz reference palette). */
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181']
/** Ages compared across videos, in hours. */
const AGES = [
  { hours: 24, label: '24 h' },
  { hours: 72, label: '3 dias' },
  { hours: 168, label: '7 dias' }
]

type Filter = 'all' | VideoKind
/** Growth curves run up to this age, ending on the live count for younger videos. */
const CURVE_DAYS = 30

function fmt(n: number): string {
  return Math.round(n).toLocaleString('pt-BR')
}

function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit'
  })
}

function time(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** +12% green / −8% red, with an arrow so the sign never depends on color alone. */
function Change({ value }: { value: number | null }): React.JSX.Element | null {
  if (value === null || !isFinite(value)) return null
  const pct = Math.round(value * 100)
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus
  const color = pct > 0 ? 'text-emerald-300' : pct < 0 ? 'text-red-300' : 'text-ink-400'
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${color}`}>
      <Icon size={12} />
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
      {note && <div className="mt-0.5 text-xs text-ink-500">{note}</div>}
    </Card>
  )
}

const W = 560
const H = 230
const PAD = { l: 52, r: 12, t: 12, b: 28 }

function Axes({
  max,
  x,
  y,
  xTicks
}: {
  max: number
  x: (v: number) => number
  y: (v: number) => number
  xTicks: { at: number; label: string }[]
}): React.JSX.Element {
  return (
    <>
      {[0, max / 2, max].map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
          <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="fill-ink-500 text-[13px]">
            {fmt(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text
          key={t.label}
          x={x(t.at)}
          y={H - 6}
          textAnchor="middle"
          className="fill-ink-500 text-[13px]"
        >
          {t.label}
        </text>
      ))}
    </>
  )
}

/** Channel views per day (Analytics, then live): area line with a crosshair and tooltip on hover. */
function DailyChart({
  data,
  liveAfter
}: {
  data: Daily
  /** Last Analytics day; later days are live estimates, drawn dashed */
  liveAfter: string | null
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(([, v]) => v))
  const step = (W - PAD.l - PAD.r) / Math.max(1, data.length - 1)
  const x = (i: number): number => PAD.l + i * step
  const y = (v: number): number => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const path = (from: number, to: number): string =>
    data
      .slice(from, to + 1)
      .map(([, v], i) => `${i ? 'L' : 'M'}${x(from + i)},${y(v)}`)
      .join(' ')
  const line = path(0, data.length - 1)
  // Index of the last Analytics day: the line is solid up to it, dashed after.
  const split = liveAfter === null ? 0 : data.filter(([d]) => d <= liveAfter).length - 1
  const every = Math.ceil(data.length / 6)
  const xTicks = data
    .map(([d], i) => ({ at: i, label: shortDate(d) }))
    .filter((_, i) => i % every === 0)
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
          setHover(Math.min(data.length - 1, Math.max(0, Math.round((px - PAD.l) / step))))
        }}
      >
        <Axes max={max} x={x} y={y} xTicks={xTicks} />
        <path
          d={`${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
          fill={BRAND}
          opacity={0.1}
        />
        {split > 0 && (
          <path
            d={path(0, split)}
            fill="none"
            stroke={BRAND}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )}
        {split < data.length - 1 && (
          <path
            d={path(Math.max(0, split), data.length - 1)}
            fill="none"
            stroke={BRAND}
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
        )}
        {h && hover !== null && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.t}
              y2={H - PAD.b}
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
          <div className="text-ink-400">
            {shortDate(h[0])}
            {liveAfter !== null && h[0] > liveAfter && ' · ao vivo'}
            {hover === data.length - 1 && liveAfter !== null && h[0] > liveAfter && ' (parcial)'}
          </div>
          <div className="font-semibold text-white">{fmt(h[1])} views</div>
        </div>
      )}
    </div>
  )
}

/** Cumulative views by age, one line per video: who starts faster at the same age. */
function GrowthChart({
  series
}: {
  series: { id: number; title: string; color: string; points: [number, number][] }[]
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const maxH = Math.max(24, ...series.flatMap((s) => s.points.map(([h]) => h)))
  const span = maxH <= 48 ? Math.ceil(maxH / 6) * 6 : Math.ceil(maxH / 24) * 24
  const max = Math.max(1, ...series.flatMap((s) => s.points.map(([, v]) => v)))
  const x = (h: number): number => PAD.l + (h / span) * (W - PAD.l - PAD.r)
  const y = (v: number): number => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const tickStep = span <= 24 ? 6 : span <= 48 ? 12 : span <= 240 ? 24 : 120
  const xTicks = Array.from({ length: Math.floor(span / tickStep) + 1 }, (_, i) => {
    const at = i * tickStep
    return { at, label: span <= 48 ? `${at}h` : `${at / 24}d` }
  })
  // Value of each line at the hovered age: last point not after it.
  const at = (points: [number, number][], h: number): number | null => {
    if (h > (points.at(-1)?.[0] ?? 0)) return null
    let v = 0
    for (const [ph, pv] of points) if (ph <= h) v = pv
    return v
  }
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - box.left) / box.width) * W
          const h = ((px - PAD.l) / (W - PAD.l - PAD.r)) * span
          setHover(Math.min(span, Math.max(0, Math.round(h))))
        }}
      >
        <Axes max={max} x={x} y={y} xTicks={xTicks} />
        {series.map((s) => (
          <path
            key={s.id}
            d={s.points.map(([h, v], i) => `${i ? 'L' : 'M'}${x(h)},${y(v)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="rgba(255,255,255,0.25)"
          />
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 min-w-44 -translate-x-1/2 rounded-md border border-white/10 bg-ink-850 px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${Math.min(80, Math.max(20, (x(hover) / W) * 100))}%` }}
        >
          <div className="mb-1 text-ink-400">
            {hover < 48 ? `${hover} h` : `${(hover / 24).toFixed(1)} dias`} após publicar
          </div>
          {series.map((s) => {
            const v = at(s.points, hover)
            return (
              <div key={s.id} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-ink-300">{s.title}</span>
                <span className="font-semibold text-white">{v === null ? '—' : fmt(v)}</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-400">
        {series.map((s) => (
          <span key={s.id} className="flex max-w-56 items-center gap-1.5">
            <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: s.color }} />
            <span className="truncate">{s.title}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

const PRIVACY: Record<string, { label: string; tone: string }> = {
  public: { label: 'Público', tone: 'bg-emerald-400/15 text-emerald-200' },
  private: { label: 'Privado', tone: 'bg-amber-400/15 text-amber-200' },
  unlisted: { label: 'Não listado', tone: 'bg-ink-800 text-ink-300' }
}

export default function Published({ onOpen }: { onOpen: (id: number) => void }): React.JSX.Element {
  const { channel } = useChannel()
  const { data: stats, reload } = useLive(
    () => api.youtube.stats(channel.id),
    ['channel', 'videos'],
    [channel.id]
  )
  const { data: videos = [] } = useLive(() => api.videos.list(channel.id), ['videos'], [channel.id])
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byId = new Map((stats?.videos ?? []).map((s) => [s.video_id, s]))
  const end = lastDay((stats?.videos ?? []).map((s) => s.daily))
  const rows = videos
    .filter((v) => v.status === 'PUBLISHED' && (filter === 'all' || v.kind === filter))
    .map((v) => {
      const s = byId.get(v.id)
      const daily = s?.daily ?? []
      const snaps = anchored(s?.snapshots ?? [], daily, end)
      const release = v.scheduled_at ?? v.created_at
      const live = s?.snapshots.at(-1)
      return {
        video: v,
        stats: s,
        snaps,
        release,
        views: live?.views ?? s?.views ?? 0,
        likes: live?.likes ?? null,
        comments: live?.comments ?? null,
        last24: recentGain(snaps, 24),
        ages: AGES.map((a) => viewsAtAge(snaps, daily, release, a.hours, end)),
        curve: growthCurve(snaps, daily, release, CURVE_DAYS * 24)
      }
    })
    .sort((a, b) => b.release.localeCompare(a.release))

  // The live refresh says private after the release time: YouTube did not publish it.
  const stuck = rows.filter(
    (r) => r.stats?.privacy === 'private' && (r.stats.snapshots.at(-1)?.at ?? '') > r.release
  )

  // Averages per kind and age: a short is only compared with shorts, a video with videos.
  const average = (kind: VideoKind, i: number): number | null => {
    const vals = rows
      .filter((r) => r.video.kind === kind)
      .map((r) => r.ages[i])
      .filter((v): v is number => v !== null)
    return vals.length >= 2 ? vals.reduce((t, v) => t + v, 0) / vals.length : null
  }

  const sum = (pick: (r: (typeof rows)[number]) => number | null): number =>
    rows.reduce((t, r) => t + (pick(r) ?? 0), 0)
  const watchedViews = sum((r) => (r.stats?.avgViewPercentage ? r.stats.views : 0))
  const retention = watchedViews
    ? sum((r) => (r.stats?.avgViewPercentage ?? 0) * (r.stats?.views ?? 0)) / watchedViews
    : null
  const firstRelease = rows.at(-1)?.release.slice(0, 10)
  // Analytics days, then live days (snapshot differences) for the days it has not delivered yet.
  const dailySeries = rows.map((r) =>
    mergeDaily(r.stats?.daily ?? [], liveDaily(r.snaps, r.release), end)
  )
  const today = lastDay(dailySeries)
  const days =
    today && firstRelease ? Math.min(90, Math.max(14, daysBetween(firstRelease, today))) : 0
  const channelWeek = today ? weekOverWeek(channelDaily(dailySeries, today, 14), today) : null
  const growth = rows.slice(0, SERIES.length).map((r, i) => ({
    id: r.video.id,
    title: r.video.title ?? r.video.topic,
    color: SERIES[i],
    points: r.curve
  }))

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

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Tudo' },
    { id: 'long', label: 'Vídeos' },
    { id: 'short', label: 'Shorts' }
  ]

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Publicados"
        subtitle={
          stats?.connected
            ? `Views ao vivo de ${time(stats.liveUpdatedAt)} (atualiza a cada hora) · Analytics de ${time(stats.updatedAt)}`
            : 'YouTube não conectado: conecte em Configurações do canal'
        }
        actions={
          <>
            <div className="flex rounded-lg bg-ink-900 p-0.5 ring-1 ring-inset ring-white/[0.06]">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  data-testid={`filter-${f.id}`}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === f.id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {stats?.connected && (
              <Button disabled={busy} onClick={refresh}>
                {busy ? 'Atualizando…' : 'Atualizar agora'}
              </Button>
            )}
          </>
        }
      />
      {error && <Banner kind="error">{error}</Banner>}
      {stuck.length > 0 && (
        <Banner kind="warn">
          {stuck.length} vídeo(s) já passaram do horário e continuam <b>privados</b> no YouTube:{' '}
          {stuck.map((r) => r.video.title ?? r.video.topic).join(', ')}. Publique no YouTube Studio.
        </Banner>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="Views" value={fmt(sum((r) => r.views))} note={`${rows.length} publicado(s)`} />
        <Tile
          label="Últimas 24 h"
          value={fmt(sum((r) => r.last24))}
          note="ao vivo, pela Data API"
        />
        <Tile
          label="Últimos 7 dias"
          value={fmt(channelWeek?.current ?? 0)}
          note={
            <>
              <Change value={channelWeek?.change ?? null} /> vs. 7 dias antes
            </>
          }
        />
        <Tile
          label="Retenção média"
          value={retention === null ? '—' : `${Math.round(retention)}%`}
          note="do vídeo assistido"
        />
        <Tile
          label="Likes · comentários"
          value={`${fmt(sum((r) => r.likes))} · ${fmt(sum((r) => r.comments))}`}
        />
        <Tile label="Inscritos ganhos" value={fmt(sum((r) => r.stats?.subscribersGained ?? 0))} />
      </div>

      {rows.length > 0 && (
        <div className="mb-6 grid gap-4 xl:grid-cols-2">
          <Card className="p-5">
            <div className="mb-1 text-sm font-medium text-ink-200">
              Crescimento desde a publicação
            </div>
            <div className="mb-3 text-xs text-ink-500">
              Views acumuladas pela idade do vídeo: compara quem largou melhor. Últimos{' '}
              {growth.length} publicados, até {CURVE_DAYS} dias; a ponta de cada linha é a contagem
              ao vivo.
            </div>
            <GrowthChart series={growth} />
          </Card>
          <Card className="p-5">
            <div className="mb-1 text-sm font-medium text-ink-200">Views por dia</div>
            <div className="mb-3 text-xs text-ink-500">
              Soma dos publicados no filtro. Os dias que o Analytics ainda não entregou vêm das
              leituras ao vivo (tracejado); hoje vai até a última leitura.
            </div>
            {today ? (
              <DailyChart data={channelDaily(dailySeries, today, days)} liveAfter={end} />
            ) : (
              <div className="py-10 text-center text-xs text-ink-500">Sem dados ainda.</div>
            )}
          </Card>
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-500">
            <tr className="border-b border-ink-800">
              <th className="px-4 py-2.5 font-medium">Vídeo</th>
              <th className="px-3 py-2.5 text-right font-medium">Views</th>
              <th className="px-3 py-2.5 text-right font-medium">Últimas 24 h</th>
              {AGES.map((a) => (
                <th key={a.hours} className="px-3 py-2.5 text-right font-medium">
                  Com {a.label}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right font-medium">Retenção</th>
              <th className="px-3 py-2.5 text-right font-medium">Likes</th>
              <th className="px-3 py-2.5 text-right font-medium">Coment.</th>
              <th className="px-4 py-2.5 text-right font-medium">Inscritos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = r.video
              const thumb = v.thumbnail_paths[v.chosen_thumbnail ?? 0]
              const privacy = r.stats?.privacy ? PRIVACY[r.stats.privacy] : null
              return (
                <tr
                  key={v.id}
                  data-testid="published-row"
                  onClick={() => onOpen(v.id)}
                  className="cursor-pointer border-b border-ink-800/60 transition-colors hover:bg-ink-850"
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      {thumb && (
                        <img
                          src={mediaUrl(thumb)}
                          alt=""
                          className={`shrink-0 rounded object-cover ${
                            v.kind === 'short' ? 'aspect-[9/16] h-14' : 'aspect-video w-24'
                          }`}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-ink-100">
                          {v.kind === 'short' && (
                            <span className="mr-1.5 inline-flex -translate-y-px rounded bg-brand-400/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-brand-200">
                              Short
                            </span>
                          )}
                          {v.title ?? v.topic}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                          <span>{formatDate(r.release)}</span>
                          {privacy && (
                            <span className={`rounded px-1.5 py-px text-[10px] ${privacy.tone}`}>
                              {privacy.label}
                            </span>
                          )}
                          {v.youtube_id && (
                            <a
                              href={`https://youtu.be/${v.youtube_id}`}
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
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-white">
                    {fmt(r.views)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.last24 === null ? '—' : fmt(r.last24)}
                  </td>
                  {r.ages.map((value, i) => {
                    const avg = average(v.kind, i)
                    return (
                      <td key={i} className="px-3 py-2 text-right tabular-nums">
                        {value === null ? (
                          <span className="text-ink-600">—</span>
                        ) : (
                          <>
                            {fmt(value)}
                            {avg ? (
                              <div title="vs. média do mesmo tipo">
                                <Change value={value / avg - 1} />
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.stats?.avgViewPercentage ? `${Math.round(r.stats.avgViewPercentage)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.likes === null ? '—' : fmt(r.likes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.comments === null ? '—' : fmt(r.comments)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmt(r.stats?.subscribersGained ?? 0)}
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={10} className="px-4 py-4 text-ink-500">
                  Nada publicado neste filtro. Os agendados aparecem aqui quando entram no ar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-ink-500">
        “Com 24 h / 3 dias / 7 dias”: views que o vídeo tinha nessa idade, com a diferença para a
        média dos outros do mesmo tipo. Assim vídeos lançados em datas diferentes se comparam na
        mesma base.
      </p>
    </div>
  )
}
