import React from 'react'
import { AbsoluteFill, Img } from 'remotion'
import type { ThumbnailProps } from '../../shared/render'
import {
  conceptLayout,
  fitStamp,
  pieceAspect,
  portraitPlacement,
  VINTAGE_THUMB,
  vintageLayout,
  type ConceptDraw,
  type ConceptPiece,
  type PlacedText,
  type PxBox
} from '../../shared/thumb'
import { B, F, loadFonts, Paper, RubberStamp } from './vintage-ads'

/** Torn newspaper strip along the bottom: the channel's fixed mark on every thumbnail. */
function ClippingStrip(): React.JSX.Element {
  const teeth = Array.from({ length: 64 }, (_, i) => `${(i / 63) * 100}% ${i % 2 ? 0 : 14}px`)
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: VINTAGE_THUMB.strip,
        background: B.paper,
        clipPath: `polygon(${teeth.join(', ')}, 100% 100%, 0 100%)`,
        boxShadow: '0 -4px 12px rgba(0,0,0,0.3)'
      }}
    />
  )
}

function Arrow({ style }: { style: React.CSSProperties }): React.JSX.Element {
  return (
    <svg viewBox="0 0 200 120" style={{ position: 'absolute', ...style }}>
      {[
        [B.ink, 34],
        [B.stamp, 22]
      ].map(([color, width]) => (
        <path
          key={color}
          d="M8 60 H130 M100 18 L172 60 L100 102"
          fill="none"
          stroke={color as string}
          strokeWidth={width as number}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

/** A text or stamp exactly where vintageLayout placed it (inside the 6% safe area). */
function Placed({ t, color }: { t: PlacedText; color?: string }): React.JSX.Element {
  if (t.kind === 'stamp')
    return (
      <div style={{ position: 'absolute', left: t.center.x, top: t.center.y }}>
        <RubberStamp
          text={t.text}
          at={-5}
          size={t.size}
          rotate={t.rotate}
          style={{ left: 0, top: 0, translate: '-50% -50%' }}
        />
      </div>
    )
  return (
    <div
      style={{
        position: 'absolute',
        left: t.box.x,
        top: t.box.y,
        width: t.box.w,
        fontFamily: F.title,
        fontSize: t.size,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        textAlign: 'center',
        color: color ?? B.paper,
        textShadow: color ? 'none' : `6px 6px 0 ${B.ink}`
      }}
    >
      {t.text}
    </div>
  )
}

/** An image contained in a box, slightly tilted. */
function Framed({
  src,
  box,
  rotate,
  shadow = true
}: {
  src: string
  box: PxBox
  rotate: number
  shadow?: boolean
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Img
        src={src}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          transform: `rotate(${rotate}deg)`,
          filter: 'contrast(1.15)',
          boxShadow: shadow ? '0 16px 40px rgba(0,0,0,0.6)' : undefined
        }}
      />
    </div>
  )
}

/** Plain dark board with a faint grain: the background of models A and B. */
function Board({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <AbsoluteFill style={{ backgroundColor: '#15120E' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', opacity: 0.25 }}>
        <filter id="board-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves={2} seed={7} />
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0.35 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#board-grain)" />
      </svg>
      {children}
    </AbsoluteFill>
  )
}

/** A letter on old paper, handwritten: the reply signed in someone's name. */
function Letter({ words, box }: { words: string; box: PxBox }): React.JSX.Element {
  const w = Math.min(box.w, box.h * 0.78)
  const h = w / 0.78
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x + (box.w - w) / 2,
        top: box.y + (box.h - h) / 2,
        width: w,
        height: h,
        transform: 'rotate(3deg)',
        boxShadow: '0 18px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden'
      }}
    >
      <Paper>
        <div
          style={{
            position: 'absolute',
            inset: '9% 9%',
            backgroundImage: `repeating-linear-gradient(transparent 0 ${w * 0.105}px, rgba(60,80,140,0.25) ${w * 0.105}px ${w * 0.11}px)`
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: '9% 9%',
            fontFamily: F.hand,
            fontSize: w * 0.075,
            lineHeight: `${w * 0.11}px`,
            color: '#2A2118',
            whiteSpace: 'pre-wrap'
          }}
        >
          {words.replace(/\s*\/\s*/g, '\n')}
        </div>
      </Paper>
    </div>
  )
}

/** A product label drawn in the period's type: double rule, name in bold serif caps. */
function Label({ words, box }: { words: string; box: PxBox }): React.JSX.Element {
  const w = Math.min(box.w, box.h * 1.3)
  const h = w / 1.3
  const lines = words.toUpperCase().split(/\s*\/\s*/)
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x + (box.w - w) / 2,
        top: box.y + (box.h - h) / 2,
        width: w,
        height: h,
        background: B.paper,
        border: `${w * 0.02}px double ${B.ink}`,
        outline: `${w * 0.012}px solid ${B.ink}`,
        outlineOffset: -w * 0.05,
        boxShadow: '0 18px 40px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: w * 0.09,
        fontFamily: F.card,
        fontWeight: 700,
        color: B.ink,
        fontSize: (w * 0.75) / Math.max(8, ...lines.map((l) => l.length)),
        lineHeight: 1.1
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  )
}

/** A gravestone in engraving style: grey slab, hatched shading, carved inscription. */
function Tombstone({ words, box }: { words: string; box: PxBox }): React.JSX.Element {
  const w = Math.min(box.w, box.h * 0.72)
  const h = w / 0.72
  const lines = words.toUpperCase().split(/\s*\/\s*/)
  const size = Math.min((w * 0.62) / Math.max(6, ...lines.map((l) => l.length)) * 1.6, w * 0.13)
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x + (box.w - w) / 2,
        top: box.y + (box.h - h) / 2,
        width: w,
        height: h
      }}
    >
      <svg viewBox="0 0 100 140" width={w} height={h} style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="stone" x1="0" x2="1">
            <stop offset="0" stopColor="#9C988F" />
            <stop offset="1" stopColor="#5E5A53" />
          </linearGradient>
          <pattern id="hatch" width="2.2" height="2.2" patternUnits="userSpaceOnUse">
            <path d="M0 2.2 L2.2 0" stroke="#1B1712" strokeWidth="0.35" />
          </pattern>
        </defs>
        <path d="M6 140 V45 Q6 4 50 4 Q94 4 94 45 V140 Z" fill="url(#stone)" />
        <path d="M70 140 V45 Q70 14 50 8 Q94 4 94 45 V140 Z" fill="url(#hatch)" opacity="0.55" />
        <path
          d="M6 140 V45 Q6 4 50 4 Q94 4 94 45 V140 Z"
          fill="none"
          stroke="#1B1712"
          strokeWidth="2"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: '14%',
          right: '14%',
          top: '30%',
          textAlign: 'center',
          fontFamily: F.card,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.25,
          color: '#2B2823',
          textShadow: '1px 1px 0 rgba(255,255,255,0.35)'
        }}
      >
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}

/** A typed sheet: a law, a lab report, a court record. */
function Document({ words, box }: { words: string; box: PxBox }): React.JSX.Element {
  const w = Math.min(box.w, box.h * 0.75)
  const h = w / 0.75
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x + (box.w - w) / 2,
        top: box.y + (box.h - h) / 2,
        width: w,
        height: h,
        transform: 'rotate(-2deg)',
        boxShadow: '0 18px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden'
      }}
    >
      <Paper>
        <div
          style={{
            position: 'absolute',
            inset: '10% 10%',
            fontFamily: F.type,
            fontSize: w * 0.07,
            lineHeight: 1.35,
            color: B.ink,
            whiteSpace: 'pre-wrap'
          }}
        >
          {words.replace(/\s*\/\s*/g, '\n')}
        </div>
      </Paper>
    </div>
  )
}

/** One concept element in its box: a bank picture, or the brand part that stands for it. */
function Piece({
  p,
  box,
  cover
}: {
  p: ConceptPiece
  box: PxBox
  cover: boolean
}): React.JSX.Element {
  if (p.src)
    return cover ? (
      <Img
        src={p.src}
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          objectFit: 'cover',
          // A tall picture keeps its top: the face, the headline, the label.
          objectPosition: '50% 12%',
          boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
          filter: 'contrast(1.15)'
        }}
      />
    ) : (
      <Framed src={p.src} box={box} rotate={2} />
    )
  if (p.kind === 'letter') return <Letter words={p.words} box={box} />
  if (p.kind === 'tombstone') return <Tombstone words={p.words} box={box} />
  if (p.kind === 'document') return <Document words={p.words} box={box} />
  if (p.kind === 'stamp') {
    const t = fitStamp(p.words.toUpperCase(), box, 200, -8)
    return <Placed t={t} />
  }
  return <Label words={p.words} box={box} />
}

/** Text in bold condensed caps with a dark outline; the conflict word in stamp red. */
function BoldText({ t, accent }: { t: PlacedText; accent: string }): React.JSX.Element {
  const a = accent.toUpperCase().replace(/[^A-Z0-9$%]/g, '')
  return (
    <div
      style={{
        position: 'absolute',
        left: t.box.x,
        top: t.box.y,
        fontFamily: F.stamp,
        fontWeight: 700,
        fontSize: t.size,
        lineHeight: 1,
        letterSpacing: 1,
        whiteSpace: 'nowrap',
        color: '#FFFFFF',
        WebkitTextStroke: `${Math.max(6, t.size * 0.07)}px ${B.ink}`,
        paintOrder: 'stroke fill',
        filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.6))'
      }}
    >
      {t.text.split(' ').map((w, i) => (
        <span
          key={i}
          style={{ color: a && w.replace(/[^A-Z0-9$%]/g, '') === a ? B.stamp : undefined }}
        >
          {i ? ' ' : ''}
          {w}
        </span>
      ))}
    </div>
  )
}

/**
 * Concept thumbnail (Z reading): the dominant subject on the left, the text top right, the
 * conflict element bottom right, one red accent. Boxes come from conceptLayout.
 */
function ConceptThumb({ text, draw }: { text: string; draw: ConceptDraw }): React.JSX.Element {
  const L = conceptLayout(text, pieceAspect(draw.subject), draw.stamp)
  const body = (
    <>
      <Piece p={draw.subject} box={L.subject} cover />
      {draw.support && <Piece p={draw.support} box={L.support} cover={false} />}
      {L.stamp && <Placed t={L.stamp} />}
      {L.texts.map((t, i) => (
        <BoldText key={i} t={t} accent={draw.accentWord} />
      ))}
      <ClippingStrip />
    </>
  )
  return draw.background === 'paper' ? <Paper>{body}</Paper> : <Board>{body}</Board>
}

/**
 * Ads on Trial thumbnails: A the real ad + a huge stamp, B the era's face with an arrow to
 * the product, C then vs today. Every box comes from vintageLayout (shared/thumb.ts).
 */
export const VintageThumbnail: React.FC<ThumbnailProps> = (props) => {
  loadFonts()
  const layout = props.layout ?? props.approach
  if (layout === 'concept' && props.concept)
    return <ConceptThumb text={props.text} draw={props.concept as ConceptDraw} />
  const L = vintageLayout(layout, props.text)
  const product = props.background2 ?? props.background
  if (layout === 'then-now') {
    const thenText = L.texts.find((t) => t.role === 'then')
    const nowText = L.texts.find((t) => t.role === 'now')
    return (
      <AbsoluteFill style={{ backgroundColor: B.ink }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%' }}>
          <Paper />
        </div>
        {L.product && <Framed src={product} box={L.product} rotate={-3} shadow={false} />}
        {thenText && <Placed t={thenText} color={B.ink} />}
        {nowText && <Placed t={nowText} />}
        {nowText && L.price && (
          <div
            style={{
              position: 'absolute',
              left: nowText.box.x,
              width: nowText.box.w,
              top: nowText.box.y + nowText.box.h + 10,
              textAlign: 'center',
              fontFamily: F.stamp,
              fontWeight: 700,
              fontSize: 56,
              letterSpacing: 6,
              color: B.stamp
            }}
          >
            TODAY
          </div>
        )}
        <ClippingStrip />
      </AbsoluteFill>
    )
  }
  if (layout === 'era-face') {
    const face = props.faceBox as { y: number; h: number } | null | undefined
    const p = portraitPlacement(face ?? null)
    return (
      <Board>
        {L.product && <Framed src={product} box={L.product} rotate={3} />}
        {props.face && (
          <>
            <Img
              src={props.face}
              style={{
                position: 'absolute',
                left: 20,
                top: p.top,
                height: p.height,
                maxWidth: '58%',
                objectFit: 'contain',
                objectPosition: 'left top',
                filter: 'drop-shadow(0 0 16px rgba(0,0,0,0.7))'
              }}
            />
            <Arrow style={{ left: 560, top: 330, width: 210 }} />
          </>
        )}
        {L.texts.map((t, i) => (
          <Placed key={i} t={t} />
        ))}
        <ClippingStrip />
      </Board>
    )
  }
  // ad-stamp: the real scan, big and legible, with a huge red stamp half over it.
  const ad = L.ad as PxBox
  return (
    <Board>
      <Img
        src={props.background}
        style={{
          position: 'absolute',
          left: ad.x,
          top: ad.y,
          width: ad.w,
          height: ad.h,
          // A tall ad shows its top (headline and picture) big.
          objectFit: 'cover',
          objectPosition: '50% 0%',
          transform: 'rotate(-1.5deg)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
          filter: 'contrast(1.2)'
        }}
      />
      {L.texts.map((t, i) => (
        <Placed key={i} t={t} />
      ))}
      <ClippingStrip />
    </Board>
  )
}
