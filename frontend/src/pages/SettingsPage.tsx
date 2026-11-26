import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useModels } from '@/components/create/SeedAndParams'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useApp, type ThemeMode } from '@/store/app'

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

export default function SettingsPage() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const models = useModels().data
  const qc = useQueryClient()

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s)
      toast.success('设置已保存')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const changeTheme = (t: ThemeMode) => {
    setTheme(t)
    save.mutate({ theme: t })
  }

  const test = useMutation({
    mutationFn: async () => {
      const health = await api.health()
      const comfy = await api.comfyStatus()
      return { health, comfy }
    },
  })

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-xl font-semibold">设置</h1>

      <section className="space-y-3">
        <h2 className="font-medium">后端连接测试</h2>
        <Button onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending && <Loader2 className="animate-spin" />} 测试连接
        </Button>
        {test.isError && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4" /> {(test.error as Error).message}
          </p>
        )}
        {test.data && (
          <ul className="space-y-1 text-sm">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-500" /> FastAPI 后端正常（v{test.data.health.version}）
            </li>
            <li className="flex items-center gap-2">
              {test.data.comfy.online ? (
                <CheckCircle2 className="size-4 text-green-500" />
              ) : (
                <XCircle className="size-4 text-destructive" />
              )}
              ComfyUI {test.data.comfy.online ? `已连接（${test.data.comfy.comfyui_version}）` : `未连接：${test.data.comfy.detail}`}
            </li>
          </ul>
        )}
        <p className="text-xs text-muted-foreground">ComfyUI 地址由后端配置管理，此处不可修改。</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">默认主题</h2>
        <div className="inline-flex rounded-lg border p-0.5">
          {THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => changeTheme(t.value)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm',
                theme === t.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {models && (
        <section className="space-y-3">
          <h2 className="font-medium">当前模型</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">模型</dt>
            <dd>{models.model}</dd>
            {Object.entries(models.files).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground uppercase">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">模型文件由 ComfyUI Workflow 管理。</p>
        </section>
      )}
    </div>
  )
}
