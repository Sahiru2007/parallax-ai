import { useCallback, useEffect, useState } from 'react'
import type { Investigation, RunnerConfig, Schedule } from '../../../shared/investigation'

export function useInvestigation() {
  const [config, setConfig] = useState<RunnerConfig | null>(null)
  const [session, setSession] = useState<Investigation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  useEffect(() => {
    let active = true
    fetch('/api/config')
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Local runner unavailable. Start the project with npm run dev.')
        const data = (await response.json()) as RunnerConfig
        if (active) {
          setConfig(data)
          const previous = localStorage.getItem('parallax-investigation')
          if (previous && /^[a-f0-9-]+$/.test(previous)) {
            const saved = await fetch(`/api/sessions/${previous}`)
            if (saved.ok && active) setSession((await saved.json()) as Investigation)
            else localStorage.removeItem('parallax-investigation')
          }
        }
      })
      .catch(() => {
        if (active)
          setError(
            'Local runner unavailable. Start the project with npm run dev, then refresh this page.',
          )
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!session?.id) return
    const events = new EventSource(`/api/sessions/${session.id}/events`)
    events.addEventListener('state', (event: MessageEvent<string>) => {
      setSession(JSON.parse(event.data) as Investigation)
      setConnecting(false)
    })
    events.onerror = () => setConnecting(true)
    events.onopen = () => setConnecting(false)
    return () => events.close()
  }, [session?.id])
  const post = useCallback(
    async (path: string, data: unknown) => {
      if (!config) throw new Error('The local runner is not connected.')
      setError(null)
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Parallax-Token': config.token },
        body: JSON.stringify(data),
      })
      const payload = (await response.json()) as Investigation & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'The runner request failed.')
      setSession(payload)
      localStorage.setItem('parallax-investigation', payload.id)
      return payload
    },
    [config],
  )
  const act = useCallback(
    async (path: string, data: unknown) => {
      try {
        return await post(path, data)
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : String(problem))
        return null
      }
    },
    [post],
  )
  return {
    config,
    session,
    error,
    connecting,
    clearError: () => setError(null),
    start: (task: string, mode: 'sample' | 'live') =>
      act('/api/sessions', { task, mode, repo: 'current' }),
    steer: (message: string) => act(`/api/sessions/${session?.id}/steer`, { message }),
    cancel: () => act(`/api/sessions/${session?.id}/cancel`, {}),
    replay: (order: Schedule) => act(`/api/sessions/${session?.id}/replay`, { order }),
    newSession: () => {
      localStorage.removeItem('parallax-investigation')
      setSession(null)
      setError(null)
    },
  }
}
