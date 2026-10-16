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
import type { AdOverlays, Box, RenderScene, VideoProps } from '../../shared/render'

export const B = ADS_ON_TRIAL
export const F = {
  title: `"${B.fonts.title}", Georgia, serif`,
  stamp: `"${B.fonts.stamp}", Impact, sans-serif`,
  type: `"${B.fonts.type}", "Courier New", monospace`,
  card: `"${B.fonts.card}", Georgia, serif`,
  hand: `"${B.fonts.hand}", cursive`
}
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

// The channel's fonts ship in remotion/public/fonts (all OFL / Apache).
const FONT_FILES: [string, string, string?][] = [
  [B.fonts.title, 'AbrilFatface-Regular.ttf'],
  [B.fonts.stamp, 'Oswald.ttf', '700'],
  [B.fonts.type, 'SpecialElite-Regular.ttf'],
  [B.fonts.card, 'OldStandard-Regular.ttf'],
  [B.fonts.card, 'OldStandard-Bold.ttf', '700'],
  [B.fonts.hand, 'HomemadeApple-Regular.ttf']
]
let fontsLoading: Promise<void> | null = null
export function loadFonts(): void {
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

/** Resolves once the channel's fonts are loaded (canvas measuring needs them). */
export function fontsReady(): Promise<void> {
  loadFonts()
  return fontsLoading ?? Promise.resolve()
}

/** Aged paper: base color plus a faint fibrous noise, edge to edge (no vignette). */
export function Paper({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <AbsoluteFill style={{ backgroundColor: B.paper }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', opacity: 0.35 }}>
        <filter id="paper-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={3} seed={4} />
          <feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.35  0 0 0 0 0.24  0 0 0 0.55 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#paper-grain)" />
      </svg>
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

/** Share of the frame height the scan fills when the whole ad is shown. */
export const SCAN_HEIGHT = 0.92

/**
 * Camera over a scan, as scale and the point of the scan (px in the frame) kept at the
 * center: it starts close on the quoted phrase and pans along it while the highlighter
 * runs, then pulls back to the whole ad. Without a phrase: a slow push-in.
 */
export function scanCamera(
  frame: number,
  frames: number,
  fps: number,
  size: { width: number; height: number },
  region: { x: number; y: number; w: number; h: number } | null
): { scale: number; x: number; y: number } {
  const cx = size.width / 2
  const cy = size.height / 2
  if (!region) return { scale: interpolate(frame, [0, frames], [1, 1.07], clamp), x: cx, y: cy }
  // Close enough that the phrase spans ~75% of the frame width.
  const close = Math.max(1.3, Math.min(3.2, (size.width * 0.75) / Math.max(1, region.w)))
  const zoomEnd = Math.min(frames * 0.5, 3.2 * fps)
  const backEnd = Math.min(frames * 0.85, zoomEnd + 2.2 * fps)
  const pan = interpolate(frame, [0, zoomEnd], [0.35, 0.65], clamp)
  const back = interpolate(frame, [zoomEnd, backEnd], [0, 1], {
    ...clamp,
    easing: (t) => t * t * (3 - 2 * t)
  })
  const px = region.x + region.w * pan
  const py = region.y + region.h / 2
  return {
    scale: close + (1 - close) * back,
    x: px + (cx - px) * back,
    y: py + (cy - py) * back
  }
}

/**
 * Camera that closes in on one part of a scan (`region`, px in the frame) over the shot:
 * starts halfway in and ends with the part filling ~80% of the width or 85% of the height,
 * kept inside the scan (`img`) so the frame shows ink, not empty paper.
 */
export function regionCamera(
  frame: number,
  frames: number,
  size: { width: number; height: number },
  region: { x: number; y: number; w: number; h: number },
  img: { x: number; y: number; w: number; h: number }
): { scale: number; x: number; y: number } {
  const end = Math.max(
    1.15,
    Math.min(
      2.8,
      (size.width * 0.8) / Math.max(1, region.w),
      (size.height * 0.85) / Math.max(1, region.h)
    )
  )
  const p = interpolate(frame, [0, frames], [0, 1], { ...clamp, easing: (t) => t * (2 - t) })
  const scale = 1 + (end - 1) * (0.55 + 0.45 * p)
  const inside = (c: number, lo: number, len: number, view: number): number => {
    const half = view / (2 * scale)
    return len * scale <= view ? lo + len / 2 : Math.min(lo + len - half, Math.max(lo + half, c))
  }
  const rx = region.x + region.w / 2
  const ry = region.y + region.h * (0.4 + 0.2 * p)
  return {
    scale,
    x: inside(rx, img.x, img.w, size.width),
    y: inside(ry, img.y, img.h, size.height)
  }
}

/**
 * The ad scan on full-frame paper, filling most of the height; the camera follows the
 * quoted phrase and phrases light up with an animated highlighter at the seconds given.
 */
export function PaperScan({
  shot,
  frames
}: {
  shot: Pick<RenderScene, 'src' | 'scan' | 'focus' | 'motion'>
  frames: number
}): React.JSX.Element {
  loadFonts()
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const aspect = shot.scan?.aspect ?? shot.focus?.aspect ?? 0.75
  const box = contained(aspect, width * 0.96, height * SCAN_HEIGHT)
  const img = { ...box, x: box.x + width * 0.02, y: box.y + (height * (1 - SCAN_HEIGHT)) / 2 }
  const lights = shot.scan?.highlights ?? []
  const first = lights.find((h) => h.boxes.length)?.boxes ?? []
  const region = first.length
    ? (() => {
        const x = Math.min(...first.map((b) => b.x))
        const y = Math.min(...first.map((b) => b.y))
        const r = Math.max(...first.map((b) => b.x + b.w))
        const bt = Math.max(...first.map((b) => b.y + b.h))
        return {
          x: img.x + x * img.w,
          y: img.y + y * img.h,
          w: (r - x) * img.w,
          h: (bt - y) * img.h
        }
      })()
    : null
  // No phrase to follow: close in on this shot's part of the scan (OCR text bands).
  const part = shot.scan?.regions?.[0]
  const cam =
    !region && part
      ? regionCamera(
          frame,
          frames,
          { width, height },
          {
            x: img.x + part.x * img.w,
            y: img.y + part.y * img.h,
            w: part.w * img.w,
            h: part.h * img.h
          },
          img
        )
      : scanCamera(frame, frames, fps, { width, height }, region)
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
      <AbsoluteFill
        style={{
          transformOrigin: '0 0',
          transform: `translate(${width / 2 - cam.scale * cam.x}px, ${height / 2 - cam.scale * cam.y}px) scale(${cam.scale})`
        }}
      >
        <Img
          src={shot.src}
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
        {lights.map((h, k) => highlight(h.boxes, h.at, k))}
      </AbsoluteFill>
    </Paper>
  )
}

/** Worn rubber-stamp ink: the same texture on every stamp of the channel. */
export function StampInk({ id }: { id: string }): React.JSX.Element {
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
function SourceCard({
  card,
  top
}: {
  card: NonNullable<AdOverlays['paperTrail']>
  top: boolean
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const o = fadeWindow(frame, fps, card.at, card.at + 4.8)
  return (
    <div
      style={{
        position: 'absolute',
        left: 80,
        ...(top ? { top: 70 } : { bottom: 90 }),
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
        {card.place && (card.date || card.page) ? ' · ' : ''}
        {card.date}
        {card.page ? ` · page ${card.page}` : ''}
      </div>
      {card.link && (
        <div style={{ fontFamily: F.type, fontSize: 18, opacity: 0.7, marginTop: 6 }}>
          {card.link}
        </div>
      )}
      {!card.link && (
        <div style={{ fontFamily: F.type, fontSize: 20, opacity: 0.7, marginTop: 6 }}>
          Library of Congress · Chronicling America
        </div>
      )}
    </div>
  )
}

/** Old pharmacy label with what a lab of the time found inside. */
function IngredientLabel({
  label,
  top
}: {
  label: NonNullable<AdOverlays['ingredients']>
  top: boolean
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const o = fadeWindow(frame, fps, label.at, label.until)
  return (
    <AbsoluteFill
      style={{
        justifyContent: top ? 'flex-start' : 'center',
        alignItems: 'flex-end',
        paddingRight: 120,
        paddingTop: top ? 60 : 0
      }}
    >
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

/** The last opening caption can run a little past the window (it is never cut mid-phrase). */
const CAPTION_OVERRUN_SEC = 4

/** Every Ads on Trial overlay of a video. */
export function AdOverlaysView({ video }: { video: VideoProps }): React.JSX.Element | null {
  loadFonts()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ads = (video.overlays as { ads?: AdOverlays } | undefined)?.ads
  if (!ads) return null
  const t = frame / fps
  // Burned-in captions own the bottom of the frame: cards that would sit there move up.
  const captioned = (at: number): boolean =>
    video.captions || at < (video.openingCaptionsSec ?? 0) + CAPTION_OVERRUN_SEC
  return (
    <>
      {ads.paperTrail && t >= ads.paperTrail.at - 0.1 && t < ads.paperTrail.at + 5 && (
        <SourceCard card={ads.paperTrail} top={captioned(ads.paperTrail.at + 5)} />
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
                ...(captioned(c.at + 3.2) ? { top: 60 } : { bottom: 70 }),
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
        <IngredientLabel label={ads.ingredients} top={captioned(ads.ingredients.until)} />
      )}
      {ads.verdict && t >= ads.verdict.at && <VerdictCard v={ads.verdict} />}
    </>
  )
}
