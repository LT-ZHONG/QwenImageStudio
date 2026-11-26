/** Mark colour/opacity mirror what ComfyUI's MaskEditor "Paint Pen" produces: RGB(255,0,0) at ~60 %. */
export const MARK_COLOR = '#ff0000'
export const MARK_OPACITY = 0.6
/** The model rescales references to ~resolution², so larger exports only cost upload size. */
export const EXPORT_MAX_EDGE = 2048

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

export function fitSize(w: number, h: number, maxEdge = EXPORT_MAX_EDGE): { width: number; height: number } {
  const s = Math.min(1, maxEdge / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

export function hasPaint(layer: HTMLCanvasElement): boolean {
  const { data } = layer.getContext('2d')!.getImageData(0, 0, layer.width, layer.height)
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true
  return false
}

/** Base image + paint layer (opaque red strokes drawn at MARK_OPACITY) flattened into one image. */
export async function exportPainted(
  base: HTMLImageElement,
  layer: HTMLCanvasElement,
  maxBytes: number,
): Promise<{ blob: Blob; name: string }> {
  const out = document.createElement('canvas')
  out.width = layer.width
  out.height = layer.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(base, 0, 0, out.width, out.height)
  ctx.globalAlpha = MARK_OPACITY
  ctx.drawImage(layer, 0, 0)
  const toBlob = (type: string, q?: number) =>
    new Promise<Blob | null>((res) => out.toBlob(res, type, q))
  let blob = await toBlob('image/png')
  let name = 'marked.png'
  if (!blob || blob.size > maxBytes) {
    blob = await toBlob('image/jpeg', 0.92) // photos can be too big as PNG; the marks survive JPEG fine
    name = 'marked.jpg'
  }
  if (!blob) throw new Error('导出图片失败')
  return { blob, name }
}
