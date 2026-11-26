import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, History, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { useApp } from '@/store/app'

const MAX_LEN = 4000
const EXAMPLES = [
  '移除画面中的人物，保持背景环境、光照和构图自然一致。',
  '把背景替换成傍晚的海边，保持主体不变。',
  '把左侧桌子上的咖啡杯换成一个青花瓷茶壶，保持桌面的木纹纹理、阴影和整体暖色调照明不变。',
  '将画面调整为黑白电影质感，保留原有构图。',
  '把招牌上的“稻穗”两个字改成“过海”，保持原有的字体风格、颜色、透视效果以及光照阴影不变，高清印刷质感。',
]

export function PromptEditor({ disabled }: { disabled?: boolean }) {
  const prompt = useApp((s) => s.prompt)
  const negative = useApp((s) => s.negativePrompt)
  const setDraft = useApp((s) => s.setDraft)
  const [showHistory, setShowHistory] = useState(false)

  const history = useQuery({
    queryKey: ['generations', 'prompt-history'],
    queryFn: () => api.listGenerations({ limit: 30 }),
    enabled: showHistory,
  })
  const pastPrompts = [...new Set(history.data?.items.map((g) => g.prompt) ?? [])].slice(0, 8)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="prompt">提示词</Label>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => setShowHistory((v) => !v)} disabled={disabled}>
            <History /> 历史
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDraft({ prompt: '' })} disabled={disabled || !prompt}>
            <X /> 清空
          </Button>
        </div>
      </div>
      <Textarea
        id="prompt"
        value={prompt}
        maxLength={MAX_LEN}
        disabled={disabled}
        onChange={(e) => setDraft({ prompt: e.target.value })}
        placeholder="描述你想如何编辑这张图片（支持中文和英文）"
        className="min-h-32 resize-y"
      />
      <div className="flex justify-end text-xs text-muted-foreground">
        {prompt.length} / {MAX_LEN}
      </div>

      {showHistory && (
        <div className="space-y-1 rounded-lg border p-2">
          <p className="px-1 text-xs text-muted-foreground">历史提示词</p>
          {history.isLoading && <p className="px-1 text-xs">加载中…</p>}
          {!history.isLoading && pastPrompts.length === 0 && <p className="px-1 text-xs">暂无历史记录</p>}
          {pastPrompts.map((p) => (
            <button
              key={p}
              className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted"
              onClick={() => {
                setDraft({ prompt: p })
                setShowHistory(false)
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            disabled={disabled}
            onClick={() => setDraft({ prompt: ex })}
            className="max-w-full truncate rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            title={ex}
          >
            {ex}
          </button>
        ))}
      </div>

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" />
          负面提示词
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Textarea
            value={negative}
            maxLength={MAX_LEN}
            disabled={disabled}
            onChange={(e) => setDraft({ negativePrompt: e.target.value })}
            placeholder="不希望出现的内容（可选）"
            className="mt-2 min-h-20 resize-y"
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
