import React, { useMemo } from 'react'
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Loop,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig
} from 'remotion'
import type { RenderScene, RenderWord, VideoProps } from '../shared/render'
import { template, type TemplateStyle } from './templates'

const FADE_SEC = 0.5

function KenBurns({
  src,
  motion,
  frames
}: {
  src: string
  motion: number
  frames: number
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [0, frames], [0, 1], { extrapolateRight: 'clamp' })
  // Alternate zoom in/out and pan direction so consecutive images do not move the same way.
  const zoomIn = motion % 2 === 0
  const scale = zoomIn ? 1.04 + 0.12 * t : 1.16 - 0.12 * t
  const pan = 3 * (t - 0.5)
  const [dx, dy] = [
    [pan, 0],
    [-pan, 0],
    [0, pan],
    [pan, -pan]
  ][motion % 4]
  return (
    <Img
      src={src}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: `scale(${scale}) translate(${dx}%, ${dy}%)`
      }}
    />
  )
}

function SceneLayer({
  scene,
  frames,
  fadeIn,
  grade
}: {
  scene: RenderScene
  frames: number
  fadeIn: number
  grade: string
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const opacity = fadeIn
    ? interpolate(frame, [0, fadeIn], [0, 1], { extrapolateRight: 'clamp' })
    : 1
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill style={{ opacity, filter: grade, backgroundColor: 'black' }}>
      {scene.type === 'image' ? (
        <KenBurns src={scene.src} motion={scene.motion} frames={frames} />
      ) : (
        // Clips shorter than the scene loop instead of freezing on the last frame.
        <Loop durationInFrames={Math.max(1, Math.floor((scene.clipDuration ?? 3600) * fps))}>
          <OffthreadVideo
            src={scene.src}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Loop>
      )}
    </AbsoluteFill>
  )
}

interface Phrase {
  words: RenderWord[]
  start: number
  end: number
}

/** Group words into short on-screen phrases: max 5 words, break on punctuation or pauses. */
export function toPhrases(words: RenderWord[]): Phrase[] {
  const phrases: Phrase[] = []
  let current: RenderWord[] = []
  const flush = (): void => {
    if (current.length)
      phrases.push({
        words: current,
        start: current[0].start,
        end: current[current.length - 1].end
      })
    current = []
  }
  words.forEach((w, i) => {
    const prev = words[i - 1]
    if (current.length && (current.length >= 5 || (prev && w.start - prev.end > 0.4))) flush()
    current.push(w)
    if (/[.!?;:]$/.test(w.word) || (/,$/.test(w.word) && current.length >= 3)) flush()
  })
  flush()
  // Hold each phrase until the next one starts when the gap is short.
  phrases.forEach((p, i) => {
    const next = phrases[i + 1]
    if (next && next.start - p.end < 0.6) p.end = next.start
  })
  return phrases
}

function Captions({
  words,
  style
}: {
  words: RenderWord[]
  style: TemplateStyle
}): React.JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const phrases = useMemo(() => toPhrases(words), [words])
  const phrase = phrases.find((p) => t >= p.start && t < p.end)
  if (!phrase) return null
  const textShadow = style.stroke
    ? `0 0 2px ${style.stroke}, 3px 3px 0 ${style.stroke}, -3px -3px 0 ${style.stroke}, 3px -3px 0 ${style.stroke}, -3px 3px 0 ${style.stroke}`
    : '0 3px 12px rgba(0,0,0,0.85)'
  return (
    <AbsoluteFill
      style={{
        justifyContent: style.captionBottom === null ? 'center' : 'flex-end',
        alignItems: 'center',
        paddingBottom: style.captionBottom ?? 0,
        paddingTop: style.captionBottom === null ? 380 : 0
      }}
    >
      <div
        style={{
          ...(style.box ?? {}),
          maxWidth: 1500,
          textAlign: 'center',
          fontFamily: style.fontFamily,
          fontSize: style.captionSize,
          fontWeight: 700,
          lineHeight: 1.25,
          color: style.textColor,
          textTransform: style.uppercase ? 'uppercase' : 'none',
          textShadow
        }}
      >
        {phrase.words.map((w, i) => {
          const active = t >= w.start && t < (phrase.words[i + 1]?.start ?? phrase.end)
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                margin: '0 0.18em',
                ...(active ? style.highlight : {})
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

function Vignette({ strength }: { strength: number }): React.JSX.Element {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${strength}) 100%)`
      }}
    />
  )
}

export const Video: React.FC<VideoProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig()
  const style = template(props.template)
  const fade = Math.round(FADE_SEC * fps)
  const musicFade = Math.round(2 * fps)

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {props.scenes.map((scene, i) => {
        const from = Math.max(0, Math.round(scene.start * fps) - (i ? fade : 0))
        const to = Math.round(scene.end * fps)
        const frames = Math.max(1, to - from + (i < props.scenes.length - 1 ? fade : 0))
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <SceneLayer scene={scene} frames={frames} fadeIn={i ? fade : 0} grade={style.grade} />
          </Sequence>
        )
      })}
      <Vignette strength={style.vignette} />
      {props.captions && <Captions words={props.words} style={style} />}
      <Audio src={props.narration} />
      {props.music && (
        <Audio
          src={props.music}
          loop
          volume={(f) =>
            props.musicVolume *
            interpolate(
              f,
              [0, musicFade, durationInFrames - musicFade * 2, durationInFrames],
              [0, 1, 1, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
            )
          }
        />
      )}
    </AbsoluteFill>
  )
}
