import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useApp } from '@/store/app'

export function useServerSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity })
}

/** Applies server-stored preferences: theme always, default params on the very first run. */
export function useSyncServerSettings() {
  const { data } = useServerSettings()
  useEffect(() => {
    if (!data) return
    const st = useApp.getState()
    if (st.theme !== data.theme) st.setTheme(data.theme)
    if (!st.defaultsApplied) st.applyDefaults(data.default_params)
  }, [data])
}
