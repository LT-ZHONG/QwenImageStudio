import { useState } from 'react'
import { Download, Maximize2, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { Generation, ImageAsset } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CompareSlider } from './CompareSlider'

export function PreviewDialog({
  task,
  image,
  onClose,
}: {
  task: Generation
  image: ImageAsset | null
  onClose: () => void
}) {
  const [mode, setMode] = useState<'result' | 'compare'>('result')

  const fullscreen = () => {
    const el = document.getElementById('preview-surface')
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el?.requestFullscreen?.()
  }

  return (
    <Dialog open={!!image} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-black p-0 text-white sm:max-w-none"
      >
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        <DialogDescription className="sr-only">原图、生成结果与对比预览</DialogDescription>
        {image && (
          <div id="preview-surface" className="flex min-h-0 flex-1 flex-col bg-black">
            <div className="flex items-center gap-2 p-3">
              <div className="inline-flex rounded-lg bg-white/10 p-0.5 text-sm">
                {(['result', 'compare'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn('rounded-md px-3 py-1', mode === m ? 'bg-white text-black' : 'text-white/70')}
                  >
                    {m === 'result' ? '生成结果' : '与原图对比'}
                  </button>
                ))}
              </div>
              <span className="ml-2 text-xs text-white/60">
                {image.width}×{image.height}
              </span>
              <div className="ml-auto flex gap-1">
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={fullscreen} title="浏览器全屏">
                  <Maximize2 />
                </Button>
                <a
                  href={image.url}
                  download
                  title="下载原图"
                  className={cn(buttonVariants({ size: 'icon', variant: 'ghost' }), 'text-white hover:bg-white/10')}
                >
                  <Download />
                </a>
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={onClose} title="关闭">
                  <X />
                </Button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-3 pt-0">
              {mode === 'result' ? (
                <img src={image.url} alt="生成结果" className="max-h-full max-w-full object-contain" />
              ) : (
                <CompareSlider
                  before={task.upload.url}
                  after={image.url}
                  aspect={image.width / image.height}
                  maxHeight="calc(100dvh - 5.5rem)"
                />
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
