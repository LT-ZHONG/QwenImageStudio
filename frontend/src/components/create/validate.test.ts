import { describe, expect, it } from 'vitest'
import type { GenerationCreate, ModelsInfo } from '@/lib/api'
import { validateDraft } from './validate'

const models: ModelsInfo = {
  model: 'qwen-image-2.1',
  files: {},
  params: {
    resolution: { default: 1024, min: 512, max: 2048, step: 64 },
    steps: { default: 25, min: 1, max: 50 },
    cfg: { default: 1, min: 1, max: 5 },
    denoise: { default: 1, min: 0.1, max: 1 },
    seed: { min: 0, max: 9007199254740991 },
  },
}
const ok: GenerationCreate = {
  upload_id: 'u1',
  prompt: '移除人物',
  negative_prompt: '',
  seed: null,
  steps: 25,
  cfg: 1,
  denoise: 1,
  resolution: 1024,
}

describe('validateDraft', () => {
  it('accepts a valid draft', () => expect(validateDraft(ok, models)).toBeNull())
  it('requires an input image first', () => expect(validateDraft({ ...ok, upload_id: '' }, models)).toContain('上传'))
  it('requires a non-blank prompt', () => expect(validateDraft({ ...ok, prompt: '   ' }, models)).toContain('提示词'))
  it('waits for the backend parameter limits', () => expect(validateDraft(ok, undefined)).toContain('加载'))
  it.each([
    ['steps', { steps: 51 }],
    ['steps', { steps: 0 }],
    ['cfg', { cfg: 9 }],
    ['denoise', { denoise: 0 }],
    ['resolution', { resolution: 4096 }],
    ['resolution', { resolution: 1000 }], // in range but not a multiple of 64
    ['seed', { seed: -1 }],
    ['seed', { seed: 1.5 }],
  ])('rejects out-of-range %s', (_n, patch) => expect(validateDraft({ ...ok, ...patch }, models)).not.toBeNull())
  it('accepts a fixed seed', () => expect(validateDraft({ ...ok, seed: 42 }, models)).toBeNull())
})
