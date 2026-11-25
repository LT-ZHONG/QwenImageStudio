export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  // backend stores naive UTC timestamps in SQLite; treat missing zone as UTC
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z')
  return d.toLocaleString()
}

export const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  submitting: '提交中',
  running: '生成中',
  cancelling: '取消中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}
