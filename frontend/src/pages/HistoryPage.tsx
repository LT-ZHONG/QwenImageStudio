import { History } from 'lucide-react'

// Phase 3 will implement history browsing, search, details, reuse and delete.
export default function HistoryPage() {
  return (
    <div className="flex h-full min-h-80 flex-col items-center justify-center gap-2 text-muted-foreground">
      <History className="size-10" />
      <p className="text-lg font-medium text-foreground">创作历史</p>
      <p className="text-sm">将在下一阶段（Phase 3）提供。</p>
    </div>
  )
}
