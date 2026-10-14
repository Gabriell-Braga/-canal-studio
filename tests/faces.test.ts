import { describe, expect, it } from 'vitest'
import {
  acceptFace,
  expressionWorkflow,
  identityOk,
  PRESETS,
  type FaceBox,
  type FaceInfo
} from '../electron/services/faces'

const face = (over: Partial<FaceBox> = {}): FaceBox => ({
  box: [100, 100, 380, 500],
  height: 500,
  yaw: 10,
  blur: 120,
  ...over
})
const info = (...faces: FaceBox[]): FaceInfo => ({ faces, width: 1200, height: 1600 })

describe('acceptFace', () => {
  it('accepts one big, frontal, sharp face', () => {
    expect(acceptFace(info(face()))?.height).toBe(500)
  })
  it('accepts a 3/4 view and small background faces', () => {
    expect(acceptFace(info(face({ yaw: -40 }), face({ height: 120 })))).not.toBeNull()
  })
  it('rejects no face, small, profile, blurry and two dominant faces', () => {
    expect(acceptFace(info())).toBeNull()
    expect(acceptFace(info(face({ height: 399 })))).toBeNull()
    expect(acceptFace(info(face({ yaw: 60 })))).toBeNull()
    expect(acceptFace(info(face({ blur: 5 })))).toBeNull()
    expect(acceptFace(info(face(), face({ height: 300 })))).toBeNull()
  })
})

describe('identity', () => {
  it('needs cosine >= 0.6', () => {
    expect(identityOk(0.6)).toBe(true)
    expect(identityOk(0.59)).toBe(false)
  })
})

describe('expression presets', () => {
  // Ranges from ExpressionEditor.INPUT_TYPES in ComfyUI-AdvancedLivePortrait/nodes.py.
  const ranges: Record<string, [number, number]> = {
    rotate_pitch: [-20, 20],
    rotate_yaw: [-20, 20],
    rotate_roll: [-20, 20],
    blink: [-20, 5],
    eyebrow: [-10, 15],
    wink: [0, 25],
    pupil_x: [-15, 15],
    pupil_y: [-15, 15],
    aaa: [-30, 120],
    eee: [-20, 15],
    woo: [-20, 15],
    smile: [-0.3, 1.3]
  }
  it('stay inside the node ranges and well below the extremes', () => {
    for (const [name, params] of Object.entries(PRESETS)) {
      expect(Object.keys(params).sort(), name).toEqual(Object.keys(ranges).sort())
      for (const [k, v] of Object.entries(params)) {
        const [min, max] = ranges[k]
        expect(v, `${name}.${k}`).toBeGreaterThanOrEqual(min * 0.7)
        expect(v, `${name}.${k}`).toBeLessThanOrEqual(max * 0.8)
      }
    }
  })
  it('workflow loads the photo, edits it and saves node 3', () => {
    const wf = expressionWorkflow('x.png', 'shock') as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    expect(wf['2'].class_type).toBe('ExpressionEditor')
    expect(wf['2'].inputs.aaa).toBe(PRESETS.shock.aaa)
    expect(wf['3'].class_type).toBe('SaveImage')
    expect(Object.values(wf).map((n) => n.class_type)).not.toContain('KSampler')
  })
})
