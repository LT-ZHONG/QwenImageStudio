import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

// Keep in sync with backend limits (backend/app/config.py)
const MAX_BYTES = 20 * 1024 * 1024
const MIN_EDGE = 64
const MAX_EDGE = 4096
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']

function readSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      reject(new Error('无法读取图片'))
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

async function validate(file: File): Promise<string | null> {
  if (!ACCEPT.includes(file.type)) return '仅支持 PNG、JPG、JPEG、WEBP 格式'
  if (file.size > MAX_BYTES) return `文件大小 ${formatBytes(file.size)} 超过 ${formatBytes(MAX_BYTES)} 限制`
  try {
    const { width, height } = await readSize(file)
    if (Math.max(width, height) > MAX_EDGE || Math.min(width, height) < MIN_EDGE)
      return `图片尺寸需在 ${MIN_EDGE}–${MAX_EDGE}px 之间，当前 ${width}×${height}`
  } catch (e) {
    return (e as Error).message
  }
  return null
}

export function ImageUploader({ disabled }: { disabled?: boolean }) {
  const qc = useQueryClient()
  const uploadId = useApp((s) => s.uploadId)
  const setUploadId = useApp((s) => s.setUploadId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<string | null>(null) // local preview while uploading
  const [dragging, setDragging] = useState(false)

  const { data: upload, error } = useQuery({
    queryKey: ['upload', uploadId],
    queryFn: () => api.getUpload(uploadId!),
    enabled: !!uploadId,
    retry: false,
    staleTime: Infinity,
  })

  // a persisted upload that no longer exists on the server
  useEffect(() => {
    if (error instanceof ApiError && error.status === 404) setUploadId(null)
  }, [error, setUploadId])

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || disabled) return
      const problem = await validate(file)
      if (problem) {
        toast.error(problem)
        return
      }
      const preview = URL.createObjectURL(file)
      setPending(preview)
      try {
        const u = await api.uploadImage(file)
        qc.setQueryData(['upload', u.id], u)
        const prev = useApp.getState().uploadId
        setUploadId(u.id)
        if (prev) api.deleteUpload(prev).catch(() => undefined) // 409 if already used by a task — fine
      } catch (e) {
        toast.error(`上传失败：${(e as Error).message}`)
      } finally {
        URL.revokeObjectURL(preview)
        setPending(null)
      }
    },
    [disabled, qc, setUploadId],
  )

  // paste from clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        void handleFile(file)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [handleFile])

  const remove = () => {
    if (uploadId) api.deleteUpload(uploadId).catch(() => undefined)
    setUploadId(null)
  }

  const src = pending ?? upload?.url
  const uploading = pending !== null

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {src ? (
        <div className="overflow-hidden rounded-xl border bg-muted/30">
          <div className="relative flex h-56 items-center justify-center bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
            <img src={src} alt="输入图片" className="max-h-full max-w-full object-contain" />
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Loader2 className="size-6 animate-spin" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              {upload && !uploading
                ? `${upload.original_name} · ${upload.width}×${upload.height} · ${formatBytes(upload.size_bytes)}`
                : '上传中…'}
            </span>
            <Button size="xs" variant="ghost" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
              <RefreshCw /> 替换
            </Button>
            <Button size="xs" variant="ghost" disabled={disabled || uploading} onClick={remove}>
              <Trash2 /> 删除
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void handleFile(e.dataTransfer.files[0])
          }}
          className={cn(
            'flex h-56 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-muted-foreground transition-colors hover:border-primary/60 hover:bg-muted/40',
            dragging && 'border-primary bg-muted/60',
          )}
        >
          <ImagePlus className="size-8" />
          <span className="text-sm font-medium text-foreground">点击、拖拽或粘贴图片</span>
          <span className="text-xs">PNG / JPG / WEBP · 最大 {formatBytes(MAX_BYTES)} · {MIN_EDGE}–{MAX_EDGE}px</span>
        </button>
      )}
    </div>
  )
}
