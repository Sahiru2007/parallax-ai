import { useCallback, useEffect, useRef, useState } from 'react'
import type { Investigation, RunnerConfig, Schedule } from '../../../shared/investigation'

export function useInvestigation() {
  const [config, setConfig] = useState<RunnerConfig | null>(null)
  const [session, setSession] = useState<Investigation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const currentId = useRef<string | null>(null)
  const runnerToken = useRef<string | null>(null)
  const accept = useCallback((next: Investigation, activate = false) => {
    if (activate) currentId.current = next.id
    if (currentId.current !== next.id) return
    setSession((previous) =>
      previous?.id === next.id && (previous.sequence ?? 0) > (next.sequence ?? 0) ? previous : next,
    )
  }, [])
  useEffect(() => {
    let active = true
    fetch('/api/config')
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Local runner unavailable. Start the project with npm run dev.')
        const data = (await response.json()) as RunnerConfig
        if (active) {
          runnerToken.current = data.token
          setConfig(data)
          const previous = localStorage.getItem('parallax-investigation')
          if (previous && /^[a-f0-9-]+$/.test(previous)) {
            const saved = await fetch(`/api/sessions/${previous}`)
            if (saved.ok && active && !currentId.current)
              accept((await saved.json()) as Investigation, true)
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
  }, [accept])
  useEffect(() => {
    if (!session?.id) return
    const events = new EventSource(`/api/sessions/${session.id}/events`)
    let active = true
    events.addEventListener('state', (event: MessageEvent<string>) => {
      if (!active) return
      accept(JSON.parse(event.data) as Investigation)
      setConnecting(false)
    })
    events.onerror = () => setConnecting(true)
    events.onopen = () => {
      setConnecting(false)
      // A restarted runner issues a new mutation token. Refresh it on SSE reconnect.
      void fetch('/api/config')
        .then(async (response) => {
          if (response.ok && active && currentId.current === session.id) {
            const next = (await response.json()) as RunnerConfig
            const restarted = runnerToken.current !== next.token
            runnerToken.current = next.token
            setConfig(next)
            if (restarted) {
              setSession((previous) =>
                previous?.id === session.id ? { ...previous, sequence: -1 } : previous,
              )
              const state = await fetch(`/api/sessions/${session.id}`)
              if (state.ok && active) accept((await state.json()) as Investigation)
            }
          }
        })
        .catch(() => {})
    }
    return () => {
      active = false
      events.close()
    }
  }, [session?.id, accept])
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
      accept(payload, path === '/api/sessions' || path.endsWith('/retry'))
      if (currentId.current === payload.id)
        localStorage.setItem('parallax-investigation', payload.id)
      return payload
    },
    [config, accept],
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
    retry: () => act(`/api/sessions/${session?.id}/retry`, {}),
    cleanup: () => act(`/api/sessions/${session?.id}/cleanup`, {}),
    newSession: () => {
      currentId.current = null
      localStorage.removeItem('parallax-investigation')
      setSession(null)
      setError(null)
    },
  }
}
