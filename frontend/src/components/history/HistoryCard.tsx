import { ImageOff, Loader2, Trash2 } from 'lucide-react'
import { isTerminal, type Generation } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { StatusBadge } from './StatusBadge'

export function HistoryCard({
  task,
  onOpen,
  onDelete,
}: {
  task: Generation
  onOpen: () => void
  onDelete: () => void
}) {
  const result = task.images[0]
  const p = task.generation_params
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-square bg-muted/40">
          {result ? (
            <img src={result.thumbnail_url} alt="生成结果" loading="lazy" className="size-full object-cover" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
              {isTerminal(task.status) ? <ImageOff className="size-8" /> : <Loader2 className="size-8 animate-spin" />}
              <span className="text-xs">
                {task.status === 'succeeded' ? '图片已删除' : isTerminal(task.status) ? '无结果' : '处理中'}
              </span>
            </div>
          )}
          <img
            src={task.upload.thumbnail_url}
            alt="输入图片"
            loading="lazy"
            className="absolute bottom-2 left-2 size-14 rounded-lg border-2 border-white object-cover shadow"
          />
          <StatusBadge status={task.status} className="absolute top-2 left-2" />
        </div>
        <div className="space-y-1 p-3">
          <p className="line-clamp-2 min-h-10 text-sm">{task.prompt}</p>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
            <span>Seed {p.seed}</span>
            {result && (
              <span>
                {result.width}×{result.height}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{formatTime(task.created_at)}</p>
        </div>
      </button>
      {isTerminal(task.status) && (
        <button
          onClick={onDelete}
          title="删除"
          className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-lg bg-background/90 opacity-100 shadow transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  )
}
