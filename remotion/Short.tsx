import React, { useMemo } from 'react'
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Loop,
  OffthreadVideo,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig
} from 'remotion'
import type { RenderScene, ShortProps } from '../shared/render'
import { template } from './templates'
import { KenBurns, toPhrases } from './Video'

const FADE_SEC = 0.35
// Tall crop of the 16:9 media: fills most of the phone screen, Ken Burns keeps it moving.
const MEDIA_HEIGHT = 1040
const MEDIA_TOP = 400

/** One scene: blurred full-bleed copy behind, the sharp 16:9 media across the middle. */
function VerticalScene({
  scene,
  frames,
  fadeIn
}: {
  scene: RenderScene
  frames: number
  fadeIn: number
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = fadeIn
    ? interpolate(frame, [0, fadeIn], [0, 1], { extrapolateRight: 'clamp' })
    : 1
  const media =
    scene.type === 'image' ? (
      <KenBurns src={scene.src} motion={scene.motion} frames={frames} />
    ) : (
      <Loop durationInFrames={Math.max(1, Math.floor((scene.clipDuration ?? 3600) * fps))}>
        <OffthreadVideo
          src={scene.src}
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Loop>
    )
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: 'black' }}>
      <AbsoluteFill
        style={{ filter: 'blur(40px) brightness(0.45) saturate(1.2)', transform: 'scale(1.25)' }}
      >
        {scene.type === 'image' ? (
          <Img src={scene.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <OffthreadVideo
            src={scene.src}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: MEDIA_TOP,
          height: MEDIA_HEIGHT,
          overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)'
        }}
      >
        {media}
      </div>
    </AbsoluteFill>
  )
}

function ShortCaptions({
  words,
  props
}: {
  words: ShortProps['words']
  props: ShortProps
}): React.JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const style = template(props.template)
  const t = frame / fps
  // Shorter phrases than the long video: vertical screens are narrow.
  const phrases = useMemo(
    () =>
      toPhrases(words).flatMap((p) =>
        p.words.length > 3
          ? [
              { ...p, words: p.words.slice(0, 3), end: p.words[3].start },
              { ...p, words: p.words.slice(3), start: p.words[3].start }
            ]
          : [p]
      ),
    [words]
  )
  const phrase = phrases.find((p) => t >= p.start && t < p.end)
  if (!phrase) return null
  const pop = spring({
    frame: frame - Math.round(phrase.start * fps),
    fps,
    config: { damping: 14, stiffness: 220 }
  })
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-start',
        alignItems: 'center',
        paddingTop: MEDIA_TOP + MEDIA_HEIGHT - 150
      }}
    >
      <div
        style={{
          transform: `scale(${0.85 + 0.15 * pop})`,
          maxWidth: 940,
          textAlign: 'center',
          fontFamily: style.fontFamily,
          fontWeight: 900,
          fontSize: 76,
          lineHeight: 1.1,
          color: '#ffffff',
          textTransform: 'uppercase',
          textShadow:
            '0 0 3px #000, 4px 4px 0 #000, -4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 0 10px 30px rgba(0,0,0,0.8)'
        }}
      >
        {phrase.words.map((w, i) => {
          const active = t >= w.start && t < (phrase.words[i + 1]?.start ?? phrase.end)
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                margin: '0 0.16em',
                color: active ? style.thumbColors[1] : '#fff'
              }}
            >
              {w.word}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

function Headline({ text, props }: { text: string; props: ShortProps }): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const style = template(props.template)
  const enter = spring({ frame, fps, config: { damping: 16 } })
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 170 }}>
      <div
        style={{
          transform: `translateY(${(1 - enter) * -40}px)`,
          opacity: enter,
          maxWidth: 960,
          padding: '18px 34px',
          borderRadius: 22,
          background: 'rgba(0,0,0,0.55)',
          textAlign: 'center',
          fontFamily: style.thumbFont,
          fontWeight: 900,
          fontSize: 64,
          lineHeight: 1.08,
          color: style.thumbColors[1],
          textTransform: 'uppercase'
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  )
}

/** Last seconds: the full video's thumbnail, a clear call to action and an arrow down. */
function EndCard({ props }: { props: ShortProps }): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const style = template(props.template)
  const enter = spring({ frame, fps, config: { damping: 13, stiffness: 140 } })
  const bounce = Math.sin((frame / fps) * Math.PI * 2.2) * 14
  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(circle at 50% 40%, #2a2d3a 0%, #0e0f14 75%)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 70
      }}
    >
      <div
        style={{
          fontFamily: style.thumbFont,
          fontWeight: 900,
          fontSize: 84,
          lineHeight: 1,
          color: '#fff',
          textAlign: 'center',
          textTransform: 'uppercase',
          opacity: enter,
          transform: `translateY(${(1 - enter) * 40}px)`
        }}
      >
        Watch the
        <div style={{ color: style.thumbColors[1] }}>full video</div>
      </div>
      {props.cta.thumbnail && (
        <div
          style={{
            marginTop: 60,
            width: 940,
            borderRadius: 26,
            overflow: 'hidden',
            boxShadow: `0 0 0 6px ${style.thumbColors[1]}, 0 40px 90px rgba(0,0,0,0.7)`,
            transform: `scale(${0.8 + 0.2 * enter})`
          }}
        >
          <Img src={props.cta.thumbnail} style={{ width: '100%', display: 'block' }} />
        </div>
      )}
      <div
        style={{
          marginTop: 44,
          maxWidth: 920,
          fontFamily: style.fontFamily,
          fontWeight: 700,
          fontSize: 46,
          lineHeight: 1.2,
          color: '#e6e8ef',
          textAlign: 'center',
          opacity: enter
        }}
      >
        {props.cta.parentTitle}
      </div>
      <div
        style={{
          marginTop: 50,
          fontSize: 110,
          color: style.thumbColors[1],
          transform: `translateY(${bounce}px)`,
          opacity: enter
        }}
      >
        ↓
      </div>
      <div style={{ fontFamily: style.fontFamily, fontSize: 38, color: '#a3a9bb', opacity: enter }}>
        Link in the description
      </div>
    </AbsoluteFill>
  )
}

export const Short: React.FC<ShortProps> = (props) => {
  const { fps } = useVideoConfig()
  const fade = Math.round(FADE_SEC * fps)
  const segmentFrames = Math.round(props.segmentDuration * fps)
  const ctaFrames = Math.round((props.cta.duration + 0.4) * fps)

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <Sequence durationInFrames={segmentFrames}>
        {props.scenes.map((scene, i) => {
          const from = Math.max(0, Math.round(scene.start * fps) - (i ? fade : 0))
          const to = Math.min(segmentFrames, Math.round(scene.end * fps))
          const frames = Math.max(1, to - from + (i < props.scenes.length - 1 ? fade : 0))
          return (
            <Sequence key={i} from={from} durationInFrames={frames}>
              <VerticalScene scene={scene} frames={frames} fadeIn={i ? fade : 0} />
            </Sequence>
          )
        })}
        <Headline text={props.headline} props={props} />
        {props.captions && <ShortCaptions words={props.words} props={props} />}
        <Audio
          src={props.narration}
          startFrom={Math.round(props.segmentStart * fps)}
          endAt={Math.round((props.segmentStart + props.segmentDuration) * fps)}
        />
      </Sequence>
      <Sequence from={segmentFrames} durationInFrames={ctaFrames}>
        <EndCard props={props} />
        <Audio src={props.cta.audio} />
      </Sequence>
      {props.music && <Audio src={props.music} loop volume={props.musicVolume * 0.8} />}
    </AbsoluteFill>
  )
}
