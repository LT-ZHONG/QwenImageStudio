import { useState } from 'react'
import { AlertCircle, ChevronDown, Columns2, Copy, Download, Loader2, Maximize2, RotateCcw, Sparkles, Square, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { isTerminal, type Generation, type ImageAsset } from '@/lib/api'
import { formatBytes, formatTime, STATUS_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CompareSlider } from './CompareSlider'
import { PreviewDialog } from './PreviewDialog'

function ProgressView({ task, onCancel }: { task: Generation; onCancel: () => void }) {
  // Only real ComfyUI sampling progress is shown as a percentage; otherwise indeterminate.
  const determinate = task.status === 'running' && task.progress > 0
  const pct = Math.round(task.progress * 100)
  const label =
    task.status === 'running' && !determinate ? '生成中' : STATUS_LABEL[task.status]
  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div className="relative overflow-hidden rounded-xl border bg-muted/30">
        <img src={task.upload.url} alt="输入图片" className="mx-auto max-h-[55dvh] object-contain opacity-40 blur-[2px]" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Loader2 className="size-8 animate-spin" />
          <span className="text-sm font-medium">{label}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          {determinate ? (
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
          ) : (
            <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary/70" />
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{determinate ? `进度 ${pct}%` : STATUS_LABEL[task.status]}</span>
          <Button size="xs" variant="outline" disabled={task.status === 'cancelling'} onClick={onCancel}>
            <Square /> {task.status === 'cancelling' ? '取消中…' : '取消生成'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Details({ task }: { task: Generation }) {
  const p = task.generation_params
  const rows: [string, string][] = [
    ['模型', task.model],
    ['Seed', `${p.seed}${p.seed_mode === 'random' ? '（随机）' : ''}`],
    ['Steps / CFG / Denoise', `${p.steps} / ${p.cfg} / ${p.denoise}`],
    ['Resolution', String(p.resolution)],
    ['创建时间', formatTime(task.created_at)],
    ['完成时间', formatTime(task.completed_at)],
  ]
  return (
    <Collapsible className="rounded-xl border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-sm font-medium">
        提示词与生成参数
        <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 border-t px-4 py-3 text-sm">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              提示词
              <button
                className="inline-flex items-center gap-1 hover:text-foreground"
                onClick={() => navigator.clipboard.writeText(task.prompt).then(() => toast.success('已复制'))}
              >
                <Copy className="size-3" /> 复制
              </button>
            </div>
            <p className="whitespace-pre-wrap">{task.prompt}</p>
          </div>
          {task.negative_prompt && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">负面提示词</div>
              <p className="whitespace-pre-wrap">{task.negative_prompt}</p>
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ResultPanel({
  task,
  loading,
  onCancel,
  onRetry,
  onReuse,
}: {
  task: Generation | undefined
  loading: boolean
  onCancel: () => void
  onRetry: (randomizeSeed: boolean) => void
  onReuse: (keepSeed: boolean) => void
}) {
  const [preview, setPreview] = useState<ImageAsset | null>(null)
  const [compare, setCompare] = useState(false)

  if (!task) {
    return (
      <div className="flex h-full min-h-80 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        {loading ? (
          <Loader2 className="size-8 animate-spin" />
        ) : (
          <>
            <Sparkles className="size-10" />
            <p className="text-lg font-medium text-foreground">生成结果会显示在这里</p>
            <p className="max-w-sm text-sm">上传一张图片，输入编辑指令，然后点击「生成图片」。</p>
          </>
        )}
      </div>
    )
  }

  if (!isTerminal(task.status)) return <ProgressView task={task} onCancel={onCancel} />

  if (task.status !== 'succeeded') {
    const failed = task.status === 'failed'
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <AlertCircle className={cn('size-10', failed ? 'text-destructive' : 'text-muted-foreground')} />
        <p className="text-lg font-medium">{failed ? '生成失败' : '任务已取消'}</p>
        {task.error_message && <p className="text-sm break-words text-muted-foreground">{task.error_message}</p>}
        <Button onClick={() => onRetry(false)}>
          <RotateCcw /> 重试
        </Button>
      </div>
    )
  }

  const main = task.images[0]
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={compare ? 'default' : 'outline'} onClick={() => setCompare((v) => !v)}>
          <Columns2 /> 对比原图
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPreview(main)}>
          <Maximize2 /> 全屏预览
        </Button>
        <a
          href={main.url}
          download
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          <Download /> 下载原图
        </a>
        <span className="ml-auto text-xs text-muted-foreground">
          {main.width}×{main.height} · {formatBytes(main.size_bytes)} · {main.format.toUpperCase()}
        </span>
      </div>

      {compare ? (
        <div className="flex justify-center rounded-xl border bg-muted/30">
          <CompareSlider before={task.upload.url} after={main.url} aspect={main.width / main.height} />
        </div>
      ) : (
        <div className={cn('grid gap-3', task.images.length > 1 && 'sm:grid-cols-2')}>
          {task.images.map((img) => (
            <button
              key={img.id}
              onClick={() => setPreview(img)}
              className="group relative flex justify-center overflow-hidden rounded-xl border bg-muted/30"
            >
              <img src={img.url} alt="生成结果" className="max-h-[70dvh] object-contain" />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onReuse(true)}>
          <Wand2 /> 复用参数（含 Seed）
        </Button>
        <Button variant="outline" onClick={() => onRetry(true)}>
          <RotateCcw /> 换个 Seed 重新生成
        </Button>
      </div>
      <Details task={task} />

      <PreviewDialog task={task} image={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
