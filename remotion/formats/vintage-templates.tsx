import React, { useEffect, useLayoutEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Img } from 'remotion'
import {
  fitAtLeast,
  fitText,
  lineSplits,
  templateZones,
  TPL,
  type FitOptions,
  type FitResult,
  type MeasuredText,
  type PxBox,
  type TemplateDraw,
  type TemplatePiece
} from '../../shared/thumb'
import { B, F, fontsReady, Paper, StampInk } from './vintage-ads'

/**
 * Ads on Trial template thumbnails (T1 portrait + shock, T2 object + secret, T3 split
 * mystery). Zones come from templateZones; every text is fitted with the real font in the
 * browser and measured after layout (cap height and box), logged for the step's checks.
 */

const TITLE_FONT = { family: F.stamp, weight: 700 }
const HAND_FONT = { family: F.hand, weight: 400 }
const CARVED_FONT = { family: F.card, weight: 700 }

let canvas: CanvasRenderingContext2D | null = null
function ctx2d(): CanvasRenderingContext2D {
  canvas ??= document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  return canvas
}

function metrics(
  font: { family: string; weight: number },
  spacing = 0
): Pick<FitOptions, 'capRatio' | 'width'> {
  const c = ctx2d()
  c.font = `${font.weight} 100px ${font.family}`
  const capRatio = c.measureText('H').actualBoundingBoxAscent / 100
  return {
    capRatio,
    width: (line: string, size: number): number => {
      c.font = `${font.weight} ${size}px ${font.family}`
      return c.measureText(line).width + spacing * size * line.length
    }
  }
}

/** White outline (dilated alpha) for cut-out pictures. */
function OutlineFilter(): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <filter id="cut-outline" x="-10%" y="-10%" width="120%" height="120%">
        <feMorphology in="SourceAlpha" operator="dilate" radius={TPL.outline} result="grown" />
        <feFlood floodColor="#FFFFFF" />
        <feComposite in2="grown" operator="in" result="ring" />
        <feMerge>
          <feMergeNode in="ring" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </svg>
  )
}

const CUT_FILTER = 'url(#cut-outline) drop-shadow(0 14px 22px rgba(0,0,0,0.55))'

/** A picture placed by its own box (cutouts get the white outline and a soft shadow). */
function Picture({
  p,
  box,
  rotate = 0,
  cover = false
}: {
  p: TemplatePiece
  box: PxBox
  rotate?: number
  cover?: boolean
}): React.JSX.Element {
  return (
    <Img
      src={p.src as string}
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        objectFit: cover ? 'cover' : 'contain',
        objectPosition: cover ? '50% 20%' : '50% 0%',
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        filter: p.cutout ? CUT_FILTER : 'contrast(1.1)',
        boxShadow: p.cutout || cover ? undefined : '0 18px 40px rgba(0,0,0,0.6)',
        border: p.cutout || cover ? undefined : '10px solid #FFFFFF'
      }}
    />
  )
}

/** Lines of fitted text; each line is measured as `role`. */
function Lines({
  fit,
  role,
  font,
  color,
  stroke,
  strokeColor,
  align,
  accent = '',
  spacing = 0
}: {
  fit: FitResult
  role: MeasuredText['role']
  font: { family: string; weight: number }
  color: string
  stroke: number
  strokeColor: string
  align: 'left' | 'center'
  accent?: string
  spacing?: number
}): React.JSX.Element {
  const a = accent.toUpperCase().replace(/[^A-Z0-9$%]/g, '')
  return (
    <>
      {fit.lines.map((line, i) => (
        <div key={i} style={{ textAlign: align, height: fit.size * TPL.lineHeight }}>
          <span
            data-m={role}
            style={{
              display: 'inline-block',
              fontFamily: font.family,
              fontWeight: font.weight,
              fontSize: fit.size,
              lineHeight: TPL.lineHeight,
              letterSpacing: spacing * fit.size,
              whiteSpace: 'nowrap',
              color,
              WebkitTextStroke: stroke ? `${stroke * 2}px ${strokeColor}` : undefined,
              paintOrder: 'stroke fill'
            }}
          >
            {line.split(' ').map((w, k) => {
              const hot = a && w.toUpperCase().replace(/[^A-Z0-9$%]/g, '') === a
              return (
                <span
                  key={k}
                  style={
                    hot
                      ? { color: TPL.red, WebkitTextStroke: `${TPL.accentStroke * 2}px #FFFFFF` }
                      : undefined
                  }
                >
                  {k ? ' ' : ''}
                  {w}
                </span>
              )
            })}
          </span>
        </div>
      ))}
    </>
  )
}

function Title({ draw, light }: { draw: TemplateDraw; light: boolean }): React.JSX.Element | null {
  const z = templateZones(draw.template).title
  const m = metrics(TITLE_FONT)
  const text = draw.title.toUpperCase().split(/\s+/).slice(0, TPL.maxTitleWords).join(' ')
  // The outline grows outside the glyphs: keep it inside the zone too.
  const pad = TPL.titleStroke
  const box = { w: z.w - 2 * pad, h: z.h }
  const opts = { maxLines: z.maxLines, maxCap: TPL.maxCap, column: z.column, ...m }
  let fit = fitText(text, box, opts)
  // Never under the minimum: one more line rather than smaller letters.
  if (fit && fit.cap < TPL.minCap.title && z.fallbackLines)
    fit = fitText(text, box, { ...opts, maxLines: z.fallbackLines }) ?? fit
  if (!fit) return null
  const height = fit.lines.length * fit.size * TPL.lineHeight
  return (
    <div
      style={{
        position: 'absolute',
        left: z.x + pad,
        width: z.w - 2 * pad,
        // Vertically centered in its zone.
        top: z.y + (z.h - height) / 2
      }}
    >
      <Lines
        fit={fit}
        role="title"
        font={TITLE_FONT}
        color={light ? B.ink : '#FFFFFF'}
        stroke={TPL.titleStroke}
        strokeColor={light ? '#FFFFFF' : '#000000'}
        align={z.align}
        accent={draw.accentWord}
      />
    </div>
  )
}

/** A red rubber stamp as wide as the zone allows, at least 80 px cap height. */
function Stamp({ draw }: { draw: TemplateDraw }): React.JSX.Element | null {
  const z = templateZones(draw.template).stamp
  if (!z || !draw.stamp.trim()) return null
  const m = metrics(TITLE_FONT, 0.04)
  const words = draw.stamp.toUpperCase().trim().split(/\s+/)
  // Box width = longest line + padding (0.22 em each side) + border (0.07 em each side).
  const sizeIn = (lines: string[], w: number): number =>
    w / (Math.max(...lines.map((l) => m.width(l, 100))) / 100 + 0.58)
  const minSize = TPL.minCap.stamp / m.capRatio
  // One line as wide as the zone allows; two lines when one would pass the widest stamp.
  // As wide as the narrowest stamp, grown toward the widest until the caps reach 80 px.
  const sizeOf = (l: string[]): number =>
    Math.max(sizeIn(l, z.minW), Math.min(minSize, sizeIn(l, z.maxW)))
  // One line, or two when one would have to pass the widest stamp.
  const options = [[words.join(' ')], ...lineSplits(words, 2).filter((l) => l.length === 2)]
  const lines =
    options.find((l) => sizeOf(l) >= minSize - 0.01) ??
    options.reduce((a, b) => (sizeOf(b) > sizeOf(a) ? b : a))
  const size = sizeOf(lines)
  return (
    <div
      style={{
        position: 'absolute',
        left: z.cx,
        top: z.cy,
        transform: `translate(-50%, -50%) rotate(${z.rotate}deg)`
      }}
    >
      <StampInk id="tpl-stamp-ink" />
      <div
        style={{
          filter: 'url(#tpl-stamp-ink) drop-shadow(0 6px 10px rgba(0,0,0,0.45))',
          border: `${size * 0.07}px solid ${B.stamp}`,
          borderRadius: size * 0.08,
          padding: `${size * 0.04}px ${size * 0.22}px`,
          background: 'rgba(255,255,255,0.08)'
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <span
              data-m="stamp"
              style={{
                display: 'inline-block',
                fontFamily: TITLE_FONT.family,
                fontWeight: 700,
                fontSize: size,
                lineHeight: 1.05,
                letterSpacing: size * 0.04,
                color: B.stamp,
                whiteSpace: 'nowrap'
              }}
            >
              {line}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A big handwritten letter on old paper: at most 2 short lines, at least 56 px caps. */
function Letter({
  words,
  box,
  rotate
}: {
  words: string
  box: PxBox
  rotate: number
}): React.JSX.Element {
  const m = metrics(HAND_FONT)
  const lines = words
    .split(/\s*\/\s*/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
  const inner = { w: box.w * 0.97, h: box.h * 0.26 }
  const fits = lines
    .map((l) => fitAtLeast(l, inner, TPL.minCap.letter, { maxLines: 1, maxCap: 90, ...m }))
    .filter((f): f is FitResult => !!f)
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        transform: `rotate(${rotate}deg)`,
        boxShadow: '0 24px 50px rgba(0,0,0,0.7)',
        overflow: 'hidden'
      }}
    >
      <Paper>
        <div
          style={{
            position: 'absolute',
            left: '1.5%',
            right: '1.5%',
            top: '30%',
            display: 'flex',
            flexDirection: 'column',
            gap: box.h * 0.08
          }}
        >
          {fits.map((f, i) => (
            <Lines
              key={i}
              fit={f}
              role="letter"
              font={HAND_FONT}
              color="#1E2A4A"
              stroke={0}
              strokeColor=""
              align={i ? 'left' : 'left'}
            />
          ))}
        </div>
      </Paper>
    </div>
  )
}

/** A gravestone filling the box: textured stone, carved inscription (48 px caps or more). */
function Tombstone({ words, box }: { words: string; box: PxBox }): React.JSX.Element {
  const m = metrics(CARVED_FONT, 0.02)
  const stone = {
    x: box.x + box.w * 0.08,
    y: box.y + box.h * 0.12,
    w: box.w * 0.84,
    h: box.h * 0.95
  }
  const lines = words
    .toUpperCase()
    .split(/\s*\/\s*/)
    .map((l) => l.trim())
    .filter(Boolean)
  const inner = { w: stone.w * 0.78, h: (stone.h * 0.5) / Math.max(1, lines.length) }
  const fits = lines
    .map((l) => fitAtLeast(l, inner, TPL.minCap.other, { maxLines: 2, maxCap: 120, ...m }))
    .filter((f): f is FitResult => !!f)
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at 50% 35%, #3B4250 0%, #161A22 70%, #0C0E12 100%)'
        }}
      />
      <svg
        viewBox="0 0 100 140"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          left: stone.x - box.x,
          top: stone.y - box.y,
          width: stone.w,
          height: stone.h,
          filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.7))'
        }}
      >
        <defs>
          <linearGradient id="tpl-stone" x1="0" x2="1">
            <stop offset="0" stopColor="#B4AFA4" />
            <stop offset="1" stopColor="#6E695F" />
          </linearGradient>
          <filter id="tpl-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={3} seed={3} />
            <feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.09  0 0 0 0 0.08  0 0 0 0.55 0" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
        </defs>
        <path d="M2 140 V40 Q2 2 50 2 Q98 2 98 40 V140 Z" fill="url(#tpl-stone)" />
        <path d="M2 140 V40 Q2 2 50 2 Q98 2 98 40 V140 Z" fill="#000" filter="url(#tpl-grain)" />
        <path
          d="M2 140 V40 Q2 2 50 2 Q98 2 98 40 V140 Z"
          fill="none"
          stroke="#2A2620"
          strokeWidth="1.4"
        />
        <path
          d="M14 140 V44 Q14 14 50 14 Q86 14 86 44 V140"
          fill="none"
          stroke="#5B564D"
          strokeWidth="0.8"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: stone.x - box.x,
          width: stone.w,
          top: stone.y - box.y + stone.h * 0.3,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12
        }}
      >
        {fits.map((f, i) => (
          <div key={i} style={{ width: '100%' }}>
            <Lines
              fit={f}
              role="other"
              font={CARVED_FONT}
              color="#2A261F"
              stroke={0}
              strokeColor=""
              align="center"
              spacing={0.02}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A drawn part in its box (letter or tombstone); pictures go through Picture. */
function Drawn({
  p,
  box,
  rotate = 0
}: {
  p: TemplatePiece
  box: PxBox
  rotate?: number
}): React.JSX.Element | null {
  if (p.kind === 'letter') return <Letter words={p.words} box={box} rotate={rotate} />
  if (p.kind === 'tombstone') return <Tombstone words={p.words} box={box} />
  return null
}

/** T1: the bust 110% tall, right edge at 52% of the frame (bleeds left when wide). */
function subjectBox(p: TemplatePiece, zone: PxBox): PxBox {
  const h = zone.h
  const w = h * p.aspect
  const x = w < zone.w ? (zone.w - w) / 2 : zone.x + zone.w - w
  return { x, y: zone.y, w, h }
}

/** T2: the object 98% tall, centered at 48% (at most 56% of the width). */
function objectBox(p: TemplatePiece, zone: PxBox): PxBox {
  let h = zone.h
  let w = h * p.aspect
  const maxW = TPL.width * 0.56
  if (w > maxW) {
    w = maxW
    h = w / p.aspect
  }
  const cx = zone.x + zone.w / 2
  return { x: cx - w / 2, y: zone.y + (zone.h - h) / 2, w, h }
}

function useMeasured(ready: boolean): void {
  const [handle] = useState(() => delayRender('template thumbnail fit'))
  useLayoutEffect(() => {
    if (!ready) return
    const out: MeasuredText[] = []
    document.querySelectorAll<HTMLElement>('[data-m]').forEach((el) => {
      const cs = getComputedStyle(el)
      const c = ctx2d()
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const r = el.getBoundingClientRect()
      out.push({
        role: el.dataset.m as MeasuredText['role'],
        text: el.textContent ?? '',
        cap: c.measureText('H').actualBoundingBoxAscent,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height }
      })
    })
    console.log(`THUMB_MEASURE ${JSON.stringify(out)}`)
    continueRender(handle)
  }, [ready, handle])
}

export function TemplateThumb({ draw }: { draw: TemplateDraw }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void fontsReady().then(() => setReady(true))
  }, [])
  useMeasured(ready)
  const layers = draw.layers ?? 'all'
  const showMain = layers !== 'bare'
  const showRest = layers === 'all' || layers === 'notitle'
  const showTitle = layers === 'all'
  const z = templateZones(draw.template)
  const light = draw.template === 'T2' && draw.background === 'light'
  const base = light ? '#E9DDC2' : draw.template === 'T3' ? '#0F0D0A' : '#17130E'
  if (!ready) return <AbsoluteFill style={{ backgroundColor: base }} />

  let body: React.ReactNode
  if (draw.template === 'T1') {
    const box = subjectBox(draw.main, z.main)
    body = (
      <>
        {showMain && draw.main.src && <Picture p={draw.main} box={box} />}
        {showRest && <Stamp draw={draw} />}
        {showTitle && <Title draw={draw} light={false} />}
      </>
    )
  } else if (draw.template === 'T2') {
    const box = objectBox(draw.main, z.main)
    body = (
      <>
        <div
          style={{
            position: 'absolute',
            left: box.x + box.w / 2 - 520,
            top: TPL.height / 2 - 420,
            width: 1040,
            height: 840,
            background: `radial-gradient(closest-side, ${light ? 'rgba(255,255,255,0.85)' : 'rgba(255,226,170,0.32)'}, transparent)`
          }}
        />
        {showMain && draw.main.src && <Picture p={draw.main} box={box} />}
        {showRest && <Stamp draw={draw} />}
        {showTitle && <Title draw={draw} light={light} />}
      </>
    )
  } else {
    const side = z.side as PxBox & { rotate: number }
    const band = z.band as PxBox
    body = (
      <>
        {showMain &&
          (draw.main.src ? (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: z.main.w,
                height: z.main.h,
                overflow: 'hidden'
              }}
            >
              <Picture p={{ ...draw.main, cutout: false }} box={{ ...z.main, x: 0, y: 0 }} cover />
            </div>
          ) : (
            <Drawn p={draw.main} box={z.main} />
          ))}
        {showRest &&
          draw.side &&
          (draw.side.src ? (
            <Picture p={draw.side} box={side} rotate={side.rotate} />
          ) : (
            <Drawn p={draw.side} box={side} rotate={side.rotate} />
          ))}
        {showRest && (
          <div
            style={{
              position: 'absolute',
              left: band.x,
              top: band.y,
              width: band.w,
              height: band.h,
              background: 'rgba(8,6,4,0.78)'
            }}
          />
        )}
        {showTitle && <Title draw={draw} light={false} />}
      </>
    )
  }
  return (
    <AbsoluteFill style={{ backgroundColor: base, overflow: 'hidden' }}>
      <OutlineFilter />
      {body}
    </AbsoluteFill>
  )
}
