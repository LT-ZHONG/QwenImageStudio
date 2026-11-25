import type { GenerationCreate, ModelsInfo } from '@/lib/api'

export function validateDraft(d: GenerationCreate, models: ModelsInfo | undefined): string | null {
  if (!d.upload_id) return '请先上传一张输入图片'
  if (!d.prompt.trim()) return '请输入提示词'
  if (!models) return '正在加载参数配置，请稍后再试'
  const p = models.params
  const check = (name: string, v: number, spec: { min?: number; max?: number }) =>
    !Number.isFinite(v) || (spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)
      ? `${name} 需在 ${spec.min}–${spec.max} 之间`
      : null
  return (
    check('Steps', d.steps, p.steps) ||
    check('CFG', d.cfg, p.cfg) ||
    check('Denoise', d.denoise, p.denoise) ||
    check('Resolution', d.resolution, p.resolution) ||
    (d.resolution % (p.resolution.step ?? 1) ? `Resolution 必须是 ${p.resolution.step} 的倍数` : null) ||
    (d.seed !== null && (!Number.isInteger(d.seed) || d.seed < 0 || d.seed > (p.seed.max ?? Infinity))
      ? 'Seed 必须是有效的非负整数'
      : null)
  )
}
