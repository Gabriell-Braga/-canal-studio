/**
 * Ads on Trial visuals beyond plain pictures: data animations, the evidence board, parallax
 * and detail shots. A scene's shot is either a picture file or a small JSON "shot file"
 * (scenes/shot_<hash>.json, see ShotFile) that the render turns into one of these.
 */
import type { Box } from './render'

/** What the script suggests a scene shows (vintage-ads `visual` field). */
export const SCENE_VISUALS = [
  'scan',
  'photo',
  'detail',
  'evidence',
  'map',
  'timeline',
  'tree',
  'label',
  'letter',
  'illustration',
  'quote'
] as const
export type SceneVisual = (typeof SCENE_VISUALS)[number]

/** Newspapers or towns lighting up on a period map of the United States. */
export interface MapSpec {
  kind: 'map'
  title: string
  /** Map pixels (MAP_SIZE), from projectUs */
  points: { label: string; x: number; y: number; year?: number }[]
}

/** Key dates on a line, each with its picture when the bank has one. */
export interface TimelineSpec {
  kind: 'timeline'
  events: { year: number; label: string; src?: string }[]
  /** Year the scene is about, drawn in red */
  current?: number
}

/** Who was who: parents, children, who died when and who took over. */
export interface TreeSpec {
  kind: 'tree'
  people: {
    id: string
    name: string
    born?: number
    died?: number
    /** "founder", "took over 1883"… */
    role?: string
    /** id of the parent (or spouse for the second founder) */
    parent?: string
  }[]
  /** id drawn in red */
  highlight?: string
}

/** The product label assembling itself: ingredients one by one, the stamp last. */
export interface LabelSpec {
  kind: 'label'
  product: string
  ingredients: string[]
  /** Red stamp at the end, e.g. "18–20% ALCOHOL" */
  stamp: string
}

/** A letter written by hand on screen, then the signed reply. */
export interface LetterSpec {
  kind: 'letter'
  lines: string[]
  signature: string
  date?: string
}

/** Price then → today, with an optional bar chart (sales by year). */
export interface CounterSpec {
  kind: 'counter'
  then: string
  today: string
  year: number
  bars?: { label: string; value: number }[]
  unit?: string
}

/** Real clippings pinned on a cork board with red string, the camera moving between them. */
export interface EvidenceSpec {
  kind: 'evidence'
  items: { src: string; caption?: string }[]
}

export type VisualSpec =
  MapSpec | TimelineSpec | TreeSpec | LabelSpec | LetterSpec | CounterSpec | EvidenceSpec

export type VisualKind = VisualSpec['kind']

/** Contents of a scenes/shot_<hash>.json file. Paths are absolute until the render maps them. */
export type ShotFile =
  /** A data animation or the evidence board, `sec` seconds long (always its scene's first shot) */
  | { shot: 'visual'; spec: VisualSpec; sec: number }
  /** 2.5D camera move: the picture and its depth map (white = near) */
  | { shot: 'parallax'; src: string; depth: string }
  /** A region of a high-resolution picture (0–1 boxes): a face, a hand, a label, a headline */
  | { shot: 'detail'; src: string; crop: Box }

/** How a shot counts in the review's split of the video's time. */
export type ShotCategory = 'real' | 'animation' | 'ai' | 'card'

/** Map canvas of MapSpec points, px. */
export const MAP_SIZE = { width: 975, height: 610 }

const rad = Math.PI / 180
const P1 = 29.5 * rad
const P2 = 45.5 * rad
const N = (Math.sin(P1) + Math.sin(P2)) / 2
const C = Math.cos(P1) ** 2 + 2 * N * Math.sin(P1)
function raw(lon: number, lat: number): [number, number] {
  const rho = Math.sqrt(C - 2 * N * Math.sin(lat * rad)) / N
  const theta = N * (lon + 96) * rad
  return [rho * Math.sin(theta), -rho * Math.cos(theta)]
}
const CENTER = raw(-96.6, 38.7)

/**
 * Albers equal-area conic of the lower 48 states (parallels 29.5° and 45.5°), into MAP_SIZE
 * pixels. The state outlines (remotion/public/maps/us-states.json) use the same function.
 */
export function projectUs(lon: number, lat: number): { x: number; y: number } {
  const [x, y] = raw(lon, lat)
  const k = 1300
  return { x: 487.5 + k * (x - CENTER[0]), y: 305 - k * (y - CENTER[1]) }
}
