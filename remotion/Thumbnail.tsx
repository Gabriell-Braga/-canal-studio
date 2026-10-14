import React from 'react'
import { AbsoluteFill, Img } from 'remotion'
import { THUMB } from '../shared/thumb'
import type { ThumbnailProps } from '../shared/render'

const H = 720
const C = THUMB.colors

/** Thick outline from stacked shadows, plus a soft drop shadow so the text lifts off the image. */
function outline(width: number): string {
  const ring = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2
    return `${(Math.cos(a) * width).toFixed(1)}px ${(Math.sin(a) * width).toFixed(1)}px 0 ${C.stroke}`
  })
  return [...ring, `0 ${width}px ${width * 2}px rgba(0,0,0,0.6)`].join(', ')
}

/** Split 2–4 words into at most two lines of similar length. */
export function headlineLines(text: string): string[] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  // A before → after figure reads as one idea: keep it on one line.
  if (words.length === 1 || words.includes('→') || words.join(' ').length <= 10)
    return [words.join(' ')]
  let best = 1
  for (let i = 1; i < words.length; i++) {
    const diff = (k: number): number =>
      Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length)
    if (diff(i) < diff(best)) best = i
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

/** Words of one line: "→" in red, the last word of the headline (or what follows "→") in yellow. */
function colored(line: string, isLast: boolean): React.ReactNode {
  const words = line.split(' ')
  const arrow = words.indexOf('→')
  return words.map((w, i) => {
    const color =
      w === '→'
        ? C.alert
        : (arrow >= 0 && i > arrow) || (arrow < 0 && isLast && i === words.length - 1)
          ? C.accent
          : C.text
    return (
      <span key={i} style={{ color }}>
        {i ? ' ' : ''}
        {w}
      </span>
    )
  })
}

function Headline({
  text,
  maxWidth,
  align
}: {
  text: string
  maxWidth: number
  align: 'left' | 'center'
}): React.JSX.Element {
  const lines = headlineLines(text)
  const longest = Math.max(...lines.map((l) => l.length))
  // Impact capitals are ~0.5 em wide; shrink only when the longest line would overflow.
  const size = Math.min(
    H * (lines.length === 1 ? THUMB.oneLineSize : THUMB.twoLineSize),
    maxWidth / (longest * 0.52)
  )
  return (
    <div
      style={{
        maxWidth,
        fontFamily: THUMB.font,
        fontSize: size,
        lineHeight: 0.98,
        textAlign: align,
        textShadow: outline(THUMB.stroke),
        whiteSpace: 'nowrap'
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{colored(l, i === lines.length - 1)}</div>
      ))}
    </div>
  )
}

function Logo({ src }: { src: string }): React.JSX.Element {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 24,
        padding: '18px 30px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        display: 'flex'
      }}
    >
      <Img
        src={src}
        style={{ height: THUMB.logo.height, maxWidth: THUMB.logo.maxWidth, objectFit: 'contain' }}
      />
    </div>
  )
}

function Photo({ src, extra }: { src: string; extra?: React.CSSProperties }): React.JSX.Element {
  return (
    <Img
      src={src}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        filter: THUMB.photoFilter,
        ...extra
      }}
    />
  )
}

/**
 * 1280x720 thumbnail, one layout per approach: a huge 2–4 word headline (~35% of the height)
 * with a thick outline, a bright image and the company logo.
 */
export const Thumbnail: React.FC<ThumbnailProps> = ({
  approach: model,
  layout,
  background,
  background2,
  text,
  logo,
  face
}) => {
  const approach = layout ?? model
  if (approach === 'face') return <FaceLayout background={background} face={face} text={text} />
  if (approach === 'object-x') return <ObjectXLayout background={background} text={text} />
  if (approach === 'numbers')
    return <NumbersLayout background={background} background2={background2} text={text} />
  if (approach === 'contrast') {
    const left = 'polygon(0 0, 54% 0, 46% 100%, 0 100%)'
    return (
      <AbsoluteFill style={{ backgroundColor: '#333' }}>
        <Photo
          src={background2 ?? background}
          extra={{ filter: 'grayscale(0.85) contrast(1.2) brightness(0.95)' }}
        />
        <AbsoluteFill style={{ clipPath: left }}>
          <Photo src={background} />
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            backgroundColor: C.accent,
            clipPath: 'polygon(53.4% 0, 54.6% 0, 46.6% 100%, 45.4% 100%)'
          }}
        />
        <AbsoluteFill
          style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.45) 0%, transparent 45%)' }}
        />
        {logo && (
          <AbsoluteFill style={{ alignItems: 'center', paddingTop: 34 }}>
            <Logo src={logo} />
          </AbsoluteFill>
        )}
        <AbsoluteFill
          style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 40 }}
        >
          <Headline text={text} maxWidth={1200} align="center" />
        </AbsoluteFill>
      </AbsoluteFill>
    )
  }
  // "number" and "product": image on the right, headline on the left over a light shade.
  return (
    <AbsoluteFill style={{ backgroundColor: '#333' }}>
      <Photo
        src={background}
        extra={{ objectPosition: approach === 'product' ? '70% 50%' : '50% 50%' }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(90deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 50%, transparent 70%)'
        }}
      />
      {logo && (
        <AbsoluteFill style={{ alignItems: 'flex-start', padding: '34px 0 0 50px' }}>
          <Logo src={logo} />
        </AbsoluteFill>
      )}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'flex-start',
          padding: logo ? '0 0 50px 50px' : '0 0 70px 50px'
        }}
      >
        <Headline text={text} maxWidth={approach === 'number' ? 1100 : 760} align="left" />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/** Thick red arrow pointing right, drawn in SVG so it stays sharp at any size. */
function Arrow({ style }: { style: React.CSSProperties }): React.JSX.Element {
  return (
    <svg viewBox="0 0 200 120" style={{ position: 'absolute', ...style }}>
      <path
        d="M8 60 H130 M100 18 L172 60 L100 102"
        fill="none"
        stroke={C.stroke}
        strokeWidth={34}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 60 H130 M100 18 L172 60 L100 102"
        fill="none"
        stroke={C.alert}
        strokeWidth={22}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * A: the real person (real photo, expression edited) huge on the left, the story's object on
 * the right, a red arrow between them. Without a usable face, the object fills the frame.
 */
function FaceLayout({
  background,
  face,
  text
}: Pick<ThumbnailProps, 'background' | 'face' | 'text'>): React.JSX.Element {
  return (
    <AbsoluteFill style={{ backgroundColor: '#111' }}>
      <Photo src={background} extra={{ objectPosition: '75% 50%' }} />
      {face && (
        <>
          <AbsoluteFill
            style={{
              background:
                'linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 45%, transparent 60%)'
            }}
          />
          <Img
            src={face}
            style={{
              position: 'absolute',
              left: -20,
              bottom: 0,
              height: '104%',
              maxWidth: '58%',
              objectFit: 'contain',
              objectPosition: 'left bottom',
              filter: 'drop-shadow(0 0 18px rgba(0,0,0,0.6)) brightness(1.08) contrast(1.08)'
            }}
          />
          <Arrow style={{ left: 560, top: 250, width: 230 }} />
        </>
      )}
      {text && (
        <AbsoluteFill
          style={{ justifyContent: 'flex-start', alignItems: 'flex-end', padding: '40px 50px 0 0' }}
        >
          <Headline text={text} maxWidth={620} align="center" />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}

/** B: the real object huge on a plain background, crossed by a red X; 1–2 words. */
function ObjectXLayout({
  background,
  text
}: Pick<ThumbnailProps, 'background' | 'text'>): React.JSX.Element {
  const bar: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 760,
    height: 64,
    marginLeft: -380,
    marginTop: -32,
    background: C.alert,
    borderRadius: 18,
    boxShadow: `0 0 0 10px ${C.stroke}`,
    opacity: 0.92
  }
  return (
    <AbsoluteFill style={{ backgroundColor: '#1a1a1a' }}>
      <Photo src={background} />
      <div style={{ ...bar, transform: 'rotate(35deg)' }} />
      <div style={{ ...bar, transform: 'rotate(-35deg)' }} />
      {text && (
        <AbsoluteFill
          style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 30 }}
        >
          <Headline text={text} maxWidth={1180} align="center" />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}

/** C: before and after side by side, each with its big number ("$250B → $0"). */
function NumbersLayout({
  background,
  background2,
  text
}: Pick<ThumbnailProps, 'background' | 'background2' | 'text'>): React.JSX.Element {
  const [before, after] = text.split('→').map((t) => t.trim())
  const number = (value: string, color: string): React.JSX.Element => (
    <div
      style={{
        fontFamily: THUMB.font,
        fontSize: Math.min(250, 1200 / Math.max(3, value.length * 1.1)),
        color,
        textShadow: outline(THUMB.stroke),
        lineHeight: 1
      }}
    >
      {value}
    </div>
  )
  return (
    <AbsoluteFill style={{ backgroundColor: '#222', flexDirection: 'row' }}>
      <div style={{ position: 'relative', width: '50%', height: '100%', overflow: 'hidden' }}>
        <Photo src={background} />
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          {number(before ?? text, C.accent)}
        </AbsoluteFill>
      </div>
      <div style={{ position: 'relative', width: '50%', height: '100%', overflow: 'hidden' }}>
        <Photo
          src={background2 ?? background}
          extra={{ filter: 'grayscale(0.9) contrast(1.25) brightness(0.9)' }}
        />
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          {after ? number(after, C.alert) : null}
        </AbsoluteFill>
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          bottom: 0,
          width: 14,
          marginLeft: -7,
          background: C.stroke
        }}
      />
    </AbsoluteFill>
  )
}
