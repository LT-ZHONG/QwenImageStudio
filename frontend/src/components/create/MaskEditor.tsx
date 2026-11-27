import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Eraser, Loader2, Paintbrush, Redo2, Trash2, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { exportPainted, fitSize, hasPaint, loadImage, MARK_COLOR, MARK_OPACITY } from '@/lib/paint'
import { cn } from '@/lib/utils'

const HISTORY_LIMIT = 20

export function MaskEditor({
  open,
  imageUrl,
  maxBytes,
  onCancel,
  onSave,
}: {
  open: boolean
  imageUrl: string | null
  maxBytes: number
  onCancel: () => void
  onSave: (blob: Blob, filename: string) => Promise<void>
}) {
  const baseRef = useRef<HTMLCanvasElement>(null)
  const paintRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const undo = useRef<ImageData[]>([])
  const redo = useRef<ImageData[]>([])
  const last = useRef<{ x: number; y: number } | null>(null)
  const [hist, setHist] = useState({ undo: 0, redo: 0 })
  const sync = () => setHist({ undo: undo.current.length, redo: redo.current.length })
  const [ready, setReady] = useState(false)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [view, setView] = useState({ w: 1, h: 1 })
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [brushPct, setBrushPct] = useState(4) // % of the image's long edge
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [saving, setSaving] = useState(false)

  // load the image and size both canvases to the export resolution
  useEffect(() => {
    if (!open || !imageUrl) return
    let cancelled = false
    loadImage(imageUrl)
      .then((img) => {
        if (cancelled) return
        imgRef.current = img
        const s = fitSize(img.naturalWidth, img.naturalHeight)
        setSize(s)
        requestAnimationFrame(() => {
          const base = baseRef.current!
          base.width = s.width
          base.height = s.height
          base.getContext('2d')!.drawImage(img, 0, 0, s.width, s.height)
          const paint = paintRef.current!
          paint.width = s.width
          paint.height = s.height
          setReady(true)
        })
      })
      .catch((e: Error) => toast.error(e.message))
    return () => {
      cancelled = true
    }
  }, [open, imageUrl])

  // fit the canvases inside the stage
  useEffect(() => {
    const el = stageRef.current
    if (!el || !ready) return
    const fit = () => {
      const k = Math.min(el.clientWidth / size.width, el.clientHeight / size.height)
      setView({ w: Math.floor(size.width * k), h: Math.floor(size.height * k) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready, size])

  const ctx = () => paintRef.current!.getContext('2d', { willReadFrequently: true })!
  const brushPx = (Math.max(size.width, size.height) * brushPct) / 100

  const point = (e: React.PointerEvent) => {
    const r = paintRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * size.width) / r.width, y: ((e.clientY - r.top) * size.height) / r.height }
  }

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const c = ctx()
    c.save()
    c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    c.strokeStyle = c.fillStyle = MARK_COLOR // drawn opaque; the layer is shown/exported at MARK_OPACITY, so overlaps stay uniform
    c.lineWidth = brushPx
    c.lineCap = c.lineJoin = 'round'
    c.beginPath()
    c.moveTo(from.x, from.y)
    c.lineTo(to.x, to.y)
    c.stroke()
    c.restore()
  }

  const onDown = (e: React.PointerEvent) => {
    if (!ready || e.button > 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    undo.current.push(ctx().getImageData(0, 0, size.width, size.height))
    if (undo.current.length > HISTORY_LIMIT) undo.current.shift()
    redo.current = []
    sync()
    const p = point(e)
    last.current = p
    stroke(p, p) // a tap leaves a dot
  }
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      const r = stageRef.current!.getBoundingClientRect()
      setCursor({ x: e.clientX - r.left, y: e.clientY - r.top })
    }
    if (!last.current) return
    const p = point(e)
    stroke(last.current, p)
    last.current = p
  }
  const onUp = () => {
    last.current = null
  }

  const restore = (from: ImageData[], to: ImageData[]) => {
    const snap = from.pop()
    if (!snap) return
    to.push(ctx().getImageData(0, 0, size.width, size.height))
    ctx().putImageData(snap, 0, 0)
    sync()
  }
  const clearAll = () => {
    if (!hasPaint(paintRef.current!)) return
    undo.current.push(ctx().getImageData(0, 0, size.width, size.height))
    redo.current = []
    ctx().clearRect(0, 0, size.width, size.height)
    sync()
  }

  const save = useCallback(async () => {
    if (!paintRef.current || !imgRef.current) return
    if (!hasPaint(paintRef.current)) {
      toast.error('还没有涂抹任何区域')
      return
    }
    setSaving(true)
    try {
      const { blob, name } = await exportPainted(imgRef.current, paintRef.current, maxBytes)
      await onSave(blob, name)
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [maxBytes, onSave])

  // keyboard shortcuts: Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, B / E
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) restore(redo.current, undo.current)
        else restore(undo.current, redo.current)
      } else if (e.key === 'b') setTool('brush')
      else if (e.key === 'e') setTool('eraser')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const ringPx = (brushPx * view.w) / size.width

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-neutral-950 p-0 text-white sm:max-w-none"
      >
        <DialogTitle className="sr-only">局部重绘</DialogTitle>
        <DialogDescription className="sr-only">用红色画笔标记需要修改的区域</DialogDescription>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
          <div className="inline-flex rounded-lg bg-white/10 p-0.5">
            {(
              [
                ['brush', Paintbrush, '画笔 (B)'],
                ['eraser', Eraser, '橡皮 (E)'],
              ] as const
            ).map(([t, Icon, label]) => (
              <button
                key={t}
                title={label}
                aria-label={label}
                onClick={() => setTool(t)}
                className={cn('rounded-md px-3 py-1.5', tool === t ? 'bg-white text-black' : 'text-white/70')}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
          <div className="flex w-40 items-center gap-2 px-1" title="画笔大小">
            <span className="shrink-0 text-xs whitespace-nowrap text-white/60">大小</span>
            <Slider value={[brushPct]} min={0.5} max={15} step={0.5} onValueChange={(v) => setBrushPct(Array.isArray(v) ? v[0] : v)} />
          </div>
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" title="撤销 (Ctrl+Z)" aria-label="撤销"
            disabled={!hist.undo} onClick={() => restore(undo.current, redo.current)}>
            <Undo2 />
          </Button>
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" title="重做 (Shift+Ctrl+Z)" aria-label="重做"
            disabled={!hist.redo} onClick={() => restore(redo.current, undo.current)}>
            <Redo2 />
          </Button>
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" title="清空标记" aria-label="清空标记" onClick={clearAll}>
            <Trash2 />
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" className="text-white hover:bg-white/10" disabled={saving} onClick={onCancel}>
              <X /> 取消
            </Button>
            <Button className="bg-white text-black hover:bg-white/90" disabled={!ready || saving} onClick={save}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />} 完成
            </Button>
          </div>
        </div>

        <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
          {!ready && <Loader2 className="absolute size-8 animate-spin text-white/60" />}
          <div
            className={cn('relative touch-none select-none', !ready && 'invisible')}
            style={{ width: view.w, height: view.h, cursor: 'none' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => setCursor(null)}
          >
            <canvas ref={baseRef} className="absolute inset-0 size-full" />
            <canvas ref={paintRef} className="absolute inset-0 size-full" style={{ opacity: MARK_OPACITY }} />
          </div>
          {cursor && ready && (
            <div
              className="pointer-events-none absolute rounded-full border border-white mix-blend-difference"
              style={{ width: ringPx, height: ringPx, left: cursor.x - ringPx / 2, top: cursor.y - ringPx / 2 }}
            />
          )}
        </div>
        <p className="px-3 pb-2 text-center text-xs text-white/50">
          用红色画笔涂抹需要修改的区域，然后在提示词里写明“红色遮罩区域”要怎么改。
        </p>
      </DialogContent>
    </Dialog>
  )
}
