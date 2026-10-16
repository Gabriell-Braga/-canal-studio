import React from 'react'
import { AbsoluteFill, Img } from 'remotion'
import type { ThumbnailProps } from '../../shared/render'
import {
  portraitPlacement,
  VINTAGE_THUMB,
  vintageLayout,
  type PlacedText,
  type PxBox,
  type TemplateDraw
} from '../../shared/thumb'
import { B, F, loadFonts, Paper, RubberStamp } from './vintage-ads'
import { TemplateThumb } from './vintage-templates'

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

/**
 * Ads on Trial thumbnails: A the real ad + a huge stamp, B the era's face with an arrow to
 * the product, C then vs today. Every box comes from vintageLayout (shared/thumb.ts).
 */
export const VintageThumbnail: React.FC<ThumbnailProps> = (props) => {
  loadFonts()
  const layout = props.layout ?? props.approach
  if (layout === 'template' && props.template)
    return <TemplateThumb draw={props.template as TemplateDraw} />
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
