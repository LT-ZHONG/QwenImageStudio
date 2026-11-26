import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { History, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { DeleteConfirm } from '@/components/history/DeleteConfirm'
import { HistoryCard } from '@/components/history/HistoryCard'
import { HistoryDetail } from '@/components/history/HistoryDetail'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDebounce } from '@/hooks/useDebounce'
import { api, isTerminal, type Generation, type TaskStatus } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

const PAGE = 24
const FILTERS: { value: TaskStatus | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
]

export default function HistoryPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const q = useDebounce(search.trim())
  const [status, setStatus] = useState<TaskStatus | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Generation | null>(null)

  const list = useInfiniteQuery({
    queryKey: ['generations', 'history', q, status],
    queryFn: ({ pageParam }) => api.listGenerations({ limit: PAGE, offset: pageParam, q, status: status || undefined }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    // keep following tasks that are still running
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some((t) => !isTerminal(t.status))) ? 4000 : false,
  })

  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const selected = items.find((t) => t.id === selectedId) ?? null

  const remove = useMutation({
    mutationFn: (t: Generation) => api.deleteGeneration(t.id),
    onSuccess: (_d, t) => {
      toast.success('已删除')
      if (useApp.getState().activeTaskId === t.id) useApp.getState().setActiveTaskId(null)
      qc.removeQueries({ queryKey: ['generation', t.id] })
      qc.invalidateQueries({ queryKey: ['generations'] })
      setDeleting(null)
      setSelectedId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const reuse = (t: Generation, keepSeed: boolean) => {
    const st = useApp.getState()
    st.reuseParams(t, { keepSeed })
    st.setUploadId(t.upload_id)
    toast.success('参数已填入创作页')
    navigate('/')
  }

  const filtered = !!q || !!status

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">创作历史</h1>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索提示词"
            className="pr-8 pl-8"
          />
          {search && (
            <button className="absolute top-2 right-2 text-muted-foreground" onClick={() => setSearch('')} aria-label="清除搜索">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="inline-flex rounded-lg border p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                status === f.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : list.isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>加载失败：{(list.error as Error).message}</p>
          <Button variant="outline" onClick={() => list.refetch()}>
            重试
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
          <History className="size-10" />
          <p className="text-lg font-medium text-foreground">{filtered ? '没有符合条件的记录' : '还没有创作记录'}</p>
          {!filtered && (
            <Button className="mt-2" onClick={() => navigate('/')}>
              去创作
            </Button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">共 {total} 条记录</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((t) => (
              <HistoryCard key={t.id} task={t} onOpen={() => setSelectedId(t.id)} onDelete={() => setDeleting(t)} />
            ))}
          </div>
          {list.hasNextPage && (
            <Button variant="outline" className="mx-auto" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {list.isFetchingNextPage && <Loader2 className="animate-spin" />} 加载更多
            </Button>
          )}
        </>
      )}

      <HistoryDetail
        task={selected}
        onClose={() => setSelectedId(null)}
        onReuse={reuse}
        onDelete={setDeleting}
      />
      <DeleteConfirm
        open={!!deleting}
        pending={remove.isPending}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  )
}
