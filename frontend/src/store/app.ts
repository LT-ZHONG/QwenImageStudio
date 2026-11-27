import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DefaultParams, Generation } from '@/lib/api'

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
  /** When uploadId is a marked-up copy, the clean original it was made from (for re-editing / clearing marks). */
  originalUploadId: string | null
  /** Colour names used by the marks on the current marked upload (for prompt wording). */
  markColors: string[]
  activeTaskId: string | null
  /** true once the server-side default params were copied into the draft (first run only) */
  defaultsApplied: boolean

  setDraft: (patch: Partial<Draft>) => void
  setTheme: (t: ThemeMode) => void
  toggleSidebar: () => void
  setUploadId: (id: string | null) => void
  setMarkedUpload: (markedId: string, originalId: string, colors?: string[]) => void
  clearMarks: () => void
  setActiveTaskId: (id: string | null) => void
  applyDefaults: (d: DefaultParams) => void
  /** Copy a past task's prompt/params back into the creation form. */
  reuseParams: (g: Generation, opts?: { keepSeed?: boolean }) => void
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      uploadId: null,
      originalUploadId: null,
      markColors: ['红色'],
      activeTaskId: null,
      defaultsApplied: false,
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
      setUploadId: (uploadId) => set({ uploadId, originalUploadId: null }),
      setMarkedUpload: (uploadId, originalUploadId, colors) =>
        set({ uploadId, originalUploadId, markColors: colors?.length ? colors : ['红色'] }),
      clearMarks: () => set((s) => ({ uploadId: s.originalUploadId ?? s.uploadId, originalUploadId: null })),
      setActiveTaskId: (activeTaskId) => set({ activeTaskId }),
      applyDefaults: (d) =>
        set({
          steps: d.steps,
          cfg: d.cfg,
          denoise: d.denoise,
          resolution: d.resolution,
          seedMode: d.seed_mode,
          defaultsApplied: true,
        }),
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
