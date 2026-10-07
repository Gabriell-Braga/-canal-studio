/**
 * Fixed graphics drawn in code (never generated): the black year card between eras, the
 * corner badges with each company's logo and value, the year at the top, and the opening
 * logo card.
 */
import React from 'react'
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig
} from 'remotion'
import { formatUsd, valueAt, type RenderCompany, type YearCard } from '../shared/render'

const UI_FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif'
/** The card stays a little after the voice comes back, then fades out over the new scene. */
const CARD_TAIL_SEC = 0.35
const CARD_FADE_SEC = 0.3
const BADGE_IN_SEC = 0.45
const COUNT_SEC = 1.6

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** White tile so any logo (black, colored, transparent) reads on dark footage. */
export function LogoTile({
  company,
  height,
  width
}: {
  company: RenderCompany
  height: number
  width: number
}): React.JSX.Element {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: height * 0.2,
        background: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: height * 0.14,
        boxSizing: 'border-box',
        flexShrink: 0
      }}
    >
      {company.logo ? (
        <Img
          src={company.logo}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      ) : (
        <span
          style={{
            fontFamily: UI_FONT,
            fontWeight: 800,
            fontSize: height * 0.32,
            color: '#111',
            textAlign: 'center',
            lineHeight: 1
          }}
        >
          {company.name}
        </span>
      )}
    </div>
  )
}

function YearCardView({ card, accent }: { card: YearCard; accent: string }): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const total = card.duration + CARD_TAIL_SEC
  const opacity = interpolate(
    t,
    [0, CARD_FADE_SEC, total - CARD_TAIL_SEC, total],
    [0, 1, 1, 0],
    clamp
  )
  // Count from the previous year to the new one, slowing down at the end.
  const p = interpolate(t, [0.15, card.duration * 0.65], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic)
  })
  const year = card.from ? Math.round(card.from + (card.year - card.from) * p) : card.year
  const settle = spring({
    frame: frame - Math.round(card.duration * 0.65 * fps),
    fps,
    config: { damping: 12 }
  })
  const line = interpolate(t, [0.1, card.duration * 0.8], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic)
  })
  const forward = !card.from || card.year >= card.from
  return (
    <AbsoluteFill
      style={{ backgroundColor: '#000', opacity, alignItems: 'center', justifyContent: 'center' }}
    >
      {card.from && (
        <div
          style={{
            fontFamily: UI_FONT,
            fontSize: 34,
            letterSpacing: 8,
            color: 'rgba(255,255,255,0.4)',
            marginBottom: 10
          }}
        >
          {forward ? `${card.from} →` : `← ${card.from}`}
        </div>
      )}
      <div
        style={{
          fontFamily: UI_FONT,
          fontWeight: 800,
          fontSize: 230,
          lineHeight: 1,
          letterSpacing: 6,
          color: '#fff',
          fontVariantNumeric: 'tabular-nums',
          transform: `scale(${1 + 0.04 * settle})`
        }}
      >
        {year}
      </div>
      <div
        style={{
          marginTop: 34,
          height: 3,
          width: 720 * line,
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`
        }}
      />
    </AbsoluteFill>
  )
}

/** Black year cards; each one covers the silence the audio step left before its scene. */
export function YearCards({
  cards,
  accent
}: {
  cards: YearCard[]
  accent: string
}): React.JSX.Element {
  const { fps } = useVideoConfig()
  return (
    <>
      {cards.map((card, i) => (
        <Sequence
          key={i}
          from={Math.max(0, Math.round((card.at - card.duration) * fps))}
          durationInFrames={Math.round((card.duration + CARD_TAIL_SEC) * fps)}
        >
          <YearCardView card={card} accent={accent} />
        </Sequence>
      ))}
    </>
  )
}

/** Which year is on screen at time t, and how far its badges are into their entrance. */
function badgeState(cards: YearCard[], t: number): { card: YearCard; since: number } | null {
  let current: YearCard | null = null
  for (const c of cards) if (t >= c.at - c.duration) current = c
  if (!current) return null
  const shownAt = current.at + CARD_TAIL_SEC * 0.5
  // Hidden while the black card is up; the card fades in over the old badges.
  if (t < shownAt)
    return t < current.at - current.duration + CARD_FADE_SEC ? prevState(cards, current, t) : null
  return { card: current, since: t - shownAt }
}

function prevState(
  cards: YearCard[],
  current: YearCard,
  t: number
): { card: YearCard; since: number } | null {
  const i = cards.indexOf(current)
  const prev = cards[i - 1]
  return prev ? { card: prev, since: t - (prev.at + CARD_TAIL_SEC * 0.5) } : null
}

function interpolateValue(from: number | null, to: number | null, p: number): number | null {
  if (to === null) return null
  const a = from ?? 0
  if (a > 0 && to > 0) return Math.exp(Math.log(a) + p * (Math.log(to) - Math.log(a)))
  return a + p * (to - a)
}

function CompanyBadge({
  company,
  card,
  since,
  side,
  accent
}: {
  company: RenderCompany
  card: YearCard
  since: number
  side: 'left' | 'right'
  accent: string
}): React.JSX.Element | null {
  const enter = interpolate(since, [0, BADGE_IN_SEC], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.back(1.6))
  })
  const to = valueAt(company.values, card.year)
  const from = card.from ? valueAt(company.values, card.from) : null
  const p = interpolate(since, [BADGE_IN_SEC * 0.6, BADGE_IN_SEC * 0.6 + COUNT_SEC], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic)
  })
  const value = interpolateValue(from, to, p)
  const counting = p > 0 && p < 1 && from !== null && to !== null && from !== to
  const up = to !== null && from !== null && to > from
  const trend = to !== null && from !== null && to !== from ? (up ? '▲' : '▼') : null
  const trendColor = up ? '#3ddc84' : '#ff5c5c'
  return (
    <div
      style={{
        position: 'absolute',
        top: 36,
        [side]: 44,
        display: 'flex',
        flexDirection: side === 'left' ? 'row' : 'row-reverse',
        alignItems: 'center',
        gap: 14,
        padding: 10,
        paddingLeft: side === 'left' ? 10 : 22,
        paddingRight: side === 'left' ? 22 : 10,
        borderRadius: 20,
        background: 'rgba(8,9,12,0.74)',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        opacity: Math.min(1, enter * 1.4),
        transform: `translateY(${(1 - enter) * -40}px)`
      }}
    >
      <LogoTile company={company} height={66} width={company.logo ? 120 : 150} />
      <div style={{ textAlign: side === 'left' ? 'left' : 'right', fontFamily: UI_FONT }}>
        <div
          style={{
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: 2,
            color: 'rgba(255,255,255,0.6)',
            textTransform: 'uppercase'
          }}
        >
          {company.name} · value
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            justifyContent: side === 'left' ? 'flex-start' : 'flex-end',
            fontSize: 42,
            fontWeight: 800,
            color: counting ? (up ? '#c9ffe0' : '#ffd4d4') : '#fff',
            fontVariantNumeric: 'tabular-nums',
            minWidth: 170
          }}
        >
          {value === null ? '—' : `$${formatUsd(value)}`}
          {trend && (
            <span style={{ fontSize: 24, color: trendColor, opacity: p < 1 ? 1 : 0.85 }}>
              {trend}
            </span>
          )}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: -1,
          left: 20,
          right: 20,
          height: 3,
          borderRadius: 2,
          background: accent,
          opacity: 0.8 * enter
        }}
      />
    </div>
  )
}

function YearBadge({ card, since }: { card: YearCard; since: number }): React.JSX.Element {
  const enter = interpolate(since, [0, BADGE_IN_SEC], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.back(1.6))
  })
  return (
    <div
      style={{
        position: 'absolute',
        top: 44,
        left: '50%',
        transform: `translate(-50%, ${(1 - enter) * -40}px)`,
        opacity: Math.min(1, enter * 1.4),
        padding: '8px 30px',
        borderRadius: 999,
        background: 'rgba(8,9,12,0.74)',
        border: '1px solid rgba(255,255,255,0.14)',
        fontFamily: UI_FONT,
        fontWeight: 800,
        fontSize: 44,
        letterSpacing: 4,
        color: '#fff',
        fontVariantNumeric: 'tabular-nums'
      }}
    >
      {card.year}
    </div>
  )
}

/** Company badges in the top corners and the current year in the middle, after each year card. */
export function TopBadges({
  companies,
  cards,
  accent,
  hideUntil
}: {
  companies: RenderCompany[]
  cards: YearCard[]
  accent: string
  hideUntil: number
}): React.JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  if (t < hideUntil) return null
  const state = badgeState(cards, t)
  if (!state) return null
  return (
    <AbsoluteFill>
      {companies.slice(0, 2).map((c, i) => (
        <CompanyBadge
          key={i}
          company={c}
          card={state.card}
          since={state.since}
          side={i === 0 ? 'left' : 'right'}
          accent={accent}
        />
      ))}
      <YearBadge card={state.card} since={state.since} />
    </AbsoluteFill>
  )
}

/** Opening card: the logo of each company the video is about, over the darkened first scene. */
export function LogoIntro({
  companies,
  seconds,
  vertical = false
}: {
  companies: RenderCompany[]
  seconds: number
  vertical?: boolean
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const out = interpolate(t, [seconds - 0.5, seconds], [1, 0], clamp)
  const dim = interpolate(t, [0, 0.25], [0.35, 0.62], clamp) * out
  const tileH = vertical ? 230 : 190
  const tileW = vertical ? 520 : 420
  return (
    <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${dim})` }}>
      <AbsoluteFill
        style={{
          flexDirection: vertical ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: vertical ? 70 : 110,
          opacity: out
        }}
      >
        {companies.slice(0, 2).map((c, i) => {
          const pop = spring({ frame: frame - i * 6, fps, config: { damping: 12, stiffness: 150 } })
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 26,
                transform: `scale(${0.6 + 0.4 * pop})`,
                opacity: pop
              }}
            >
              <div style={{ boxShadow: '0 30px 80px rgba(0,0,0,0.6)', borderRadius: tileH * 0.2 }}>
                <LogoTile company={c} height={tileH} width={tileW} />
              </div>
              <div
                style={{
                  fontFamily: UI_FONT,
                  fontWeight: 800,
                  fontSize: vertical ? 64 : 52,
                  letterSpacing: 3,
                  color: '#fff',
                  textTransform: 'uppercase',
                  textShadow: '0 4px 18px rgba(0,0,0,0.8)'
                }}
              >
                {c.name}
              </div>
            </div>
          )
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
