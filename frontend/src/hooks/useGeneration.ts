import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, generationWsUrl, isTerminal, type Generation } from '@/lib/api'

/**
 * Tracks one generation task.
 * - REST is the source of truth (also restores state after a page reload; polls as a fallback).
 * - WebSocket pushes real-time updates into the same query cache and reconnects on drop.
 */
export function useGeneration(taskId: string | null) {
  const qc = useQueryClient()
  const key = ['generation', taskId]

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.getGeneration(taskId!),
    enabled: !!taskId,
    refetchInterval: (q) => {
      const g = q.state.data as Generation | undefined
      return g && isTerminal(g.status) ? false : 4000
    },
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 3,
  })

  const done = query.data ? isTerminal(query.data.status) : false

  useEffect(() => {
    if (!taskId || done) return
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let closed = false

    const connect = () => {
      ws = new WebSocket(generationWsUrl(taskId))
      ws.onopen = () => (attempt = 0)
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'task') {
          qc.setQueryData<Generation>(['generation', taskId], msg.task)
          if (isTerminal(msg.task.status)) qc.invalidateQueries({ queryKey: ['generations'] })
        }
      }
      ws.onclose = () => {
        if (closed) return
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000))
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [taskId, done, qc])

  return query
}
