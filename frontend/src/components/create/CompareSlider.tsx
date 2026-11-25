import { useRef, useState } from 'react'
import { MoveHorizontal } from 'lucide-react'

/** Before/after slider using the backend-stored images (not ComfyUI temp URLs). */
export function CompareSlider({
  before,
  after,
  aspect,
  maxHeight = '70dvh',
  className,
}: {
  before: string
  after: string
  aspect: number
  /** CSS length; the slider is sized to fit this height while keeping the aspect ratio */
  maxHeight?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(50)

  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }

  return (
    <div
      ref={ref}
      className={className}
      style={{ aspectRatio: aspect, width: `min(100%, calc(${maxHeight} * ${aspect}))` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e.clientX)
      }}
      onPointerMove={(e) => e.buttons && move(e.clientX)}
    >
      <div className="relative size-full cursor-ew-resize touch-none overflow-hidden select-none">
        <img src={after} alt="生成结果" draggable={false} className="absolute inset-0 size-full object-contain" />
        <img
          src={before}
          alt="原图"
          draggable={false}
          className="absolute inset-0 size-full object-contain"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <span className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">原图</span>
        <span className="absolute top-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">结果</span>
        <div className="absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }}>
          <div className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg">
            <MoveHorizontal className="size-4" />
          </div>
        </div>
      </div>
    </div>
  )
}
