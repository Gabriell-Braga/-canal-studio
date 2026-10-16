import React from 'react'
import { AbsoluteFill } from 'remotion'
import type { CardProps } from '../../shared/render'
import { B, F, loadFonts, Paper } from './vintage-ads'

/** A still rubber stamp (the animated one needs the video clock). */
function Stamp({ text, size = 110 }: { text: string; size?: number }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'inline-block',
        transform: 'rotate(-8deg)',
        border: `${size * 0.07}px solid ${B.stamp}`,
        borderRadius: size * 0.08,
        padding: `${size * 0.04}px ${size * 0.2}px`,
        fontFamily: F.stamp,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.05,
        letterSpacing: size * 0.04,
        color: B.stamp,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap'
      }}
    >
      {text}
    </div>
  )
}

/** Big text that shrinks with its length, so a long quote still fits the frame. */
const sizeFor = (text: string, big: number): number =>
  Math.round(Math.max(52, Math.min(big, big * Math.sqrt(60 / Math.max(60, text.length)))))

function Timeline({ years, current }: { years: number[]; current?: number }): React.JSX.Element {
  const min = years[0]
  const max = years[years.length - 1]
  const at = (y: number): number => (max === min ? 50 : 6 + (88 * (y - min)) / (max - min))
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 470, height: 260 }}>
      <div
        style={{
          position: 'absolute',
          left: '5%',
          right: '5%',
          top: 60,
          height: 8,
          background: B.ink
        }}
      />
      {years.map((y) => {
        const on = y === current
        // A year too close to the red one would print over it: its dot stays, its label goes.
        const crowded = !on && current !== undefined && Math.abs(at(y) - at(current)) < 9
        return (
          <div
            key={y}
            style={{
              position: 'absolute',
              left: `${at(y)}%`,
              top: 0,
              transform: 'translateX(-50%)',
              textAlign: 'center'
            }}
          >
            <div
              style={{
                width: on ? 56 : 32,
                height: on ? 56 : 32,
                margin: `${on ? 36 : 48}px auto 0`,
                borderRadius: '50%',
                background: on ? B.stamp : B.ink
              }}
            />
            <div
              style={{
                marginTop: 18,
                fontFamily: F.title,
                fontSize: on ? 92 : 54,
                color: on ? B.stamp : B.ink,
                visibility: crowded ? 'hidden' : 'visible'
              }}
            >
              {y}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Ads on Trial data card: paper, ink and one red accent, edge to edge. */
export const VintageCard: React.FC<CardProps> = ({ kind, text, sub, years, current, stamp }) => {
  loadFonts()
  // Quote marks only on words someone printed (the ad, a claim), not on narration lines.
  const quote = kind === 'claim' || (kind === 'quote' && !!sub)
  return (
    <AbsoluteFill>
      <Paper>
        {kind === 'timeline' && years?.length ? (
          <>
            <div
              style={{
                position: 'absolute',
                top: 150,
                left: 120,
                right: 120,
                textAlign: 'center',
                fontFamily: F.card,
                fontWeight: 700,
                fontSize: sizeFor(text, 84),
                color: B.ink,
                lineHeight: 1.15
              }}
            >
              {text}
            </div>
            <Timeline years={years} current={current} />
          </>
        ) : (
          <AbsoluteFill
            style={{
              padding: '120px 170px',
              justifyContent: 'center',
              alignItems: 'center',
              textAlign: 'center',
              gap: 50
            }}
          >
            <div
              style={{
                fontFamily: kind === 'price' ? F.title : F.card,
                fontWeight: kind === 'price' ? 400 : 700,
                fontSize: sizeFor(text, kind === 'price' ? 150 : 104),
                lineHeight: 1.12,
                color: B.ink
              }}
            >
              {quote ? `“${text}”` : text}
            </div>
            {sub ? (
              <div
                style={{
                  fontFamily: kind === 'price' ? F.stamp : F.type,
                  fontWeight: kind === 'price' ? 700 : 400,
                  fontSize: kind === 'price' ? 96 : 46,
                  color: kind === 'price' ? B.stamp : B.ink,
                  opacity: kind === 'price' ? 1 : 0.8
                }}
              >
                {sub}
              </div>
            ) : null}
            {stamp ? <Stamp text={stamp} /> : null}
          </AbsoluteFill>
        )}
      </Paper>
    </AbsoluteFill>
  )
}
