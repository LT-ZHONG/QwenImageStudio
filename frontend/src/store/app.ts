import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Generation } from '@/lib/api'

export type ThemeMode = 'light' | 'dark' | 'system'

export const DEFAULT_PROMPT = '移除画面中的人物，保持背景环境、光照和构图自然一致。'

interface Draft {
  prompt: string
  negativePrompt: string
  seedMode: 'random' | 'fixed'
  seed: number
  steps: number
  cfg: number
  denoise: number
  resolution: number
}

interface AppState extends Draft {
  theme: ThemeMode
  sidebarCollapsed: boolean
  uploadId: string | null
  activeTaskId: string | null

  setDraft: (patch: Partial<Draft>) => void
  setTheme: (t: ThemeMode) => void
  toggleSidebar: () => void
  setUploadId: (id: string | null) => void
  setActiveTaskId: (id: string | null) => void
  /** Copy a past task's prompt/params back into the creation form. */
  reuseParams: (g: Generation, opts?: { keepSeed?: boolean }) => void
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      uploadId: null,
      activeTaskId: null,
      prompt: DEFAULT_PROMPT,
      negativePrompt: '',
      seedMode: 'random',
      seed: 0,
      steps: 25,
      cfg: 1,
      denoise: 1,
      resolution: 1024,

      setDraft: (patch) => set(patch),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setUploadId: (uploadId) => set({ uploadId }),
      setActiveTaskId: (activeTaskId) => set({ activeTaskId }),
      reuseParams: (g, opts) =>
        set({
          prompt: g.prompt,
          negativePrompt: g.negative_prompt,
          steps: g.generation_params.steps,
          cfg: g.generation_params.cfg,
          denoise: g.generation_params.denoise,
          resolution: g.generation_params.resolution,
          ...(opts?.keepSeed
            ? { seedMode: 'fixed' as const, seed: g.generation_params.seed }
            : { seedMode: g.generation_params.seed_mode }),
        }),
    }),
    { name: 'qwen-image-studio', version: 1 },
  ),
)
