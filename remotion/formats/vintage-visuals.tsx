import React, { useEffect, useState } from 'react'
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  Freeze,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from 'remotion'
import type { Box, Focus, VisualStillProps } from '../../shared/render'
import {
  MAP_SIZE,
  type CounterSpec,
  type EvidenceSpec,
  type LabelSpec,
  type LetterSpec,
  type MapSpec,
  type TimelineSpec,
  type TreeSpec,
  type VisualSpec
} from '../../shared/visuals'
import { B, F, loadFonts, Paper, RubberStamp } from './vintage-ads'

/**
 * Ads on Trial data animations and camera shots drawn by the render: period map, timeline,
 * family tree, label, letter, price counter, evidence board, 2.5D parallax and detail shots.
 * Every one is animated over `frames` (the shot's length) in the channel's ink-on-paper look.
 */

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const ease = Easing.bezier(0.45, 0, 0.25, 1)
const HAND_INK = '#1E2A4A'

/** 0→1 between two shares of the shot. */
function useProgress(frames: number, from = 0, to = 1): number {
  const frame = useCurrentFrame()
  return interpolate(frame, [from * frames, Math.max(from * frames + 1, to * frames)], [0, 1], {
    ...clamp,
    easing: ease
  })
}

/** Slow camera push over the whole shot. */
function Push({
  frames,
  from = 1,
  to = 1.06,
  children
}: {
  frames: number
  from?: number
  to?: number
  children: React.ReactNode
}): React.JSX.Element {
  const p = useProgress(frames)
  return (
    <AbsoluteFill style={{ transform: `scale(${from + (to - from) * p})` }}>
      {children}
    </AbsoluteFill>
  )
}

function Title({ text }: { text: string }): React.JSX.Element | null {
  if (!text) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: 54,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily: F.title,
        fontSize: 68,
        color: B.ink,
        letterSpacing: 1
      }}
    >
      {text}
    </div>
  )
}

// ---------------------------------------------------------------- map

interface UsMap {
  width: number
  height: number
  states: { id: string; name: string; d: string }[]
}

let mapCache: Promise<UsMap> | null = null

function useUsMap(): UsMap | null {
  const [map, setMap] = useState<UsMap | null>(null)
  const [handle] = useState(() => delayRender('US map'))
  useEffect(() => {
    mapCache ??= fetch(staticFile('maps/us-states.json')).then((r) => r.json() as Promise<UsMap>)
    mapCache
      .then(setMap)
      .catch(() => undefined)
      .finally(() => continueRender(handle))
  }, [handle])
  return map
}

function MapVisual({ spec, frames }: { spec: MapSpec; frames: number }): React.JSX.Element {
  const map = useUsMap()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const scale = Math.min((1920 - 240) / MAP_SIZE.width, (1080 - 260) / MAP_SIZE.height)
  const w = MAP_SIZE.width * scale
  const h = MAP_SIZE.height * scale
  const left = (1920 - w) / 2
  const top = 170 + (1080 - 170 - 40 - h) / 2
  const n = Math.max(1, spec.points.length)
  return (
    <Paper>
      <Push frames={frames} to={1.07}>
        <svg
          viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`}
          style={{ position: 'absolute', left, top, width: w, height: h }}
        >
          {map?.states.map((s) => (
            <path
              key={s.id}
              d={s.d}
              fill="#E2D5B6"
              stroke={B.ink}
              strokeWidth={0.9}
              strokeLinejoin="round"
            />
          ))}
          {spec.points.map((p, i) => {
            const at = (0.12 + (0.7 * i) / n) * frames
            const pop = spring({ frame: frame - at, fps, config: { damping: 12, mass: 0.6 } })
            const ring = interpolate(frame - at, [0, fps * 1.2], [0, 1], clamp)
            if (frame < at) return null
            const right = p.x < MAP_SIZE.width * 0.72
            // A point close to an earlier one puts its label below, so names never overlap.
            const crowded = spec.points
              .slice(0, i)
              .some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 40)
            return (
              <g key={i} transform={`translate(${p.x} ${p.y})`}>
                <circle
                  r={4 + 16 * ring}
                  fill="none"
                  stroke={B.stamp}
                  strokeWidth={1.4}
                  opacity={1 - ring}
                />
                <circle r={5 * pop} fill={B.stamp} stroke={B.paper} strokeWidth={1} />
                <g opacity={pop} transform={`translate(${right ? 9 : -9} ${crowded ? 22 : -8})`}>
                  <text
                    textAnchor={right ? 'start' : 'end'}
                    fontFamily={F.type}
                    fontSize={22}
                    fill={B.ink}
                    stroke={B.paper}
                    strokeWidth={5}
                    paintOrder="stroke"
                  >
                    {p.label}
                  </text>
                  {p.year !== undefined && (
                    <text
                      y={20}
                      textAnchor={right ? 'start' : 'end'}
                      fontFamily={F.type}
                      fontSize={17}
                      fill={B.stamp}
                      stroke={B.paper}
                      strokeWidth={4}
                      paintOrder="stroke"
                    >
                      {p.year}
                    </text>
                  )}
                </g>
              </g>
            )
          })}
        </svg>
      </Push>
      <Title text={spec.title} />
    </Paper>
  )
}

// ---------------------------------------------------------------- timeline

/** A real picture with a white border and a push pin. */
function Pinned({
  src,
  height,
  rotate,
  style
}: {
  src: string
  height: number
  rotate: number
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        transform: `translate(-50%, -100%) rotate(${rotate}deg)`,
        background: '#FBF8F0',
        padding: height * 0.05,
        boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
        ...style
      }}
    >
      <Img src={src} style={{ display: 'block', height, filter: 'contrast(1.08)' }} />
      <Pin style={{ left: '50%', top: -8 }} />
    </div>
  )
}

function Pin({ style }: { style: React.CSSProperties }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        width: 26,
        height: 26,
        marginLeft: -13,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 30%, #F07A6E, #B3241A 55%, #6E120C)',
        boxShadow: '2px 5px 6px rgba(0,0,0,0.5)',
        ...style
      }}
    />
  )
}

const TL_GAP = 420

function TimelineVisual({
  spec,
  frames
}: {
  spec: TimelineSpec
  frames: number
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const events = [...spec.events].sort((a, b) => a.year - b.year)
  const n = events.length
  const width = (n - 1) * TL_GAP
  const lineY = 760
  // Camera: from the first event to the last; short timelines stay centered.
  const p = useProgress(frames, 0.05, 0.92)
  const travel = Math.max(0, width - 1920 + 520)
  const x0 = width <= 1920 - 520 ? (1920 - width) / 2 : 260 - travel * p
  const grow = interpolate(frame, [0, frames * 0.85], [0, width + 200], clamp)
  return (
    <Paper>
      <div style={{ position: 'absolute', left: x0, top: 0, width: width + 200, height: 1080 }}>
        <div
          style={{
            position: 'absolute',
            left: -100,
            top: lineY - 3,
            width: grow,
            height: 6,
            background: B.ink
          }}
        />
        {events.map((e, i) => {
          const x = i * TL_GAP
          const at = ((i + 0.3) / (n + 0.3)) * frames * 0.85
          const o = interpolate(frame, [at, at + 12], [0, 1], clamp)
          const red = e.year === spec.current
          return (
            <div key={i} style={{ opacity: o }}>
              <div
                style={{
                  position: 'absolute',
                  left: x - 14,
                  top: lineY - 14,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: red ? B.stamp : B.ink,
                  border: `5px solid ${B.paper}`
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: x - 200,
                  width: 400,
                  top: lineY + 34,
                  textAlign: 'center',
                  fontFamily: F.title,
                  fontSize: 76,
                  color: red ? B.stamp : B.ink
                }}
              >
                {e.year}
              </div>
              <div
                style={{
                  position: 'absolute',
                  left: x - 185,
                  width: 370,
                  top: lineY + 136,
                  textAlign: 'center',
                  fontFamily: F.type,
                  fontSize: 30,
                  lineHeight: 1.25,
                  color: B.ink
                }}
              >
                {e.label}
              </div>
              {e.src && (
                <Pinned
                  src={e.src}
                  height={300}
                  rotate={i % 2 ? 3 : -3}
                  style={{ left: x, top: lineY - 70 }}
                />
              )}
            </div>
          )
        })}
      </div>
    </Paper>
  )
}

// ---------------------------------------------------------------- family tree

function TreeVisual({ spec, frames }: { spec: TreeSpec; frames: number }): React.JSX.Element {
  const frame = useCurrentFrame()
  const ids = new Set(spec.people.map((p) => p.id))
  const depth = (id: string, seen = new Set<string>()): number => {
    const p = spec.people.find((x) => x.id === id)
    if (!p?.parent || !ids.has(p.parent) || seen.has(id)) return 0
    seen.add(id)
    return 1 + depth(p.parent, seen)
  }
  const levels: TreeSpec['people'][] = []
  for (const p of spec.people) (levels[depth(p.id)] ??= []).push(p)
  const boxW = 360
  const boxH = 170
  const rowH = Math.min(330, (1080 - 140) / Math.max(1, levels.length))
  const pos = new Map<string, { x: number; y: number }>()
  levels.forEach((row, d) => {
    const gap = Math.min(440, (1920 - 120) / row.length)
    row.forEach((p, i) =>
      pos.set(p.id, { x: 960 + (i - (row.length - 1) / 2) * gap, y: 120 + d * rowH + boxH / 2 })
    )
  })
  const order = levels.flat()
  const at = (id: string): number =>
    ((order.findIndex((p) => p.id === id) + 0.2) / (order.length + 0.5)) * frames * 0.8
  return (
    <Paper>
      <Push frames={frames} to={1.04}>
        <svg width={1920} height={1080} style={{ position: 'absolute' }}>
          {spec.people
            .filter((p) => p.parent && pos.has(p.parent))
            .map((p) => {
              const a = pos.get(p.parent as string) as { x: number; y: number }
              const b = pos.get(p.id) as { x: number; y: number }
              const mid = (a.y + boxH / 2 + b.y - boxH / 2) / 2
              const d = `M${a.x},${a.y + boxH / 2} V${mid} H${b.x} V${b.y - boxH / 2}`
              const len = Math.abs(mid - a.y) + Math.abs(b.x - a.x) + Math.abs(b.y - mid)
              const grow = interpolate(frame, [at(p.id) - 14, at(p.id)], [0, 1], clamp)
              return (
                <path
                  key={p.id}
                  d={d}
                  fill="none"
                  stroke={B.ink}
                  strokeWidth={4}
                  strokeDasharray={len}
                  strokeDashoffset={len * (1 - grow)}
                />
              )
            })}
        </svg>
        {spec.people.map((p) => {
          const c = pos.get(p.id) as { x: number; y: number }
          const o = interpolate(frame, [at(p.id), at(p.id) + 12], [0, 1], clamp)
          const red = p.id === spec.highlight
          const years =
            p.born || p.died ? `${p.born ?? '?'}–${p.died ?? ''}${p.died ? ' †' : ''}` : ''
          return (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                left: c.x - boxW / 2,
                top: c.y - boxH / 2,
                width: boxW,
                height: boxH,
                opacity: o,
                transform: `translateY(${(1 - o) * 14}px)`,
                background: '#F6EEDB',
                border: `4px solid ${red ? B.stamp : B.ink}`,
                outline: `1.5px solid ${red ? B.stamp : B.ink}`,
                outlineOffset: -11,
                boxShadow: '0 8px 18px rgba(0,0,0,0.25)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                color: red ? B.stamp : B.ink
              }}
            >
              <div style={{ fontFamily: F.card, fontWeight: 700, fontSize: 36, lineHeight: 1.05 }}>
                {p.name}
              </div>
              {years && (
                <div style={{ fontFamily: F.type, fontSize: 28, marginTop: 6 }}>{years}</div>
              )}
              {p.role && (
                <div style={{ fontFamily: F.type, fontSize: 22, marginTop: 4, opacity: 0.8 }}>
                  {p.role}
                </div>
              )}
            </div>
          )
        })}
      </Push>
    </Paper>
  )
}

// ---------------------------------------------------------------- label

function LabelVisual({ spec, frames }: { spec: LabelSpec; frames: number }): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const n = Math.max(1, spec.ingredients.length)
  const stampAt = frames * 0.74
  return (
    <AbsoluteFill style={{ backgroundColor: '#2A231B' }}>
      <Push frames={frames} to={1.05}>
        <div
          style={{
            position: 'absolute',
            left: 960 - 470,
            top: 70,
            width: 940,
            height: 940,
            boxShadow: '0 24px 60px rgba(0,0,0,0.6)'
          }}
        >
          <Paper>
            <div
              style={{
                position: 'absolute',
                inset: 26,
                border: `7px double ${B.ink}`,
                padding: '40px 70px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                color: B.ink
              }}
            >
              <div style={{ fontFamily: F.type, fontSize: 30, letterSpacing: 6 }}>✦ GENUINE ✦</div>
              <div
                style={{
                  fontFamily: F.title,
                  fontSize: spec.product.length > 26 ? 62 : 78,
                  lineHeight: 1.05,
                  margin: '14px 0 22px'
                }}
              >
                {spec.product}
              </div>
              <div style={{ width: '70%', borderTop: `3px solid ${B.ink}`, marginBottom: 26 }} />
              <div style={{ fontFamily: F.type, fontSize: 30, letterSpacing: 4, marginBottom: 18 }}>
                INGREDIENTS
              </div>
              {spec.ingredients.map((ing, i) => {
                const from = (0.1 + (0.56 * i) / n) * frames
                const to = from + (0.56 / n) * frames * 0.8
                const chars = Math.round(interpolate(frame, [from, to], [0, ing.length], clamp))
                return (
                  <div
                    key={i}
                    style={{
                      fontFamily: F.card,
                      fontSize: 44,
                      lineHeight: 1.3,
                      minHeight: 57,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {ing.slice(0, chars)}
                  </div>
                )
              })}
            </div>
          </Paper>
        </div>
        {spec.stamp && frame >= stampAt && (
          <RubberStamp
            text={spec.stamp}
            at={stampAt / fps}
            size={104}
            rotate={-8}
            style={{ left: 960, top: 850, translate: '-50% -50%' }}
          />
        )}
      </Push>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- letter

function LetterVisual({ spec, frames }: { spec: LetterSpec; frames: number }): React.JSX.Element {
  const frame = useCurrentFrame()
  const lines = [...spec.lines, spec.signature]
  const total = lines.reduce((t, l) => t + Math.max(6, l.length), 0)
  let acc = 0
  return (
    <AbsoluteFill style={{ backgroundColor: '#3A2E22' }}>
      <Push frames={frames} to={1.05}>
        <div
          style={{
            position: 'absolute',
            left: 960 - 560,
            top: 60,
            width: 1120,
            height: 960,
            transform: 'rotate(-1.5deg)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.6)'
          }}
        >
          <Paper>
            {spec.date && (
              <div
                style={{
                  position: 'absolute',
                  right: 90,
                  top: 70,
                  fontFamily: F.hand,
                  fontSize: 38,
                  color: HAND_INK
                }}
              >
                {spec.date}
              </div>
            )}
            <div style={{ position: 'absolute', left: 100, right: 100, top: 190 }}>
              {lines.map((l, i) => {
                const share = Math.max(6, l.length) / total
                const from = (0.06 + 0.82 * acc) * frames
                acc += share
                const to = (0.06 + 0.82 * acc) * frames
                const reveal = interpolate(frame, [from, to], [0, 100], clamp)
                const sign = i === lines.length - 1
                return (
                  <div
                    key={i}
                    style={{
                      fontFamily: F.hand,
                      fontSize: sign ? 56 : 46,
                      lineHeight: 1.9,
                      color: HAND_INK,
                      whiteSpace: 'nowrap',
                      textAlign: sign ? 'right' : 'left',
                      marginTop: sign ? 40 : 0,
                      clipPath: sign
                        ? `inset(0 0 0 ${100 - reveal}%)`
                        : `inset(0 ${100 - reveal}% 0 0)`
                    }}
                  >
                    {l}
                  </div>
                )
              })}
            </div>
          </Paper>
        </div>
      </Push>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- counter

/** "$37" at 60% of the way → "$22": the number tweened, prefix and suffix kept. */
export function tweenAmount(text: string, t: number): string {
  const m = /^([^\d]*)([\d,]*\.?\d+)(.*)$/.exec(text)
  if (!m) return text
  const value = Number(m[2].replace(/,/g, ''))
  const decimals = m[2].includes('.') ? m[2].split('.')[1].length : 0
  const now = (value * t).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: m[2].includes(',')
  })
  return `${m[1]}${now}${m[3]}`
}

function CounterVisual({ spec, frames }: { spec: CounterSpec; frames: number }): React.JSX.Element {
  const frame = useCurrentFrame()
  const t = useProgress(frames, 0.25, 0.6)
  const bars = spec.bars ?? []
  const max = Math.max(1, ...bars.map((b) => b.value))
  const top = bars.length ? 150 : 330
  const appear = interpolate(frame, [0, 14], [0, 1], clamp)
  const arrow = interpolate(frame, [frames * 0.12, frames * 0.25], [0, 1], clamp)
  return (
    <Paper>
      <Push frames={frames} to={1.04}>
        <div
          style={{
            position: 'absolute',
            top,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 70,
            color: B.ink
          }}
        >
          <div style={{ textAlign: 'center', opacity: appear }}>
            <div style={{ fontFamily: F.title, fontSize: 190, lineHeight: 1 }}>{spec.then}</div>
            <div style={{ fontFamily: F.type, fontSize: 40, marginTop: 10 }}>in {spec.year}</div>
          </div>
          <svg width={200} height={120} viewBox="0 0 200 120" style={{ opacity: arrow }}>
            <path
              d="M10 60 H150 M115 22 L182 60 L115 98"
              fill="none"
              stroke={B.stamp}
              strokeWidth={18}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div style={{ textAlign: 'center', opacity: arrow }}>
            <div style={{ fontFamily: F.title, fontSize: 190, lineHeight: 1, color: B.stamp }}>
              {tweenAmount(spec.today, t)}
            </div>
            <div style={{ fontFamily: F.type, fontSize: 40, marginTop: 10 }}>today</div>
          </div>
        </div>
        {bars.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 360,
              right: 360,
              bottom: 110,
              height: 380,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              gap: 40,
              borderBottom: `5px solid ${B.ink}`
            }}
          >
            {bars.map((b, i) => {
              const g = interpolate(
                frame,
                [frames * (0.55 + 0.05 * i), frames * (0.8 + 0.03 * i)],
                [0, 1],
                { ...clamp, easing: ease }
              )
              const h = (b.value / max) * 290 * g
              return (
                <div key={i} style={{ flex: 1, maxWidth: 170, textAlign: 'center' }}>
                  <div style={{ fontFamily: F.type, fontSize: 28, color: B.ink, opacity: g }}>
                    {b.value.toLocaleString('en-US')}
                    {spec.unit ? ` ${spec.unit}` : ''}
                  </div>
                  <div
                    style={{
                      height: h,
                      background: `repeating-linear-gradient(135deg, ${B.ink} 0 6px, #3A3128 6px 10px)`,
                      marginTop: 8
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -56,
                      width: 170,
                      fontFamily: F.type,
                      fontSize: 30,
                      color: B.ink
                    }}
                  >
                    {b.label}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Push>
    </Paper>
  )
}

// ---------------------------------------------------------------- evidence board

const BOARD = { width: 2600, height: 1460 }
const SPOTS = [
  { x: 520, y: 470, r: -4 },
  { x: 1310, y: 980, r: 3 },
  { x: 2080, y: 480, r: -2 },
  { x: 1300, y: 330, r: 2 },
  { x: 2150, y: 1060, r: -3 }
]

function EvidenceVisual({
  spec,
  frames
}: {
  spec: EvidenceSpec
  frames: number
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const items = spec.items.slice(0, SPOTS.length)
  const spots = SPOTS.slice(0, items.length)
  // Camera stops: the whole board, each clipping in order, the whole board again.
  const whole = { x: BOARD.width / 2, y: BOARD.height / 2, z: 1920 / BOARD.width }
  const stops = [
    whole,
    ...spots.map((s) => ({ x: s.x, y: s.y, z: 1.6 * (1920 / BOARD.width) * 1.25 })),
    whole
  ]
  const seg = frames / (stops.length - 1)
  const k = Math.min(stops.length - 2, Math.floor(frame / seg))
  const local = interpolate(frame - k * seg, [seg * 0.15, seg * 0.85], [0, 1], {
    ...clamp,
    easing: ease
  })
  const a = stops[k]
  const b = stops[k + 1]
  const cam = {
    x: a.x + (b.x - a.x) * local,
    y: a.y + (b.y - a.y) * local,
    z: a.z + (b.z - a.z) * local
  }
  const string = interpolate(frame, [seg * 0.5, frames * 0.85], [0, 1], clamp)
  const path = spots.map((s, i) => `${i ? 'L' : 'M'}${s.x},${s.y - 230}`).join(' ')
  const len = spots
    .slice(1)
    .reduce((t, s, i) => t + Math.hypot(s.x - spots[i].x, s.y - spots[i].y), 0)
  return (
    <AbsoluteFill style={{ backgroundColor: '#5A3E25', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          width: BOARD.width,
          height: BOARD.height,
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: `translate(${960 - cam.x * cam.z}px, ${540 - cam.y * cam.z}px) scale(${cam.z})`
        }}
      >
        <svg width={BOARD.width} height={BOARD.height} style={{ position: 'absolute' }}>
          <filter id="cork">
            <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={4} seed={9} />
            <feColorMatrix values="0 0 0 0 0.62  0 0 0 0 0.43  0 0 0 0 0.25  0 0 0 1.4 -0.2" />
          </filter>
          <rect width="100%" height="100%" fill="#A9784A" />
          <rect width="100%" height="100%" filter="url(#cork)" opacity={0.75} />
        </svg>
        {items.map((it, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: spots[i].x,
              top: spots[i].y + 220,
              transform: `translate(-50%, -100%) rotate(${spots[i].r}deg)`
            }}
          >
            <div
              style={{
                background: '#FBF8F0',
                padding: 18,
                boxShadow: '0 14px 30px rgba(0,0,0,0.55)'
              }}
            >
              <Img
                src={it.src}
                style={{ display: 'block', height: 420, maxWidth: 640, objectFit: 'cover' }}
              />
            </div>
            {it.caption && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: -64,
                  transform: 'translateX(-50%) rotate(-2deg)',
                  background: B.paper,
                  padding: '8px 22px',
                  fontFamily: F.type,
                  fontSize: 34,
                  color: B.ink,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 6px 12px rgba(0,0,0,0.35)'
                }}
              >
                {it.caption}
              </div>
            )}
          </div>
        ))}
        <svg width={BOARD.width} height={BOARD.height} style={{ position: 'absolute' }}>
          <path
            d={path}
            fill="none"
            stroke="#B3241A"
            strokeWidth={7}
            strokeDasharray={len}
            strokeDashoffset={len * (1 - string)}
            style={{ filter: 'drop-shadow(3px 6px 4px rgba(0,0,0,0.45))' }}
          />
        </svg>
        {spots.map((s, i) => (
          <Pin
            key={i}
            style={{ left: s.x, top: s.y - 243, width: 34, height: 34, marginLeft: -17 }}
          />
        ))}
      </div>
    </AbsoluteFill>
  )
}

/** A data animation or the evidence board, by its spec. */
export function DataVisual({
  spec,
  frames
}: {
  spec: VisualSpec
  frames: number
}): React.JSX.Element {
  loadFonts()
  switch (spec.kind) {
    case 'map':
      return <MapVisual spec={spec} frames={frames} />
    case 'timeline':
      return <TimelineVisual spec={spec} frames={frames} />
    case 'tree':
      return <TreeVisual spec={spec} frames={frames} />
    case 'label':
      return <LabelVisual spec={spec} frames={frames} />
    case 'letter':
      return <LetterVisual spec={spec} frames={frames} />
    case 'counter':
      return <CounterVisual spec={spec} frames={frames} />
    case 'evidence':
      return <EvidenceVisual spec={spec} frames={frames} />
  }
}

// ---------------------------------------------------------------- camera shots

/**
 * 2.5D parallax: the picture behind (soft, moving little) and the same picture masked by its
 * depth map in front (near parts opaque, moving more). Subtle: at most ~3% of travel.
 */
export function ParallaxShot({
  src,
  depth,
  frames,
  motion
}: {
  src: string
  depth: string
  frames: number
  motion: number
}): React.JSX.Element {
  const p = useProgress(frames)
  const dir = motion % 2 ? -1 : 1
  const cover: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  }
  const near = 1.05 + 0.07 * p
  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: 'black' }}>
      <Img
        src={src}
        style={{
          ...cover,
          transform: `scale(${1.08 + 0.03 * p}) translateX(${dir * (0.5 - p) * 1}%)`,
          filter: 'blur(1.5px) brightness(0.92)'
        }}
      />
      <AbsoluteFill
        style={{
          transform: `scale(${near}) translateX(${dir * (0.5 - p) * 3}%)`,
          WebkitMaskImage: `url(${depth})`,
          maskImage: `url(${depth})`,
          WebkitMaskSize: 'cover',
          maskSize: 'cover',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
          maskMode: 'luminance'
        }}
      >
        <Img src={src} style={cover} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/** A region of a high-resolution picture filling the frame, with a slow push in. */
export function DetailShot({
  src,
  crop,
  frames,
  motion,
  focus
}: {
  src: string
  crop: Box
  frames: number
  motion: number
  focus?: Focus
}): React.JSX.Element {
  const [aspect, setAspect] = useState<number | null>(focus?.aspect ?? null)
  const [handle] = useState(() => (focus?.aspect ? null : delayRender('detail aspect')))
  const p = useProgress(frames)
  const a = aspect ?? 1
  // Frame px per unit of image height, so the crop covers 1920×1080.
  const s = Math.max(1920 / (crop.w * a), 1080 / crop.h)
  const zoom = motion % 2 ? 1.1 - 0.08 * p : 1.02 + 0.08 * p
  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: 'black' }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <Img
          src={src}
          onLoad={(e) => {
            const img = e.currentTarget
            if (!aspect) setAspect(img.naturalWidth / img.naturalHeight)
            if (handle !== null) continueRender(handle)
          }}
          onError={() => handle !== null && continueRender(handle)}
          style={{
            position: 'absolute',
            width: a * s,
            height: s,
            maxWidth: 'none',
            left: 960 - (crop.x + crop.w / 2) * a * s,
            top: 540 - (crop.y + crop.h / 2) * s,
            filter: 'contrast(1.08)'
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/** A drawn shot frozen at `at` of its length: review contact sheets. */
export function VisualStill({
  shot,
  at = 0.85,
  frames = 240
}: VisualStillProps): React.JSX.Element {
  const f = Math.round(at * (frames - 1))
  const body =
    shot.shot === 'visual' ? (
      <DataVisual spec={shot.spec} frames={frames} />
    ) : shot.shot === 'parallax' ? (
      <ParallaxShot src={shot.src} depth={shot.depth} frames={frames} motion={0} />
    ) : (
      <DetailShot src={shot.src} crop={shot.crop} frames={frames} motion={0} />
    )
  return <Freeze frame={f}>{body}</Freeze>
}
