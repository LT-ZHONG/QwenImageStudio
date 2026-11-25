import { ChevronDown, Dices, History } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { api, type ParamSpec } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

const RESOLUTION_PRESETS = [512, 768, 1024, 1280, 1536, 2048]

export function useModels() {
  return useQuery({ queryKey: ['models'], queryFn: api.models, staleTime: Infinity })
}

export function SeedControl({ disabled, lastSeed }: { disabled?: boolean; lastSeed?: number }) {
  const seedMode = useApp((s) => s.seedMode)
  const seed = useApp((s) => s.seed)
  const setDraft = useApp((s) => s.setDraft)
  const max = useModels().data?.params.seed.max ?? Number.MAX_SAFE_INTEGER

  return (
    <div className="space-y-2">
      <Label>Seed</Label>
      <div className="flex gap-2">
        <div className="inline-flex rounded-lg border p-0.5">
          {(['random', 'fixed'] as const).map((m) => (
            <button
              key={m}
              disabled={disabled}
              onClick={() => setDraft({ seedMode: m })}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition-colors',
                seedMode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'random' ? '随机' : '固定'}
            </button>
          ))}
        </div>
        {seedMode === 'fixed' && (
          <>
            <Input
              type="number"
              min={0}
              max={max}
              step={1}
              value={seed}
              disabled={disabled}
              onChange={(e) => setDraft({ seed: Math.trunc(Number(e.target.value)) })}
              className="min-w-0 flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              disabled={disabled}
              title="随机生成一个 Seed"
              onClick={() => setDraft({ seed: Math.floor(Math.random() * max) })}
            >
              <Dices />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={disabled || lastSeed === undefined}
              title="使用上一次任务的 Seed"
              onClick={() => lastSeed !== undefined && setDraft({ seed: lastSeed })}
            >
              <History />
            </Button>
          </>
        )}
      </div>
      {seedMode === 'random' && <p className="text-xs text-muted-foreground">提交时由后端生成实际 Seed，并记录在任务参数中。</p>}
    </div>
  )
}

function SliderRow({
  label,
  value,
  spec,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  spec: ParamSpec | undefined
  step: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <Label>{label}</Label>
        <span className="tabular-nums text-muted-foreground">{value}</span>
      </div>
      <Slider
        value={[value]}
        min={spec?.min ?? 0}
        max={spec?.max ?? 1}
        step={step}
        disabled={disabled || !spec}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  )
}

export function AdvancedParams({ disabled }: { disabled?: boolean }) {
  const { steps, cfg, denoise, resolution, setDraft } = useApp()
  const params = useModels().data?.params
  const res = params?.resolution
  const resolutions = RESOLUTION_PRESETS.filter(
    (r) => res && r >= (res.min ?? 0) && r <= (res.max ?? Infinity) && r % (res.step ?? 1) === 0,
  )

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
        <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" />
        高级参数
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 pt-3">
          <SliderRow label="Steps" value={steps} spec={params?.steps} step={1} disabled={disabled} onChange={(v) => setDraft({ steps: v })} />
          <SliderRow label="CFG" value={cfg} spec={params?.cfg} step={0.1} disabled={disabled} onChange={(v) => setDraft({ cfg: Math.round(v * 10) / 10 })} />
          <SliderRow label="Denoise" value={denoise} spec={params?.denoise} step={0.05} disabled={disabled} onChange={(v) => setDraft({ denoise: Math.round(v * 100) / 100 })} />
          <div className="flex items-center justify-between">
            <Label>Resolution</Label>
            <Select
              value={String(resolution)}
              disabled={disabled || !res}
              onValueChange={(v) => v && setDraft({ resolution: Number(v) })}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {resolutions.map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">取值范围由后端根据 Workflow 配置提供，超出范围的请求会被拒绝。</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
