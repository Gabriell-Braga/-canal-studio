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
  const fade = interpolate(t, [0, 0.3, seconds - 0.4, seconds], [0, 1, 1, 0], clamp)
  const pop = spring({ frame: frame - 4, fps, config: { damping: 11, stiffness: 120 } })
  const ring = interpolate(t, [0.1, 1.1], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const wipe = interpolate(t, [0.45, 1.15], [0, 100], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic)
  })
  const tag = interpolate(t, [1.1, 1.6], [0, 1], clamp)
  const sweep = interpolate(t, [0.3, 2.2], [-30, 130], clamp)
  const drift = interpolate(t, [0, seconds], [1, 1.06])
  const font = `"${intro.font}", "Segoe UI Black", "Arial Black", sans-serif`
  return (
    <AbsoluteFill style={{ opacity: fade, backgroundColor: '#050608', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          transform: `scale(${drift})`,
          background: `radial-gradient(circle at 50% 45%, ${intro.primary}38 0%, transparent 55%), radial-gradient(circle at 80% 90%, ${intro.primary}18 0%, transparent 45%)`
        }}
      />
      {/* Fine lines that sweep across once, like light on glass. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(105deg, transparent ${sweep - 8}%, ${intro.primary}22 ${sweep}%, transparent ${sweep + 8}%)`
        }}
      />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 34 }}>
        {intro.avatar && (
          <div style={{ position: 'relative', width: 230, height: 230 }}>
            <svg
              width={270}
              height={270}
              viewBox="0 0 270 270"
              style={{ position: 'absolute', left: -20, top: -20 }}
            >
              <circle
                cx={135}
                cy={135}
                r={128}
                fill="none"
                stroke={intro.primary}
                strokeWidth={5}
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 128}
                strokeDashoffset={2 * Math.PI * 128 * (1 - ring)}
                transform="rotate(-90 135 135)"
                style={{ filter: `drop-shadow(0 0 12px ${intro.primary})` }}
              />
            </svg>
            <Img
              src={intro.avatar}
              style={{
                width: 230,
                height: 230,
                borderRadius: '50%',
                objectFit: 'cover',
                transform: `scale(${0.5 + 0.5 * pop})`,
                opacity: Math.min(1, pop * 1.5)
              }}
            />
          </div>
        )}
        <div
          style={{
            fontFamily: font,
            fontWeight: 900,
            fontSize: 112,
            lineHeight: 1,
            letterSpacing: 4,
            color: intro.secondary,
            textTransform: 'uppercase',
            clipPath: `inset(0 ${100 - wipe}% 0 0)`,
            textShadow: '0 8px 40px rgba(0,0,0,0.6)'
          }}
        >
          {intro.name}
        </div>
        <div
          style={{
            height: 4,
            width: 520 * ring,
            borderRadius: 2,
            background: intro.primary,
            boxShadow: `0 0 18px ${intro.primary}`
          }}
        />
        {intro.tagline && (
          <div
            style={{
              fontFamily: '"Segoe UI", Arial, sans-serif',
              fontSize: 44,
              fontWeight: 600,
              letterSpacing: 2,
              color: 'rgba(255,255,255,0.86)',
              opacity: tag,
              transform: `translateY(${(1 - tag) * 16}px)`
            }}
          >
            {intro.tagline}
          </div>
        )}
      </AbsoluteFill>
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
