/** Mark colour/opacity mirror what ComfyUI's MaskEditor "Paint Pen" produces: RGB(255,0,0) at ~60 %. */
export const MARK_COLOR = '#ff0000'

export interface MarkColor {
  name: string // used in prompts, e.g. “红色遮罩区域”
  hex: string
}
export const MARK_COLORS: MarkColor[] = [
  { name: '红色', hex: '#ff0000' },
  { name: '橙色', hex: '#ff8000' },
  { name: '黄色', hex: '#ffe600' },
  { name: '绿色', hex: '#00d000' },
  { name: '蓝色', hex: '#0050ff' },
  { name: '紫色', hex: '#a020f0' },
  { name: '白色', hex: '#ffffff' },
  { name: '黑色', hex: '#000000' },
]

/** Names of the palette colours actually present in the paint layer (nearest-colour match, sampled). */
export function usedColorNames(layer: HTMLCanvasElement): string[] {
  const { data } = layer.getContext('2d')!.getImageData(0, 0, layer.width, layer.height)
  const rgb = MARK_COLORS.map((c) => [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16)))
  const counts = new Array(MARK_COLORS.length).fill(0)
  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] < 128) continue
    let best = 0
    let bestD = Infinity
    rgb.forEach(([r, g, b], k) => {
      const d = (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2
      if (d < bestD) [best, bestD] = [k, d]
    })
    counts[best]++
  }
  const total = counts.reduce((a, b) => a + b, 0)
  const names = MARK_COLORS.filter((_, k) => counts[k] > Math.max(3, total * 0.01)).map((c) => c.name)
  return names.length ? names : [MARK_COLORS[0].name]
}

/** “红色遮罩区域” / “红色和蓝色遮罩区域” */
export const maskAreaLabel = (names: string[]) => `${names.join('和')}遮罩区域`
export const MARK_OPACITY = 0.6 // default; the editor lets the user change it
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

/** Base image + paint layer (opaque red strokes composited at `opacity`) flattened into one image. */
export async function exportPainted(
  base: HTMLImageElement,
  layer: HTMLCanvasElement,
  maxBytes: number,
  opacity: number = MARK_OPACITY,
): Promise<{ blob: Blob; name: string }> {
  const out = document.createElement('canvas')
  out.width = layer.width
  out.height = layer.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(base, 0, 0, out.width, out.height)
  ctx.globalAlpha = opacity
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
