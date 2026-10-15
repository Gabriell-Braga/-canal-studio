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
import { objectPosition } from '../shared/framing'
import type { Focus, RenderScene, RenderWord, VideoProps } from '../shared/render'
import { ChannelIntroCard, Teaser } from './ChannelIntro'
import { formatComponents } from './formats'
import { PaperScan } from './formats/vintage-ads'
import { template, type TemplateStyle } from './templates'

const FADE_SEC = 0.5
const MUSIC_CROSS_SEC = 1.5

export function KenBurns({
  src,
  motion,
  frames,
  focus
}: {
  src: string
  motion: number
  frames: number
  focus?: Focus
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const t = interpolate(frame, [0, frames], [0, 1], { extrapolateRight: 'clamp' })
  // Alternate zoom in/out and pan direction so consecutive images do not move the same way.
  const zoomIn = motion % 2 === 0
  const scale = zoomIn ? 1.04 + 0.12 * t : 1.16 - 0.12 * t
  // With a subject (face, product) the camera zooms on it; otherwise it pans across.
  const pan = focus ? 0 : 3 * (t - 0.5)
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
        // Crop around the subject's head instead of the center.
        objectPosition: objectPosition(focus, width, height),
        transform: `scale(${scale}) translate(${dx}%, ${dy}%)`,
        // objectPosition puts the subject near 50% / 40% of the frame: zoom toward it.
        transformOrigin: focus ? '50% 40%' : '50% 50%'
      }}
    />
  )
}

export function SceneLayer({
  scene,
  frames,
  fadeIn,
  grade,
  vignette = 0
}: {
  scene: RenderScene
  frames: number
  fadeIn: number
  grade: string
  vignette?: number
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = fadeIn
    ? interpolate(frame, [0, fadeIn], [0, 1], { extrapolateRight: 'clamp' })
    : 1
  const shots = [scene, ...(scene.shots ?? [])]
  // Each shot stays up its own seconds (equal parts for older props); the scene's sequence
  // starts `fadeIn` frames early, so later shots shift by that much.
  const equal = Math.max(1, Math.floor(frames / shots.length))
  const starts: number[] = []
  let secs = 0
  shots.forEach((shot, k) => {
    starts.push(shot.sec === undefined ? k * equal : k ? fadeIn + Math.round(secs * fps) : 0)
    secs += shot.sec ?? 0
  })
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: 'black' }}>
      {shots.map((shot, k) => {
        const last = k === shots.length - 1
        const len = Math.max(1, (last ? frames : starts[k + 1]) - starts[k])
        return (
          <Sequence key={k} from={starts[k]} durationInFrames={last ? len : len + SHOT_FADE}>
            <ShotLayer shot={shot} frames={len} fade={k > 0} grade={grade} vignette={vignette} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

const SHOT_FADE = 6

function ShotLayer({
  shot,
  frames,
  fade,
  grade,
  vignette
}: {
  shot: Pick<RenderScene, 'src' | 'type' | 'motion' | 'clipDuration' | 'focus' | 'scan'>
  frames: number
  fade: boolean
  grade: string
  vignette: number
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = fade
    ? interpolate(frame, [0, SHOT_FADE], [0, 1], { extrapolateRight: 'clamp' })
    : 1
  // A newspaper scan is drawn on paper, without the footage grade or the vignette.
  if (shot.scan)
    return (
      <AbsoluteFill style={{ opacity }}>
        <PaperScan shot={shot} frames={frames} />
      </AbsoluteFill>
    )
  return (
    <AbsoluteFill style={{ opacity, filter: grade }}>
      {shot.type === 'image' ? (
        <KenBurns src={shot.src} motion={shot.motion} frames={frames} focus={shot.focus} />
      ) : (
        // Clips shorter than the scene loop instead of freezing on the last frame.
        <Loop durationInFrames={Math.max(1, Math.floor((shot.clipDuration ?? 3600) * fps))}>
          <OffthreadVideo
            src={shot.src}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Loop>
      )}
      {vignette > 0 && <Vignette strength={vignette} />}
    </AbsoluteFill>
  )
}

interface Phrase {
  words: RenderWord[]
  start: number
  end: number
}

/** Group words into short on-screen phrases: max 5 words, break on punctuation or pauses. */
export function toPhrases(words: RenderWord[], hold = 0.6): Phrase[] {
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
    if (next && next.start - p.end < hold) p.end = next.start
  })
  return phrases
}

const CAPTION_HOLD_SEC = 1.5

function Captions({
  words,
  style,
  until,
  scale = 1
}: {
  words: RenderWord[]
  style: TemplateStyle
  /** Stop after this second (opening captions) */
  until?: number
  scale?: number
}): React.JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  // Opening captions hold through short pauses so they never blink on and off.
  const phrases = useMemo(
    () => toPhrases(words, until !== undefined ? CAPTION_HOLD_SEC : 0.6),
    [words, until]
  )
  const phrase = phrases.find((p) => t >= p.start && t < p.end)
  if (!phrase || (until !== undefined && phrase.start >= until)) return null
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
          fontSize: style.captionSize * scale,
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

export function Vignette({ strength }: { strength: number }): React.JSX.Element {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${strength}) 100%)`
      }}
    />
  )
}

const END_FADE_SEC = 2

/** Slow fade to black at the end of the narration; stays black for YouTube's end screen. */
function EndScreen({ at }: { at: number }): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = interpolate(frame, [at * fps - fps / 2, at * fps + END_FADE_SEC * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  return <AbsoluteFill style={{ backgroundColor: 'black', opacity }} />
}

/**
 * Music under the narration, then louder on its own over the end screen, fading out at the very
 * end. Without an end screen it just fades in and out.
 */
function musicCurve(
  f: number,
  fps: number,
  total: number,
  fade: number,
  endScreenAt?: number
): number {
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
  const edges = interpolate(f, [0, fade, total - fade * 2, total], [0, 1, 1, 0], clamp)
  if (endScreenAt === undefined) return edges
  const at = endScreenAt * fps
  return edges * interpolate(f, [at - fps, at + 2 * fps], [1, 2.2], clamp)
}

const DUCK_RAMP_SEC = 0.25

/** Music gain at second `t`: -6 dB (×0.5) while the period announcer speaks, short ramps. */
export function duckGain(t: number, duck?: { start: number; end: number }[]): number {
  let gain = 1
  for (const d of duck ?? []) {
    const g = interpolate(
      t,
      [d.start - DUCK_RAMP_SEC, d.start, d.end, d.end + DUCK_RAMP_SEC],
      [1, 0.5, 0.5, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
    )
    gain = Math.min(gain, g)
  }
  return gain
}

export const Video: React.FC<VideoProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig()
  const style = template(props.template)
  const fade = Math.round(FADE_SEC * fps)
  const musicFade = Math.round(2 * fps)
  const accent = typeof style.highlight.color === 'string' ? style.highlight.color : '#ffd166'
  const { Overlays } = formatComponents(props.format)

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {props.scenes.map((scene, i) => {
        const from = Math.max(0, Math.round(scene.start * fps) - (i ? fade : 0))
        // The last image stays under the fade to black instead of cutting out.
        const last = i === props.scenes.length - 1 && props.endScreenAt !== undefined
        const to = Math.round(
          (last ? (props.endScreenAt as number) + END_FADE_SEC : scene.end) * fps
        )
        const frames = Math.max(1, to - from + (i < props.scenes.length - 1 ? fade : 0))
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <SceneLayer
              scene={scene}
              frames={frames}
              fadeIn={i ? fade : 0}
              grade={style.grade}
              vignette={style.vignette}
            />
          </Sequence>
        )
      })}
      {props.captions ? (
        <Captions words={props.words} style={style} />
      ) : (
        !!props.openingCaptionsSec && (
          <Captions
            words={props.words}
            style={style}
            until={props.openingCaptionsSec}
            scale={1.35}
          />
        )
      )}
      {props.teaser && props.teaser.end > 1 && (
        <Sequence durationInFrames={Math.round(props.teaser.end * fps)}>
          <Teaser
            text={props.teaser.text}
            seconds={props.teaser.end}
            accent={accent}
            delay={props.companies?.length ? Math.min(1.2, props.introSec ?? 0) : 0.3}
          />
        </Sequence>
      )}
      {props.channelIntro && (
        <Sequence
          from={Math.round(props.channelIntro.start * fps)}
          durationInFrames={Math.round(props.channelIntro.duration * fps)}
        >
          <ChannelIntroCard intro={props.channelIntro} seconds={props.channelIntro.duration} />
        </Sequence>
      )}
      <Overlays video={props} accent={accent} />
      {props.endScreenAt !== undefined && <EndScreen at={props.endScreenAt} />}
      <Audio src={props.narration} />
      {props.music.map((track, i) => {
        // Neighbors cross-fade over 3 s around the change.
        const cross = Math.round(MUSIC_CROSS_SEC * fps)
        const last = i === props.music.length - 1
        const from = i ? Math.max(0, Math.round(track.from * fps) - cross) : 0
        const to = last ? durationInFrames : Math.round(track.to * fps) + cross
        const fadeIn = i ? [from, from + 2 * cross] : [-2, -1]
        const fadeOut = last ? [durationInFrames + 1, durationInFrames + 2] : [to - 2 * cross, to]
        // Repeats laid out by hand: with <Audio loop> the volume frame restarts on every
        // repeat, which would replay the fades each time the track comes around.
        const len = Math.max(fps, Math.floor(track.duration * fps))
        return Array.from({ length: Math.ceil((to - from) / len) }, (_, k) => {
          const start = from + k * len
          return (
            <Sequence
              key={`${i}-${k}`}
              from={start}
              durationInFrames={Math.min(len, to - start)}
              layout="none"
            >
              <Audio
                src={track.src}
                volume={(f) => {
                  const g = f + start
                  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
                  const local =
                    interpolate(g, fadeIn, [0, 1], clamp) * interpolate(g, fadeOut, [1, 0], clamp)
                  return Math.min(
                    1,
                    props.musicVolume *
                      local *
                      duckGain(g / fps, props.duck) *
                      musicCurve(g, fps, durationInFrames, musicFade, props.endScreenAt)
                  )
                }}
              />
            </Sequence>
          )
        })
      })}
    </AbsoluteFill>
  )
}
