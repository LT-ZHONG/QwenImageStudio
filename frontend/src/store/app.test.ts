import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Generation } from '@/lib/api'

beforeAll(() => {
  const mem = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})

const task = {
  prompt: 'p',
  negative_prompt: 'n',
  generation_params: { seed: 77, steps: 30, cfg: 2, denoise: 0.8, resolution: 768, seed_mode: 'random' },
} as Generation

describe('app store', () => {
  it('reuseParams copies prompt and settings; keeps the seed only when asked', async () => {
    const { useApp } = await import('./app')
    useApp.getState().reuseParams(task)
    let s = useApp.getState()
    expect([s.prompt, s.negativePrompt, s.steps, s.cfg, s.denoise, s.resolution]).toEqual(['p', 'n', 30, 2, 0.8, 768])
    expect(s.seedMode).toBe('random')

    useApp.getState().reuseParams(task, { keepSeed: true })
    s = useApp.getState()
    expect([s.seedMode, s.seed]).toEqual(['fixed', 77])
  })

  it('applyDefaults marks defaults as applied', async () => {
    const { useApp } = await import('./app')
    useApp.getState().applyDefaults({ steps: 20, cfg: 1.5, denoise: 0.9, resolution: 1280, seed_mode: 'fixed' })
    const s = useApp.getState()
    expect([s.steps, s.cfg, s.denoise, s.resolution, s.seedMode, s.defaultsApplied]).toEqual([20, 1.5, 0.9, 1280, 'fixed', true])
  })
})
