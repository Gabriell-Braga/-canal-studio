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
const LOGO = 260
/** The picture has empty margin around the mark, so the text tucks in under its edge. */
const GAP = -4

/** The channel picture cut into vertical strips that slide in flat from above and below. */
function AssemblingLogo({
  src,
  frame,
  fps
}: {
  src: string
  frame: number
  fps: number
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        width: LOGO,
        height: LOGO,
        flexShrink: 0,
        // Soft edge: the picture melts into the card, which has the same color.
        maskImage: 'radial-gradient(circle, black 52%, transparent 71%)',
        WebkitMaskImage: 'radial-gradient(circle, black 52%, transparent 71%)'
      }}
    >
      {Array.from({ length: SLICES }, (_, i) => {
        const p = spring({
          frame: frame - 2 - i * 2,
          fps,
          config: { damping: 18, stiffness: 150, mass: 0.7 }
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
              transform: `translateY(${(1 - p) * from * 120}%)`
            }}
          />
        )
      })}
    </div>
  )
}

/** A line of text that slides out from behind the logo, from the left. */
function SlideIn({
  frame,
  fps,
  start,
  children,
  style
}: {
  frame: number
  fps: number
  start: number
  children: React.ReactNode
  style: React.CSSProperties
}): React.JSX.Element {
  const p = spring({
    frame: frame - Math.round(start * fps),
    fps,
    config: { damping: 20, stiffness: 110 }
  })
  return (
    <div style={{ overflow: 'hidden', paddingRight: 20 }}>
      <div style={{ ...style, transform: `translateX(${(p - 1) * 105}%)`, whiteSpace: 'nowrap' }}>
        {children}
      </div>
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
  const nameSize = 100
  const tagSize = 42
  // The logo builds in the middle of the screen, then slides left to make room for the text.
  const textWidth = Math.max(
    intro.name.length * nameSize * 0.66,
    intro.tagline.length * tagSize * 0.5
  )
  const shift = intro.avatar ? (textWidth + GAP) / 2 : 0
  const move = interpolate(t, [0.45, 1.0], [1, 0], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic)
  })
  const sched = spring({ frame: frame - Math.round(1.8 * fps), fps, config: { damping: 14 } })
  return (
    // isolation keeps the logo's zIndex inside the card, or the logo stays on top of the
    // year card that fades in over the end of the intro.
    <AbsoluteFill
      style={{ opacity: fade, backgroundColor: bg, overflow: 'hidden', isolation: 'isolate' }}
    >
      <AbsoluteFill
        style={{
          background: 'radial-gradient(circle at 50% 120%, rgba(0,0,0,0.4) 0%, transparent 60%)'
        }}
      />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {intro.avatar && (
            <div
              style={{
                position: 'relative',
                zIndex: 1,
                transform: `translateX(${shift * move}px)`
              }}
            >
              <AssemblingLogo src={intro.avatar} frame={frame} fps={fps} />
            </div>
          )}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              marginLeft: intro.avatar ? GAP : 0
            }}
          >
            <SlideIn
              frame={frame}
              fps={fps}
              start={0.75}
              style={{
                fontFamily: font,
                fontWeight: 900,
                fontSize: nameSize,
                lineHeight: 1,
                letterSpacing: 3,
                color: intro.secondary,
                textTransform: 'uppercase'
              }}
            >
              {intro.name}
            </SlideIn>
            {intro.tagline && (
              <SlideIn
                frame={frame}
                fps={fps}
                start={1.0}
                style={{
                  fontFamily: '"Segoe UI", Arial, sans-serif',
                  fontSize: tagSize,
                  fontWeight: 600,
                  color: intro.secondary,
                  opacity: 0.92
                }}
              >
                {intro.tagline}
              </SlideIn>
            )}
          </div>
        </div>
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
