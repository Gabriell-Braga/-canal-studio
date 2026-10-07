import React from 'react'
import { AbsoluteFill, Img } from 'remotion'
import type { ThumbnailProps } from '../shared/render'
import { brandTextShadow, template } from './templates'

/** 1280x720 thumbnail: background + 2–4 word headline (3 layout variants), or the no-text highlight style. */
export const Thumbnail: React.FC<ThumbnailProps> = ({
  background,
  text,
  template: id,
  brand,
  variant,
  cutout
}) => {
  const style = template(id)
  const colors: [string, string] = brand ? [brand.secondary, brand.primary] : style.thumbColors
  if (cutout) return <Highlight background={background} cutout={cutout} color={colors[1]} />
  const font = brand?.font ? `"${brand.font}", ${style.thumbFont}` : style.thumbFont
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  // Highlight the last word in the accent color.
  const head = words.slice(0, -1).join(' ')
  const tail = words.at(-1) ?? ''
  const layouts = [
    {
      justifyContent: 'flex-end',
      alignItems: 'flex-start',
      padding: '0 0 60px 70px',
      textAlign: 'left'
    },
    { justifyContent: 'center', alignItems: 'flex-end', padding: '0 70px 0 0', textAlign: 'right' },
    {
      justifyContent: 'flex-start',
      alignItems: 'center',
      padding: '50px 0 0 0',
      textAlign: 'center'
    }
  ] as const
  const layout = layouts[variant % layouts.length]
  const overlays = [
    'linear-gradient(90deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.1) 65%)',
    'linear-gradient(270deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.1) 65%)',
    'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.05) 60%)'
  ]
  const stroke = brandTextShadow(brand?.outline ?? true, 5)
  return (
    <AbsoluteFill style={{ backgroundColor: '#111' }}>
      <Img
        src={background}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'contrast(1.15) saturate(1.2)'
        }}
      />
      <AbsoluteFill style={{ background: overlays[variant % overlays.length] }} />
      <AbsoluteFill style={{ ...layout, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            maxWidth: 760,
            fontFamily: font,
            fontWeight: 900,
            fontSize: words.length > 3 ? 104 : 128,
            lineHeight: 0.95,
            letterSpacing: -1,
            textShadow: stroke,
            textAlign: layout.textAlign
          }}
        >
          {head && <div style={{ color: colors[0] }}>{head}</div>}
          <div style={{ color: colors[1] }}>{tail}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/** No text: the whole frame in black and white, only the cut-out subject in the channel color, with a glow. */
const Highlight: React.FC<{ background: string; cutout: string; color: string }> = ({
  background,
  cutout,
  color
}) => {
  const fill = { width: '100%', height: '100%', objectFit: 'cover' } as const
  const mask = {
    WebkitMaskImage: `url("${cutout}")`,
    WebkitMaskSize: 'cover',
    WebkitMaskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat'
  } as const
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Img
        src={background}
        style={{ ...fill, filter: 'grayscale(1) contrast(1.25) brightness(0.6)' }}
      />
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.65) 100%)'
        }}
      />
      <AbsoluteFill>
        <Img
          src={cutout}
          style={{
            ...fill,
            filter: `grayscale(1) contrast(1.2) brightness(1.1) drop-shadow(0 0 14px ${color}) drop-shadow(0 0 48px ${color})`
          }}
        />
      </AbsoluteFill>
      {/* Tint the subject: "color" keeps its light and shade and takes the hue from the channel. */}
      <AbsoluteFill style={{ ...mask, backgroundColor: color, mixBlendMode: 'color' }} />
      <AbsoluteFill
        style={{ ...mask, backgroundColor: color, mixBlendMode: 'soft-light', opacity: 0.5 }}
      />
    </AbsoluteFill>
  )
}
