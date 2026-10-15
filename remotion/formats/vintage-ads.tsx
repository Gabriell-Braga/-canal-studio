import React from 'react'
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from 'remotion'
import { ADS_ON_TRIAL } from '../../shared/formats/vintage-ads'
import type { AdOverlays, Box, RenderScene, ThumbnailProps, VideoProps } from '../../shared/render'

const B = ADS_ON_TRIAL
const F = {
  title: `"${B.fonts.title}", Georgia, serif`,
  stamp: `"${B.fonts.stamp}", Impact, sans-serif`,
  type: `"${B.fonts.type}", "Courier New", monospace`,
  card: `"${B.fonts.card}", Georgia, serif`
}
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

// The channel's fonts ship in remotion/public/fonts (all OFL / Apache).
const FONT_FILES: [string, string, string?][] = [
  [B.fonts.title, 'AbrilFatface-Regular.ttf'],
  [B.fonts.stamp, 'Oswald.ttf', '700'],
  [B.fonts.type, 'SpecialElite-Regular.ttf'],
  [B.fonts.card, 'OldStandard-Regular.ttf'],
  [B.fonts.card, 'OldStandard-Bold.ttf', '700']
]
let fontsLoading: Promise<void> | null = null
function loadFonts(): void {
  if (fontsLoading || typeof document === 'undefined') return
  const handle = delayRender('Ads on Trial fonts')
  fontsLoading = Promise.all(
    FONT_FILES.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, {
        weight: weight ?? '400'
      })
      await face.load()
      ;(document.fonts as unknown as { add: (f: FontFace) => void }).add(face)
    })
  )
    .catch(() => undefined)
    .then(() => continueRender(handle))
}

/** Aged paper: base color plus a faint fibrous noise. */
function Paper({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <AbsoluteFill style={{ backgroundColor: B.paper }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', opacity: 0.35 }}>
        <filter id="paper-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={3} seed={4} />
          <feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.35  0 0 0 0 0.24  0 0 0 0.55 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#paper-grain)" />
      </svg>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(80,55,20,0.35) 100%)'
        }}
      />
      {children}
    </AbsoluteFill>
  )
}

/** Where an image of aspect `a` sits when contained in a w×h box. */
function contained(
  a: number,
  w: number,
  h: number
): { x: number; y: number; w: number; h: number } {
  const fitW = Math.min(w, h * a)
  const fitH = fitW / a
  return { x: (w - fitW) / 2, y: (h - fitH) / 2, w: fitW, h: fitH }
}

/**
 * The ad scan laid on paper, slightly tilted, with a slow push-in; phrases light up with an
 * animated highlighter at the seconds given, following the OCR word boxes.
 */
export function PaperScan({
  scene,
  frames
}: {
  scene: RenderScene
  frames: number
}): React.JSX.Element {
  loadFonts()
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const zoom = interpolate(frame, [0, frames], [1, 1.07], clamp)
  const area = { w: width * 0.82, h: height * 0.88 }
  const img = contained(scene.focus?.aspect ?? 0.75, area.w, area.h)
  const highlight = (boxes: Box[], at: number, k: number): React.ReactNode =>
    boxes.map((b, i) => {
      // Words light up one after another, like a marker dragged along the line.
      const start = (at + i * 0.12) * fps
      const p = interpolate(frame, [start, start + 0.25 * fps], [0, 1], clamp)
      return (
        <div
          key={`${k}-${i}`}
          style={{
            position: 'absolute',
            left: img.x + (b.x - 0.004) * img.w,
            top: img.y + (b.y - 0.006) * img.h,
            width: (b.w + 0.008) * img.w * p,
            height: (b.h + 0.012) * img.h,
            background: 'rgba(255, 214, 0, 0.55)',
            mixBlendMode: 'multiply',
            borderRadius: 3
          }}
        />
      )
    })
  return (
    <Paper>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div
          style={{
            position: 'relative',
            width: area.w,
            height: area.h,
            transform: `scale(${zoom}) rotate(-1.2deg)`
          }}
        >
          <Img
            src={scene.src}
            style={{
              position: 'absolute',
              left: img.x,
              top: img.y,
              width: img.w,
              height: img.h,
              filter: 'sepia(0.15) contrast(1.15)',
              mixBlendMode: 'multiply',
              boxShadow: '0 18px 40px rgba(40,25,5,0.35)'
            }}
          />
          {scene.scan?.highlights.map((h, k) => highlight(h.boxes, h.at, k))}
        </div>
      </AbsoluteFill>
    </Paper>
  )
}

/** Worn rubber-stamp ink: the same texture on every stamp of the channel. */
function StampInk({ id }: { id: string }): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <filter id={id}>
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={11} />
        <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.75" />
        <feComposite in="SourceGraphic" operator="in" />
        <feDisplacementMap in2="SourceGraphic" scale={2} />
      </filter>
    </svg>
  )
}

/** A rubber stamp that drops onto the frame with a small bounce and a tilt. */
export function RubberStamp({
  text,
  at,
  size = 150,
  rotate = -12,
  style
}: {
  text: string
  at: number
  size?: number
  rotate?: number
  style?: React.CSSProperties
}): React.JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const f = frame - at * fps
  if (f < 0) return null
  const drop = spring({ frame: f, fps, config: { damping: 9, stiffness: 180, mass: 0.6 } })
  const scale = interpolate(drop, [0, 1], [2.4, 1])
  const shake = f < 6 ? Math.sin(f * 2.5) * (6 - f) * 0.6 : 0
  return (
    <div
      style={{
        position: 'absolute',
        transform: `translate(${shake}px, ${shake / 2}px) rotate(${rotate}deg) scale(${scale})`,
        opacity: interpolate(drop, [0, 0.3], [0, 1], clamp),
        ...style
      }}
    >
      <StampInk id="stamp-ink" />
      <div
        style={{
          filter: 'url(#stamp-ink)',
          border: `${size * 0.07}px solid ${B.stamp}`,
          borderRadius: size * 0.08,
          padding: `${size * 0.05}px ${size * 0.22}px`,
          fontFamily: F.stamp,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.05,
          letterSpacing: size * 0.04,
          color: B.stamp,
          whiteSpace: 'nowrap',
          textTransform: 'uppercase'
        }}
      >
        {text}
      </div>
    </div>
  )
}

function fadeWindow(frame: number, fps: number, at: number, until: number): number {
  return interpolate(
    frame,
    [at * fps, (at + 0.35) * fps, (until - 0.35) * fps, until * fps],
    [0, 1, 1, 0],
    clamp
  )
}

/** Paper price tag on a string: then → today, computed from the CPI table. */
function PriceTag({ tag }: { tag: AdOverlays['priceTags'][number] }): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const o = fadeWindow(frame, fps, tag.at, tag.until)
  const swing = Math.sin((frame / fps) * 2.2) * 2.5
  return (
    <div
      style={{
        position: 'absolute',
        right: 110,
        top: 90,
        opacity: o,
        transform: `rotate(${6 + swing}deg)`,
        transformOrigin: '50% -40px'
      }}
    >
      <div
        style={{
          background: '#F4EBD3',
          color: B.ink,
          padding: '26px 46px 30px 70px',
          clipPath: 'polygon(0 50%, 16% 0, 100% 0, 100% 100%, 16% 100%)',
          boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
          fontFamily: F.card,
          textAlign: 'right'
        }}
      >
        <div style={{ fontSize: 34 }}>
          {tag.then} in {tag.year}
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.05 }}>
          ≈ {tag.today} <span style={{ fontSize: 34, fontWeight: 400 }}>today</span>
        </div>
        {tag.estimate && (
          <div style={{ fontFamily: F.type, fontSize: 20, opacity: 0.7 }}>pre-1913 estimate</div>
        )}
      </div>
    </div>
  )
}

/** Provenance card: newspaper, place, date and page, the channel's proof. */
function SourceCard({ card }: { card: NonNullable<AdOverlays['paperTrail']> }): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const o = fadeWindow(frame, fps, card.at, card.at + 4.8)
  return (
    <div
      style={{
        position: 'absolute',
        left: 80,
        bottom: 90,
        opacity: o,
        transform: `translateY(${(1 - o) * 30}px) rotate(-1.5deg)`,
        background: '#F7F0DC',
        color: B.ink,
        padding: '22px 34px',
        border: `2px solid ${B.ink}`,
        boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
        fontFamily: F.card,
        maxWidth: 760
      }}
    >
      <div style={{ fontFamily: F.type, fontSize: 22, letterSpacing: 2, opacity: 0.75 }}>
        PAPER TRAIL
      </div>
      <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>{card.newspaper}</div>
      <div style={{ fontSize: 30 }}>
        {card.place}
        {card.place ? ' · ' : ''}
        {card.date} · page {card.page}
      </div>
      <div style={{ fontFamily: F.type, fontSize: 20, opacity: 0.7, marginTop: 6 }}>
        Library of Congress · Chronicling America
      </div>
    </div>
  )
}

/** Old pharmacy label with what a lab of the time found inside. */
function IngredientLabel({
  label
}: {
  label: NonNullable<AdOverlays['ingredients']>
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const o = fadeWindow(frame, fps, label.at, label.until)
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-end', paddingRight: 120 }}>
      <div
        style={{
          opacity: o,
          transform: `scale(${0.9 + 0.1 * o})`,
          width: 560,
          background: '#FBF5E4',
          color: B.ink,
          border: `6px double ${B.ink}`,
          padding: '26px 34px',
          fontFamily: F.card,
          boxShadow: '0 14px 30px rgba(0,0,0,0.4)'
        }}
      >
        <div
          style={{
            fontFamily: F.title,
            fontSize: 46,
            textAlign: 'center',
            borderBottom: `2px solid ${B.ink}`,
            paddingBottom: 8
          }}
        >
          What Was Inside
        </div>
        {label.items.map((it, i) => (
          <div
            key={i}
            style={{
              fontSize: 34,
              padding: '6px 0',
              borderBottom: '1px dotted rgba(27,23,18,0.4)',
              opacity: interpolate(
                frame,
                [(label.at + 0.4 + i * 0.35) * fps, (label.at + 0.7 + i * 0.35) * fps],
                [0, 1],
                clamp
              )
            }}
          >
            {it}
          </div>
        ))}
        <div style={{ fontFamily: F.type, fontSize: 18, marginTop: 10, opacity: 0.75 }}>
          Source: {label.source}
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** Closing segment: would this ad run today? */
function VerdictCard({ v }: { v: NonNullable<AdOverlays['verdict']> }): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const o = interpolate(frame, [v.at * fps, (v.at + 0.5) * fps], [0, 1], clamp)
  const running = /still/i.test(v.law)
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <Paper>
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 26 }}>
          <div style={{ fontFamily: F.title, fontSize: 96, color: B.ink }}>Would It Run Today?</div>
          <div
            style={{
              fontFamily: F.card,
              fontSize: 48,
              color: B.ink,
              maxWidth: 1300,
              textAlign: 'center'
            }}
          >
            {v.text}
          </div>
          <div style={{ position: 'relative', height: 200, width: 1200 }}>
            <RubberStamp
              text={running ? 'STILL RUNNING' : v.law}
              at={v.at + 1.2}
              size={running ? 110 : 76}
              rotate={-6}
              style={{ left: '50%', top: 20, translate: '-50% 0' }}
            />
          </div>
        </AbsoluteFill>
      </Paper>
    </AbsoluteFill>
  )
}

/** Every Ads on Trial overlay of a video. */
export function AdOverlaysView({ video }: { video: VideoProps }): React.JSX.Element | null {
  loadFonts()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ads = (video.overlays as { ads?: AdOverlays } | undefined)?.ads
  if (!ads) return null
  const t = frame / fps
  return (
    <>
      {ads.paperTrail && t >= ads.paperTrail.at - 0.1 && t < ads.paperTrail.at + 5 && (
        <SourceCard card={ads.paperTrail} />
      )}
      {ads.priceTags
        .filter((p) => t >= p.at - 0.1 && t < p.until)
        .map((p, i) => (
          <PriceTag key={i} tag={p} />
        ))}
      {ads.claims
        .filter((c) => t >= c.at && t < c.at + 3.2)
        .map((c, i) => (
          <AbsoluteFill key={i} style={{ justifyContent: 'center', alignItems: 'center' }}>
            <RubberStamp text={c.verdict} at={c.at} size={c.verdict.length > 6 ? 120 : 170} />
            <div
              style={{
                position: 'absolute',
                bottom: 70,
                fontFamily: F.type,
                fontSize: 26,
                color: B.paper,
                background: 'rgba(27,23,18,0.82)',
                padding: '8px 18px',
                opacity: interpolate(frame, [(c.at + 0.5) * fps, (c.at + 0.8) * fps], [0, 1], clamp)
              }}
            >
              Source: {c.source}
            </div>
          </AbsoluteFill>
        ))}
      {ads.ingredients && t >= ads.ingredients.at - 0.1 && t < ads.ingredients.until && (
        <IngredientLabel label={ads.ingredients} />
      )}
      {ads.verdict && t >= ads.verdict.at && <VerdictCard v={ads.verdict} />}
    </>
  )
}

// ---------------------------------------------------------------- thumbnails

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
        height: 46,
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
      <path
        d="M8 60 H130 M100 18 L172 60 L100 102"
        fill="none"
        stroke={B.ink}
        strokeWidth={34}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 60 H130 M100 18 L172 60 L100 102"
        fill="none"
        stroke={B.stamp}
        strokeWidth={22}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BigWord({
  text,
  style
}: {
  text: string
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        fontFamily: F.title,
        fontSize: 120,
        lineHeight: 1,
        color: B.paper,
        textShadow: `0 0 0 ${B.ink}, 6px 6px 0 ${B.ink}`,
        ...style
      }}
    >
      {text}
    </div>
  )
}

/**
 * Ads on Trial thumbnails: A the real ad + a huge stamp, B the era's face with an arrow to
 * the product, C then vs today. Text 0–3 words, one red accent.
 */
export const VintageThumbnail: React.FC<ThumbnailProps> = (props) => {
  loadFonts()
  const layout = props.layout ?? props.approach
  if (layout === 'then-now') {
    const [then, now] = props.text.split('→').map((t) => t.trim())
    return (
      <AbsoluteFill style={{ backgroundColor: B.ink, flexDirection: 'row' }}>
        <div style={{ width: '50%', height: '100%', position: 'relative' }}>
          <Paper>
            <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 40 }}>
              <Img
                src={props.background2 ?? props.background}
                style={{
                  maxWidth: '88%',
                  maxHeight: '70%',
                  transform: 'rotate(-3deg)',
                  mixBlendMode: 'multiply'
                }}
              />
            </AbsoluteFill>
            {then && (
              <BigWord
                text={then}
                style={{ left: 40, top: 30, color: B.ink, textShadow: 'none' }}
              />
            )}
          </Paper>
        </div>
        <div style={{ width: '50%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <Img
            src={props.background}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {now && (
            <RubberStamp
              text={now}
              at={-5}
              size={110}
              rotate={-10}
              style={{ right: 40, top: 40 }}
            />
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 10,
            marginLeft: -5,
            background: B.ink
          }}
        />
        <ClippingStrip />
      </AbsoluteFill>
    )
  }
  if (layout === 'era-face') {
    return (
      <AbsoluteFill style={{ backgroundColor: B.ink }}>
        <Img
          src={props.background}
          style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }}
        />
        {props.background2 && (
          <Img
            src={props.background2}
            style={{
              position: 'absolute',
              right: 50,
              top: 70,
              height: 520,
              maxWidth: 520,
              objectFit: 'contain',
              transform: 'rotate(3deg)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.6)'
            }}
          />
        )}
        {props.face && (
          <>
            <Img
              src={props.face}
              style={{
                position: 'absolute',
                left: -10,
                bottom: 0,
                height: '100%',
                maxWidth: '55%',
                objectFit: 'contain',
                objectPosition: 'left bottom',
                filter: 'drop-shadow(0 0 16px rgba(0,0,0,0.7))'
              }}
            />
            <Arrow style={{ left: 520, top: 260, width: 220 }} />
          </>
        )}
        {props.text && <BigWord text={props.text.toUpperCase()} style={{ left: 40, top: 30 }} />}
        <ClippingStrip />
      </AbsoluteFill>
    )
  }
  // ad-stamp: the real scan, big and tilted on dark, with a huge red stamp.
  const [stamp, ...rest] = props.text.split(/\s+/)
  return (
    <AbsoluteFill style={{ backgroundColor: '#15120E' }}>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 70 }}>
        <Img
          src={props.background}
          style={{
            // A tall ad shows its top (headline and picture) big: about 60% of the frame.
            height: '112%',
            width: '62%',
            objectFit: 'cover',
            objectPosition: '50% 0%',
            transform: 'rotate(-4deg)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
            filter: 'contrast(1.2)'
          }}
        />
      </AbsoluteFill>
      {stamp && (
        <RubberStamp
          text={stamp}
          at={-5}
          size={stamp.length > 6 ? 150 : 190}
          rotate={-14}
          style={{ right: 40, top: 250 }}
        />
      )}
      {rest.length > 0 && (
        <BigWord
          text={rest.join(' ').toUpperCase()}
          style={{ right: 70, bottom: 80, fontSize: 90 }}
        />
      )}
      <ClippingStrip />
    </AbsoluteFill>
  )
}
