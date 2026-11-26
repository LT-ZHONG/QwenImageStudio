import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { ImageUploader } from '@/components/create/ImageUploader'
import { PromptEditor } from '@/components/create/PromptEditor'
import { ResultPanel } from '@/components/create/ResultPanel'
import { AdvancedParams, SeedControl, useModels } from '@/components/create/SeedAndParams'
import { validateDraft } from '@/components/create/validate'
import { QueueNotice } from '@/components/create/QueueNotice'
import { Button } from '@/components/ui/button'
import { api, isTerminal, type GenerationCreate } from '@/lib/api'
import { useGeneration } from '@/hooks/useGeneration'
import { useApp } from '@/store/app'

export default function CreatePage() {
  const qc = useQueryClient()
  const app = useApp()
  const models = useModels().data
  const { data: task, isLoading, error } = useGeneration(app.activeTaskId)

  // a remembered task that no longer exists
  const setActiveTaskId = useApp((s) => s.setActiveTaskId)
  useEffect(() => {
    if ((error as { status?: number } | null)?.status === 404) setActiveTaskId(null)
  }, [error, setActiveTaskId])

  const busy = !!task && !isTerminal(task.status)
  const draft: GenerationCreate = {
    upload_id: app.uploadId ?? '',
    prompt: app.prompt,
    negative_prompt: app.negativePrompt,
    seed: app.seedMode === 'fixed' ? app.seed : null,
    steps: app.steps,
    cfg: app.cfg,
    denoise: app.denoise,
    resolution: app.resolution,
  }
  const problem = validateDraft(draft, models)

  const onCreated = (g: { id: string }) => {
    app.setActiveTaskId(g.id)
    qc.invalidateQueries({ queryKey: ['generations'] })
    qc.invalidateQueries({ queryKey: ['queue-status'] })
  }
  const onError = (e: Error) => toast.error(e.message)

  const generate = useMutation({ mutationFn: () => api.createGeneration(draft), onSuccess: onCreated, onError })
  const retry = useMutation({
    mutationFn: () => api.retryGeneration(app.activeTaskId!),
    onSuccess: onCreated,
    onError,
  })
  const cancel = useMutation({
    mutationFn: () => api.cancelGeneration(app.activeTaskId!),
    onSuccess: (g) => qc.setQueryData(['generation', g.id], g),
    onError,
  })

  const submit = () => {
    if (problem) return toast.error(problem)
    generate.mutate()
  }

  return (
    <div className="flex flex-col lg:h-full lg:flex-row">
      <section className="w-full shrink-0 space-y-6 border-b p-4 lg:w-[26rem] lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-5">
        <ImageUploader disabled={busy} />
        <PromptEditor disabled={busy} />
        <SeedControl disabled={busy} lastSeed={task?.generation_params.seed} />
        <AdvancedParams disabled={busy} />
        <div className="sticky bottom-0 -mx-1 space-y-2 bg-background/90 px-1 pt-2 pb-1 backdrop-blur">
          <Button size="lg" className="h-11 w-full text-base" disabled={!!problem || busy || generate.isPending} onClick={submit}>
            {generate.isPending || busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? '生成中…' : '生成图片'}
          </Button>
          <QueueNotice />
          {problem && !busy && <p className="text-center text-xs text-muted-foreground">{problem}</p>}
        </div>
      </section>

      <section className="min-w-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:flex-1 lg:overflow-y-auto lg:p-6">
        <ResultPanel
          task={task}
          loading={isLoading && !!app.activeTaskId}
          onCancel={() => cancel.mutate()}
          onRetry={() => retry.mutate()}
        />
      </section>
    </div>
  )
}
