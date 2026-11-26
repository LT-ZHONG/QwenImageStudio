import { useQuery } from '@tanstack/react-query'
import { ListOrdered } from 'lucide-react'
import { api } from '@/lib/api'

/** Live count of tasks waiting for / using the GPU (shared by everyone using this server). */
export function QueueNotice() {
  const { data } = useQuery({
    queryKey: ['queue-status'],
    queryFn: api.queueStatus,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  if (!data) return null
  const busy = data.waiting + data.running > 0
  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground" role="status">
      <ListOrdered className="size-3.5" />
      {busy
        ? `当前 ${data.waiting} 个任务在排队${data.running ? `，${data.running} 个正在生成` : ''}`
        : '当前没有排队任务'}
    </p>
  )
}
