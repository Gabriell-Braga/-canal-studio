import { useState } from 'react'
import { diagnose, CTR_LOW, RETENTION30_LOW, AVG_VIEW_LOW } from '../../shared/diagnosis'
import type { DiagnosisKind } from '../../shared/diagnosis'
import type { ChannelStats } from '../../shared/types'
import { Badge, inputClass } from './ui'
import { api, errorText } from '../lib/api'

type VideoStats = ChannelStats['videos'][number]
export interface Medians {
  ctr?: number | null
  retention30?: number | null
  avgViewPct?: number | null
}

const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#8a63d2']

const TONE: Record<DiagnosisKind, 'ok' | 'warn' | 'error' | 'neutral'> = {
  ok: 'ok',
  packaging: 'warn',
  hook: 'warn',
  topic: 'error',
  unknown: 'neutral'
}

const SOURCES: Record<string, string> = {
  YT_SEARCH: 'Busca do YouTube',
  RELATED_VIDEO: 'Sugeridos',
  SUGGESTED: 'Sugeridos',
  BROWSE: 'Início/navegação',
  SUBSCRIBER: 'Inscritos',
  NOTIFICATION: 'Notificações',
  YT_CHANNEL: 'Página do canal',
  PLAYLIST: 'Playlists',
  SHORTS: 'Feed de Shorts',
  END_SCREEN: 'Tela final',
  EXT_URL: 'Externo',
  NO_LINK_OTHER: 'Direto/outros',
  YT_OTHER_PAGE: 'Outras páginas',
  HASHTAGS: 'Hashtags'
}

/** Verdict for one video's numbers, shared by the table badge and the panel. */
function verdict(s: VideoStats | undefined, medians?: Medians): ReturnType<typeof diagnose> {
  return diagnose({
    ctr: s?.impressionsCtr ?? null,
    retention30: s?.retention30 ?? null,
    avgViewPct: s?.avgViewPercentage || null,
    channelMedians: medians
  })
}

export function VerdictBadge({
  s,
  medians
}: {
  s?: VideoStats
  medians?: Medians
}): React.JSX.Element {
  const d = verdict(s, medians)
  return <Badge tone={TONE[d.kind]}>{d.label}</Badge>
}

const W = 520
const H = 170
const PAD = { l: 40, r: 10, t: 10, b: 24 }

function clock(sec: number): string {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** audienceWatchRatio along the video, with a marker at 0:30. */
function RetentionCurve({
  curve,
  durationSec
}: {
  curve: [number, number, number][]
  durationSec: number | null
}): React.JSX.Element {
  const max = Math.max(1, ...curve.map(([, w]) => w))
  const x = (r: number): number => PAD.l + r * (W - PAD.l - PAD.r)
  const y = (w: number): number => PAD.t + (1 - w / max) * (H - PAD.t - PAD.b)
  const line = curve.map(([r, w], i) => `${i ? 'L' : 'M'}${x(r)},${y(w)}`).join(' ')
  const mark = durationSec && durationSec > 30 ? 30 / durationSec : null
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Curva de retenção">
      {[0, max / 2, max].map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-500 text-[12px]">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((r) => (
        <text key={r} x={x(r)} y={H - 6} textAnchor="middle" className="fill-ink-500 text-[12px]">
          {durationSec ? clock(r * durationSec) : `${r * 100}%`}
        </text>
      ))}
      {mark !== null && (
        <line
          x1={x(mark)}
          x2={x(mark)}
          y1={PAD.t}
          y2={H - PAD.b}
          stroke="rgba(255,255,255,0.3)"
          strokeDasharray="4 3"
        />
      )}
      <path
        d={`${line} L${x(curve.at(-1)?.[0] ?? 1)},${y(0)} L${x(curve[0]?.[0] ?? 0)},${y(0)} Z`}
        fill="var(--color-brand-300)"
        opacity={0.1}
      />
      <path
        d={line}
        fill="none"
        stroke="var(--color-brand-300)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Metric({
  label,
  value,
  low,
  hint
}: {
  label: string
  value: number | null
  low: number
  hint: string
}): React.JSX.Element {
  return (
    <div>
      <div className="text-xs text-ink-400">{label}</div>
      <div
        className={`mt-0.5 text-xl font-semibold ${
          value === null ? 'text-ink-500' : value < low ? 'text-red-300' : 'text-white'
        }`}
      >
        {value === null ? '—' : `${Math.round(value)}%`}
      </div>
      <div className="text-[11px] text-ink-500">{hint}</div>
    </div>
  )
}

function NumberInput({
  label,
  value,
  suffix,
  onSave
}: {
  label: string
  value: number | null
  suffix?: string
  onSave: (v: number | null) => Promise<void>
}): React.JSX.Element {
  const save = (raw: string): void => {
    const v = raw.trim() === '' ? null : Number(raw.replace(',', '.'))
    if (v !== value && (v === null || Number.isFinite(v))) void onSave(v)
  }
  return (
    <label className="block">
      <span className="text-xs text-ink-400">{label}</span>
      <div className="mt-0.5 flex items-center gap-1.5">
        <input
          key={value ?? 'empty'}
          defaultValue={value ?? ''}
          inputMode="decimal"
          placeholder="do Studio"
          className={`${inputClass} !w-24 !py-1`}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {suffix && <span className="text-xs text-ink-500">{suffix}</span>}
      </div>
    </label>
  )
}

/** Retention curve, traffic sources, CTR and the verdict of one published video. */
export function DiagnosisPanel({
  s,
  medians
}: {
  s: VideoStats
  medians?: Medians
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const d = verdict(s, medians)
  const totalTraffic = s.traffic.reduce((t, [, v]) => t + v, 0)
  const save = (m: { ctr?: number | null; impressions?: number | null }): Promise<void> =>
    api.youtube.setManualMetrics(s.video_id, m).then(
      () => setError(null),
      (e) => setError(errorText(e))
    )
  return (
    <div className="grid gap-5 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-ink-200">Diagnóstico</span>
          <Badge tone={TONE[d.kind]}>{d.label}</Badge>
        </div>
        <p className="mb-4 text-xs text-ink-400">{d.detail}</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumberInput
            label="CTR"
            value={s.impressionsCtr}
            suffix="%"
            onSave={(ctr) => save({ ctr })}
          />
          <NumberInput
            label="Impressões"
            value={s.impressions}
            onSave={(impressions) => save({ impressions })}
          />
          <Metric
            label="Em 0:30"
            value={s.retention30}
            low={RETENTION30_LOW}
            hint={`ainda assistindo (baixo < ${RETENTION30_LOW}%)`}
          />
          <Metric
            label="Média assistida"
            value={s.avgViewPercentage || null}
            low={AVG_VIEW_LOW}
            hint={`do vídeo (baixo < ${AVG_VIEW_LOW}%)`}
          />
        </div>
        <div className="mt-1 text-[11px] text-ink-500">
          CTR baixo &lt; {CTR_LOW}%. A API não entrega CTR: digite o do Studio ou importe o CSV.
        </div>
        {error && <div className="mt-2 text-xs text-red-300">{error}</div>}

        <div className="mt-5 mb-2 text-xs text-ink-400">Fontes de tráfego</div>
        {totalTraffic ? (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-ink-800">
              {s.traffic.map(([src, v], i) => (
                <div
                  key={src}
                  title={`${SOURCES[src] ?? src}: ${v}`}
                  style={{
                    width: `${(v / totalTraffic) * 100}%`,
                    background: SERIES[i % SERIES.length]
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-400">
              {s.traffic.map(([src, v], i) => (
                <span key={src} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: SERIES[i % SERIES.length] }}
                  />
                  {SOURCES[src] ?? src} {Math.round((v / totalTraffic) * 100)}%
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="text-xs text-ink-500">Sem dados ainda.</div>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs text-ink-400">
          Retenção ao longo do vídeo (tracejado: 0:30)
        </div>
        {s.retention.length ? (
          <RetentionCurve curve={s.retention} durationSec={s.durationSec} />
        ) : (
          <div className="py-10 text-center text-xs text-ink-500">
            Sem curva ainda: o Analytics leva alguns dias e precisa de views suficientes.
          </div>
        )}
      </div>
    </div>
  )
}
