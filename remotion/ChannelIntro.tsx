/**
 * The channel's intro card, drawn in code so every channel gets one from its own name,
 * picture, tagline and brand colors. Plays between the hook and the story, and alone as a
 * preview in the settings.
 */
import React from 'react'
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from 'remotion'
import type { ChannelIntroProps } from '../shared/render'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const SLICES = 7
const LOGO = 300

/** The channel picture cut into vertical strips that fly in from above and below and lock together. */
function AssemblingLogo({
  src,
  frame,
  fps
}: {
  src: string
  frame: number
  fps: number
}): React.JSX.Element {
  const settle = spring({ frame: frame - 24, fps, config: { damping: 14, stiffness: 90 } })
  return (
    <div
      style={{
        position: 'relative',
        width: LOGO,
        height: LOGO,
        transform: `scale(${1.08 - 0.08 * settle})`,
        // Soft edge: the picture melts into the card, which has the same color.
        maskImage: 'radial-gradient(circle, black 52%, transparent 71%)',
        WebkitMaskImage: 'radial-gradient(circle, black 52%, transparent 71%)'
      }}
    >
      {Array.from({ length: SLICES }, (_, i) => {
        const p = spring({
          frame: frame - 2 - i * 2,
          fps,
          config: { damping: 15, stiffness: 140, mass: 0.8 }
        })
        const from = i % 2 === 0 ? -1 : 1
        const left = (i / SLICES) * 100
        const right = 100 - ((i + 1) / SLICES) * 100
        return (
          <Img
            key={i}
            src={src}
            style={{
              position: 'absolute',
              inset: 0,
              width: LOGO,
              height: LOGO,
              objectFit: 'cover',
              // A hair of overlap so no seam shows once the strips meet.
              clipPath: `inset(0 ${Math.max(0, right - 0.3)}% 0 ${Math.max(0, left - 0.3)}%)`,
              transform: `translateY(${(1 - p) * from * 140}%) rotate(${(1 - p) * from * 8}deg)`,
              opacity: Math.min(1, p * 2)
            }}
          />
        )
      })}
    </div>
  )
}

/** Each letter drops into place, one after the other. */
function AssembledText({
  text,
  frame,
  fps,
  start,
  style
}: {
  text: string
  frame: number
  fps: number
  start: number
  style: React.CSSProperties
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', ...style }}>
      {[...text].map((ch, i) => {
        const p = spring({
          frame: frame - start - i * 1.2,
          fps,
          config: { damping: 13, stiffness: 160 }
        })
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              whiteSpace: 'pre',
              opacity: p,
              transform: `translateY(${(1 - p) * -60}px) scale(${0.6 + 0.4 * p})`
            }}
          >
            {ch}
          </span>
        )
      })}
    </div>
  )
}

function CalendarIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <rect x={3} y={5} width={18} height={16} rx={3} stroke={color} strokeWidth={2} />
      <path d="M3 10 H21 M8 3 V7 M16 3 V7" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

export function ChannelIntroCard({
  intro,
  seconds
}: {
  intro: ChannelIntroProps
  seconds: number
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const fade = interpolate(t, [0, 0.25, seconds - 0.4, seconds], [0, 1, 1, 0], clamp)
  // The whole card sits on the color of the channel picture, so the picture blends in.
  const bg = intro.background ?? intro.primary
  const font = `"${intro.font}", "Segoe UI Black", "Arial Black", sans-serif`
  const line = interpolate(t, [1.1, 1.7], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const tag = interpolate(t, [1.5, 2.0], [0, 1], clamp)
  const sched = spring({ frame: frame - Math.round(2.1 * fps), fps, config: { damping: 14 } })
  const drift = interpolate(t, [0, seconds], [1, 1.05])
  const shine = interpolate(t, [0.9, 2.2], [-40, 140], clamp)
  return (
    <AbsoluteFill style={{ opacity: fade, backgroundColor: bg, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          transform: `scale(${drift})`,
          background: 'radial-gradient(circle at 50% 120%, rgba(0,0,0,0.45) 0%, transparent 60%)'
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(105deg, transparent ${shine - 10}%, rgba(255,255,255,0.12) ${shine}%, transparent ${shine + 10}%)`
        }}
      />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        {intro.avatar && <AssemblingLogo src={intro.avatar} frame={frame} fps={fps} />}
        <AssembledText
          text={intro.name.toUpperCase()}
          frame={frame}
          fps={fps}
          start={Math.round(0.65 * fps)}
          style={{
            marginTop: 36,
            fontFamily: font,
            fontWeight: 900,
            fontSize: 104,
            lineHeight: 1,
            letterSpacing: 5,
            color: intro.secondary,
            textShadow: '0 8px 30px rgba(0,0,0,0.35)'
          }}
        />
        <div
          style={{
            marginTop: 26,
            height: 4,
            width: 460 * line,
            borderRadius: 2,
            background: intro.secondary,
            opacity: 0.85
          }}
        />
        {intro.tagline && (
          <div
            style={{
              marginTop: 22,
              fontFamily: '"Segoe UI", Arial, sans-serif',
              fontSize: 44,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: intro.secondary,
              opacity: tag * 0.92,
              transform: `translateY(${(1 - tag) * 18}px)`
            }}
          >
            {intro.tagline}
          </div>
        )}
      </AbsoluteFill>
      {intro.schedule && (
        <AbsoluteFill
          style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 70 }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 24px',
              borderRadius: 999,
              background: 'rgba(0,0,0,0.28)',
              border: '1px solid rgba(255,255,255,0.3)',
              fontFamily: '"Segoe UI", Arial, sans-serif',
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: intro.secondary,
              opacity: sched,
              transform: `translateY(${(1 - sched) * 30}px)`
            }}
          >
            <CalendarIcon color={intro.secondary} />
            {intro.schedule}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}

/** Composition used for the preview in the settings. */
export const ChannelIntro: React.FC<ChannelIntroProps> = (props) => (
  <ChannelIntroCard intro={props} seconds={props.duration ?? 4} />
)

/** The hook's punch line in big letters, low on the screen, while the hook plays. */
export function Teaser({
  text,
  seconds,
  accent,
  delay
}: {
  text: string
  seconds: number
  accent: string
  delay: number
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const enter = spring({ frame: frame - Math.round(delay * fps), fps, config: { damping: 14 } })
  const out = interpolate(t, [seconds - 0.4, seconds], [1, 0], clamp)
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 120 }}>
      <div
        style={{
          maxWidth: 1500,
          padding: '20px 44px',
          borderRadius: 18,
          background: 'rgba(5,6,8,0.78)',
          borderLeft: `8px solid ${accent}`,
          fontFamily: '"Segoe UI Black", "Arial Black", sans-serif',
          fontWeight: 900,
          fontSize: 66,
          lineHeight: 1.12,
          color: '#fff',
          textAlign: 'center',
          textTransform: 'uppercase',
          textWrap: 'balance',
          opacity: enter * out,
          transform: `translateY(${(1 - enter) * 50}px) scale(${0.94 + 0.06 * enter})`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  )
}
