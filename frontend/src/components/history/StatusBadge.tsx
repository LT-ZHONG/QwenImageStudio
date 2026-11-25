import { Badge } from '@/components/ui/badge'
import type { TaskStatus } from '@/lib/api'
import { STATUS_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'

const STYLE: Record<TaskStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  submitting: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  running: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  cancelling: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  succeeded: 'bg-green-500/15 text-green-700 dark:text-green-400',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
}

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border-transparent', STYLE[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}
