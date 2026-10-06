import type { CSSProperties } from 'react'
import type { TemplateId } from '../shared/render'

export interface TemplateStyle {
  fontFamily: string
  uppercase: boolean
  captionBottom: number | null // px from bottom; null = vertically centered-low
  captionSize: number
  textColor: string
  highlight: CSSProperties
  box: CSSProperties | null
  stroke: string | null
  vignette: number
  grade: string // CSS filter on the footage
  thumbFont: string
  thumbColors: [string, string]
}

// System fonts only: renders run at night, possibly offline.
export const TEMPLATES: Record<TemplateId, TemplateStyle> = {
  documentary: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    uppercase: false,
    captionBottom: 90,
    captionSize: 54,
    textColor: '#f4f1ea',
    highlight: { color: '#ffd166' },
    box: { background: 'rgba(0,0,0,0.55)', padding: '14px 28px', borderRadius: 10 },
    stroke: null,
    vignette: 0.55,
    grade: 'contrast(1.05) saturate(0.9) sepia(0.12)',
    thumbFont: 'Georgia, serif',
    thumbColors: ['#ffffff', '#ffd166']
  },
  bold: {
    fontFamily: '"Arial Black", Impact, "Segoe UI Black", sans-serif',
    uppercase: true,
    captionBottom: null,
    captionSize: 68,
    textColor: '#ffffff',
    highlight: { color: '#3cf281', transform: 'scale(1.08)' },
    box: null,
    stroke: '#000000',
    vignette: 0.35,
    grade: 'contrast(1.12) saturate(1.15)',
    thumbFont: 'Impact, "Arial Black", sans-serif',
    thumbColors: ['#ffffff', '#ffe600']
  },
  minimal: {
    fontFamily: '"Segoe UI", Helvetica, Arial, sans-serif',
    uppercase: false,
    captionBottom: 110,
    captionSize: 50,
    textColor: '#ffffff',
    highlight: { color: '#7dd3fc', textDecoration: 'underline', textUnderlineOffset: 8 },
    box: null,
    stroke: null,
    vignette: 0.25,
    grade: 'contrast(1.02) saturate(0.95)',
    thumbFont: '"Segoe UI Black", "Segoe UI", sans-serif',
    thumbColors: ['#ffffff', '#7dd3fc']
  }
}

export function template(id: string | undefined): TemplateStyle {
  return TEMPLATES[(id as TemplateId) ?? 'documentary'] ?? TEMPLATES.documentary
}
