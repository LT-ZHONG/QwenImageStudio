import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Eraser, Loader2, Paintbrush, Redo2, Trash2, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { exportPainted, fitSize, hasPaint, loadImage, MARK_COLORS, MARK_OPACITY, usedColorNames } from '@/lib/paint'
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
  onSave: (blob: Blob, filename: string, colors: string[]) => Promise<void>
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
  const [opacityPct, setOpacityPct] = useState(Math.round(MARK_OPACITY * 100))
  const [color, setColor] = useState(MARK_COLORS[0])
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
    c.strokeStyle = c.fillStyle = color.hex // drawn opaque; the layer is shown/exported at MARK_OPACITY, so overlaps stay uniform
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
      const { blob, name } = await exportPainted(imgRef.current, paintRef.current, maxBytes, opacityPct / 100)
      await onSave(blob, name, usedColorNames(paintRef.current))
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [maxBytes, onSave, opacityPct])

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
        className="fixed inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 md:flex-row rounded-none border-0 bg-neutral-950 p-0 text-white sm:max-w-none"
      >
        <DialogTitle className="sr-only">局部重绘</DialogTitle>
        <DialogDescription className="sr-only">用画笔标记需要修改的区域</DialogDescription>

        {/* Canvas first in the DOM: below the toolbar on phones (thumb reach), left of it on md+ */}
        <div ref={stageRef} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-2">
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
            <canvas ref={paintRef} className="absolute inset-0 size-full" style={{ opacity: opacityPct / 100 }} />
          </div>
          {cursor && ready && (
            <div
              className="pointer-events-none absolute rounded-full border border-white mix-blend-difference"
              style={{ width: ringPx, height: ringPx, left: cursor.x - ringPx / 2, top: cursor.y - ringPx / 2 }}
            />
          )}
        </div>

        <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:w-64 md:border-t-0 md:border-l md:pb-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
            <div className="inline-flex rounded-lg bg-white/10 p-0.5">
              {(
                [
                  ['brush', Paintbrush, '画笔', 'B'],
                  ['eraser', Eraser, '橡皮', 'E'],
                ] as const
              ).map(([t, Icon, label, key]) => (
                <button
                  key={t}
                  title={`${label} (${key})`}
                  aria-label={`${label} (${key})`}
                  onClick={() => setTool(t)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm',
                    tool === t ? 'bg-white text-black' : 'text-white/70',
                  )}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-1 md:justify-start">
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
            </div>

            <div className="col-span-2 space-y-1.5 md:col-span-1" title="标记颜色">
              <div className="flex justify-between text-xs text-white/60">
                <span>颜色</span>
                <span>{color.name}</span>
              </div>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="标记颜色">
                {MARK_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    role="radio"
                    aria-checked={color.hex === c.hex}
                    aria-label={c.name}
                    title={c.name}
                    onClick={() => {
                      setColor(c)
                      setTool('brush')
                    }}
                    className={cn(
                      'size-7 rounded-full border-2 transition-transform',
                      color.hex === c.hex ? 'scale-110 border-white ring-2 ring-white/40' : 'border-white/30',
                    )}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1.5" title="画笔大小">
              <div className="flex justify-between text-xs text-white/60">
                <span>大小</span>
                <span className="tabular-nums">{brushPct}%</span>
              </div>
              <Slider value={[brushPct]} min={0.5} max={15} step={0.5} onValueChange={(v) => setBrushPct(Array.isArray(v) ? v[0] : v)} />
            </div>

            <div className="space-y-1.5" title="标记透明度（默认 60%）">
              <div className="flex justify-between text-xs text-white/60">
                <span>透明度</span>
                <span className="tabular-nums">{opacityPct}%</span>
              </div>
              <Slider value={[opacityPct]} min={10} max={100} step={5} aria-label="标记透明度"
                onValueChange={(v) => setOpacityPct(Array.isArray(v) ? v[0] : v)} />
            </div>
          </div>

          <p className="text-xs leading-relaxed text-amber-300/90 md:mt-2">
            遮罩颜色尽量和画面的颜色不同，例如画面中红色居多，那么遮罩颜色就不要用红色。
          </p>

          <p className="hidden text-xs leading-relaxed text-white/50 md:mt-2 md:block">
            用画笔涂抹需要修改的区域，然后在提示词里写明“{color.name}遮罩区域”要怎么改（用了多种颜色则都要写明）。
          </p>

          <div className="mt-auto grid grid-cols-2 gap-2">
            <Button variant="ghost" className="text-white hover:bg-white/10" disabled={saving} onClick={onCancel}>
              <X /> 取消
            </Button>
            <Button className="bg-white text-black hover:bg-white/90" disabled={!ready || saving} onClick={save}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />} 完成
            </Button>
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  )
}
