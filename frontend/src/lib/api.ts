export type TaskStatus =
  | 'queued'
  | 'submitting'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export const TERMINAL: TaskStatus[] = ['succeeded', 'failed', 'cancelled']
export const isTerminal = (s: TaskStatus) => TERMINAL.includes(s)

export interface Upload {
  id: string
  original_name: string
  mime_type: string
  size_bytes: number
  width: number
  height: number
  created_at: string
  url: string
  thumbnail_url: string
}

export interface ImageAsset {
  id: string
  task_id: string
  width: number
  height: number
  size_bytes: number
  format: string
  created_at: string
  url: string
  thumbnail_url: string
}

export interface GenerationParams {
  seed: number
  steps: number
  cfg: number
  denoise: number
  resolution: number
  seed_mode: 'random' | 'fixed'
}

export interface Generation {
  id: string
  prompt_id: string | null
  upload_id: string
  prompt: string
  negative_prompt: string
  model: string
  generation_params: GenerationParams
  status: TaskStatus
  progress: number
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  upload: Upload
  images: ImageAsset[]
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface ParamSpec {
  default?: number
  min?: number
  max?: number
  step?: number
}

export interface ModelsInfo {
  model: string
  files: Record<string, string>
  params: Record<'resolution' | 'steps' | 'cfg' | 'denoise' | 'seed', ParamSpec>
}

export interface ComfyStatus {
  online: boolean
  url: string
  comfyui_version: string | null
  detail: string | null
}

export interface GenerationCreate {
  upload_id: string
  prompt: string
  negative_prompt: string
  seed: number | null
  steps: number
  cfg: number
  denoise: number
  resolution: number
}

export type ThemeSetting = 'light' | 'dark' | 'system'

export interface DefaultParams {
  steps: number
  cfg: number
  denoise: number
  resolution: number
  seed_mode: 'random' | 'fixed'
}

export interface Settings {
  theme: ThemeSetting
  default_params: DefaultParams
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const BASE = '/api/v1'

function detailToMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`)
      .join('；')
  }
  return '请求失败'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, init)
  } catch {
    throw new ApiError(0, '无法连接后端服务')
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      msg = detailToMessage((await res.json()).detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const api = {
  health: () => request<{ status: string; version: string }>('/health'),
  comfyStatus: () => request<ComfyStatus>('/comfyui/status'),
  models: () => request<ModelsInfo>('/models'),

  uploadImage: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Upload>('/uploads', { method: 'POST', body: form })
  },
  getUpload: (id: string) => request<Upload>(`/uploads/${id}`),
  deleteUpload: (id: string) => request<void>(`/uploads/${id}`, { method: 'DELETE' }),

  createGeneration: (body: GenerationCreate) => request<Generation>('/generations', json('POST', body)),
  listGenerations: (params: { limit?: number; offset?: number; q?: string; status?: TaskStatus } = {}) => {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)))
    return request<Page<Generation>>(`/generations?${qs}`)
  },
  getGeneration: (id: string) => request<Generation>(`/generations/${id}`),
  deleteGeneration: (id: string) => request<void>(`/generations/${id}`, { method: 'DELETE' }),
  getSettings: () => request<Settings>('/settings'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('/settings', json('PUT', patch)),
  cancelGeneration: (id: string) => request<Generation>(`/generations/${id}/cancel`, { method: 'POST' }),
  retryGeneration: (id: string, randomizeSeed = false) =>
    request<Generation>(`/generations/${id}/retry`, json('POST', { randomize_seed: randomizeSeed })),
}

export function generationWsUrl(taskId: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}${BASE}/ws/generations/${taskId}`
}
