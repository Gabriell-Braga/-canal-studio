import React from 'react'
import { AbsoluteFill, Img } from 'remotion'
import type { ThumbnailProps } from '../shared/render'
import { template } from './templates'

/** 1280x720 thumbnail: background + 2–4 word headline with heavy outline. 3 layout variants. */
export const Thumbnail: React.FC<ThumbnailProps> = ({
  background,
  text,
  template: id,
  variant
}) => {
  const style = template(id)
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
  const stroke =
    '0 0 4px #000, 5px 5px 0 #000, -5px -5px 0 #000, 5px -5px 0 #000, -5px 5px 0 #000, 0 8px 24px rgba(0,0,0,0.9)'
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
            fontFamily: style.thumbFont,
            fontWeight: 900,
            fontSize: words.length > 3 ? 104 : 128,
            lineHeight: 0.95,
            letterSpacing: -1,
            textShadow: stroke,
            textAlign: layout.textAlign
          }}
        >
          {head && <div style={{ color: style.thumbColors[0] }}>{head}</div>}
          <div style={{ color: style.thumbColors[1] }}>{tail}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
