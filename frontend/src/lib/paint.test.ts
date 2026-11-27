import { describe, expect, it } from 'vitest'
import { EXPORT_MAX_EDGE, fitSize, MARK_COLOR, MARK_OPACITY } from './paint'

describe('paint', () => {
  it('matches the ComfyUI paint pen (RGB 255,0,0 at ~60 %)', () => {
    expect(MARK_COLOR).toBe('#ff0000')
    expect(MARK_OPACITY).toBeCloseTo(0.6, 1)
  })
  it('never upscales and caps the long edge, keeping the aspect ratio', () => {
    expect(fitSize(960, 1280)).toEqual({ width: 960, height: 1280 })
    expect(fitSize(4096, 2048)).toEqual({ width: EXPORT_MAX_EDGE, height: 1024 })
    expect(fitSize(1000, 4000)).toEqual({ width: 512, height: EXPORT_MAX_EDGE })
  })
})

import { MARK_COLORS, maskAreaLabel } from './paint'

describe('mark colours', () => {
  it('offers distinct named presets, starting with the ComfyUI red', () => {
    expect(MARK_COLORS[0]).toEqual({ name: '红色', hex: '#ff0000' })
    expect(new Set(MARK_COLORS.map((c) => c.hex)).size).toBe(MARK_COLORS.length)
    expect(new Set(MARK_COLORS.map((c) => c.name)).size).toBe(MARK_COLORS.length)
  })
  it('words the mask area for the prompt', () => {
    expect(maskAreaLabel(['红色'])).toBe('红色遮罩区域')
    expect(maskAreaLabel(['红色', '蓝色'])).toBe('红色和蓝色遮罩区域')
  })
})
