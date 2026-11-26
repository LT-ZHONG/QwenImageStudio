import { useState } from 'react'
import { Copy, Download, Maximize2, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { CompareSlider } from '@/components/create/CompareSlider'
import { PreviewDialog } from '@/components/create/PreviewDialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { isTerminal, type Generation, type ImageAsset } from '@/lib/api'
import { formatBytes, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { StatusBadge } from './StatusBadge'

type View = 'result' | 'input' | 'compare'

export function HistoryDetail({
  task,
  onClose,
  onReuse,
  onDelete,
}: {
  task: Generation | null
  onClose: () => void
  onReuse: (t: Generation) => void
  onDelete: (t: Generation) => void
}) {
  const [view, setView] = useState<View>('result')
  const [preview, setPreview] = useState<ImageAsset | null>(null)
  const result = task?.images[0]

  const rows = task
    ? ([
        ['状态', null],
        ['模型', task.model],
        ['Seed', `${task.generation_params.seed}${task.generation_params.seed_mode === 'random' ? '（随机）' : ''}`],
        ['Steps / CFG / Denoise', `${task.generation_params.steps} / ${task.generation_params.cfg} / ${task.generation_params.denoise}`],
        ['Resolution', String(task.generation_params.resolution)],
        ['输入图片', `${task.upload.original_name} · ${task.upload.width}×${task.upload.height} · ${formatBytes(task.upload.size_bytes)}`],
        ['结果图片', result ? `${result.width}×${result.height} · ${formatBytes(result.size_bytes)} · ${result.format.toUpperCase()}` : '—'],
        ['创建时间', formatTime(task.created_at)],
        ['完成时间', formatTime(task.completed_at)],
      ] as [string, string | null][])
    : []

  return (
    <>
      <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92dvh] w-[min(64rem,96vw)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogTitle className="sr-only">创作详情</DialogTitle>
          <DialogDescription className="sr-only">图片、提示词与生成参数</DialogDescription>
          {task && (
            <div className="grid max-h-[92dvh] min-h-0 overflow-y-auto md:grid-cols-[1.3fr_1fr]">
              <div className="space-y-3 bg-muted/30 p-4">
                <div className="inline-flex rounded-lg border bg-background p-0.5 text-sm">
                  {(
                    [
                      ['result', '生成结果'],
                      ['input', '输入图片'],
                      ['compare', '对比'],
                    ] as [View, string][]
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      disabled={v !== 'input' && !result}
                      onClick={() => setView(v)}
                      className={cn(
                        'rounded-md px-3 py-1 disabled:opacity-40',
                        view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex min-h-64 items-center justify-center">
                  {view === 'compare' && result ? (
                    <CompareSlider before={task.upload.url} after={result.url} aspect={result.width / result.height} maxHeight="60dvh" />
                  ) : view === 'input' || !result ? (
                    <img src={task.upload.url} alt="输入图片" className="max-h-[60dvh] max-w-full rounded object-contain" />
                  ) : (
                    <img src={result.url} alt="生成结果" className="max-h-[60dvh] max-w-full rounded object-contain" />
                  )}
                </div>
                {result && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPreview(result)}>
                      <Maximize2 /> 全屏预览
                    </Button>
                    <a href={result.url} download className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                      <Download /> 下载原图
                    </a>
                  </div>
                )}
              </div>

              <div className="space-y-4 p-4 pt-12 text-sm">
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
                {task.error_message && <p className="rounded-lg bg-destructive/10 p-2 text-destructive">{task.error_message}</p>}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                  {rows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="break-all tabular-nums">{v ?? <StatusBadge status={task.status} />}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button size="sm" onClick={() => onReuse(task)}>
                    <Wand2 /> 复用参数
                  </Button>
                  {isTerminal(task.status) && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(task)}>
                      <Trash2 /> 删除
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {task && <PreviewDialog task={task} image={preview} onClose={() => setPreview(null)} />}
    </>
  )
}
