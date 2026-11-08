import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodingConfig, CodingRepo, CodingSession } from '../../../shared/coding'
import type { ProviderSettings } from '../../../shared/providers'
import { nativeTransport } from './native-desktop'

export function useCoding() {
  const [config, setConfig] = useState<CodingConfig | null>(null)
  const [repo, setRepo] = useState<CodingRepo | null>(null)
  const [session, setSession] = useState<CodingSession | null>(null)
  const [history, setHistory] = useState<CodingSession[]>([])
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(true)
  const current = useRef<string | null>(null)
  const token = useRef('')
  const hasConfig = config !== null
  const accept = useCallback((state: CodingSession, activate = false) => {
    if (activate) {
      current.current = state.id
      localStorage.setItem('parallax-coding-session', state.id)
      setRepo(state.repo)
    }
    if (current.current !== state.id) return
    setSession((old) => (old?.id === state.id && old.sequence > state.sequence ? old : state))
  }, [])
  const refreshHistory = useCallback(async () => {
    const response = await fetch('/api/coding/sessions')
    if (response.ok) setHistory((await response.json()) as CodingSession[])
  }, [])
  const open = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/coding/sessions/${id}`)
      if (!response.ok) throw new Error('Saved coding session not found.')
      accept((await response.json()) as CodingSession, true)
    },
    [accept],
  )
  useEffect(() => {
    let active = true
    let retry: ReturnType<typeof setTimeout> | undefined
    async function initialize() {
      try {
        const response = await fetch('/api/coding/config', { signal: AbortSignal.timeout(1500) })
        if (!response.ok) throw new Error('Start the local runner with npm run dev.')
        const next = (await response.json()) as CodingConfig
        if (!active) return
        token.current = next.token
        if (!current.current) setRepo(next.defaultRepo)
        await refreshHistory()
        const previous = localStorage.getItem('parallax-coding-session')
        if (previous && !current.current && active)
          await open(previous).catch(() => {
            localStorage.removeItem('parallax-coding-session')
          })
        const selectedPath = localStorage.getItem('parallax-repo-path')
        if (!current.current && selectedPath && selectedPath !== next.defaultRepo?.path) {
          const restored = await fetch('/api/coding/repos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Parallax-Token': next.token },
            body: JSON.stringify({ path: selectedPath }),
          })
          if (active && !current.current) {
            if (restored.ok) setRepo((await restored.json()) as CodingRepo)
            else {
              setRepo(null)
              setError(
                'The previously selected repository is unavailable. Open a valid checkout before starting a task.',
              )
            }
          }
        }
        if (active) {
          setConfig(next)
          setConnecting(false)
        }
      } catch {
        if (active) {
          setConnecting(true)
          retry = setTimeout(() => void initialize(), 500)
        }
      }
    }
    void initialize()
    return () => {
      active = false
      clearTimeout(retry)
    }
  }, [open, refreshHistory])
  useEffect(() => {
    if (session?.id || !hasConfig) return
    let active = true,
      checking = false
    const timer = window.setInterval(async () => {
      if (checking) return
      checking = true
      try {
        const response = await fetch('/api/coding/config', { signal: AbortSignal.timeout(1500) })
        if (!response.ok) throw new Error('Runner unavailable')
        const next = (await response.json()) as CodingConfig
        if (active && !current.current) {
          token.current = next.token
          setConfig(next)
          setConnecting(false)
        }
      } catch {
        if (active) setConnecting(true)
      } finally {
        checking = false
      }
    }, 1000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [session?.id, hasConfig])
  useEffect(() => {
    if (!session?.id) return
    let active = true
    const id = session.id
    let source: EventSource | undefined
    let checking = false
    function connect() {
      if (nativeTransport()) return
      source = new EventSource(`/api/coding/sessions/${id}/events`)
      source.addEventListener('state', (event: MessageEvent<string>) => {
        if (active) accept(JSON.parse(event.data) as CodingSession)
      })
      source.onerror = () => {
        if (active) setConnecting(true)
      }
      source.onopen = () => {
        void synchronize()
      }
    }
    async function synchronize() {
      if (checking) return
      checking = true
      try {
        const response = await fetch('/api/coding/config', { signal: AbortSignal.timeout(1500) })
        if (!response.ok) throw new Error('Runner unavailable')
        const next = (await response.json()) as CodingConfig
        if (!active || current.current !== id) return
        if (token.current !== next.token) {
          // The last durable checkpoint may precede the last event received by this UI.
          setSession((old) => (old?.id === id ? { ...old, sequence: -1 } : old))
          const restored = (await (
            await fetch(`/api/coding/sessions/${id}`)
          ).json()) as CodingSession
          if (active) accept(restored)
          await refreshHistory()
        }
        token.current = next.token
        setConfig(next)
        if (nativeTransport()) {
          const state = await fetch(`/api/coding/sessions/${id}`)
          if (!state.ok) throw new Error('Retained session unavailable')
          if (active && current.current === id) accept((await state.json()) as CodingSession)
        }
        setConnecting(false)
        if (!source || source.readyState === EventSource.CLOSED) connect()
      } catch {
        if (active) {
          setConnecting(true)
          source?.close()
          source = undefined
        }
      } finally {
        checking = false
      }
    }
    connect()
    // A development proxy can keep an SSE socket open after its upstream process dies.
    // Polling health detects that case and reopens the stream after runner recovery.
    const heartbeat = window.setInterval(
      () => {
        void synchronize()
      },
      nativeTransport() ? 350 : 1000,
    )
    return () => {
      active = false
      source?.close()
      clearInterval(heartbeat)
    }
  }, [session?.id, accept, refreshHistory])
  const request = useCallback(async (path: string, data: unknown) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Parallax-Token': token.current },
      body: JSON.stringify(data),
    })
    const result = (await response.json()) as CodingSession & CodingRepo & { error?: string }
    if (!response.ok) throw new Error(result.error ?? 'Runner request failed.')
    return result
  }, [])
  const action = useCallback(
    async (path: string, data: unknown, activate = false) => {
      setError('')
      try {
        const state = await request(path, data)
        accept(state, activate)
        await refreshHistory()
        return state
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : String(problem))
        return null
      }
    },
    [accept, request, refreshHistory],
  )
  useEffect(() => {
    if (!session || session.busy) return
    const timer = window.setInterval(() => {
      void request(`/api/coding/sessions/${session.id}/review`, {})
        .then((state) => accept(state))
        .catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [session?.id, session?.busy, request, accept, session])
  return {
    config,
    repo,
    session,
    history,
    error,
    connecting,
    open,
    configureProvider: async (data: Record<string, unknown>) => {
      const response = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Parallax-Token': token.current },
        body: JSON.stringify(data),
      })
      const result = (await response.json()) as ProviderSettings & { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Provider settings failed.')
      setConfig((old) => (old ? { ...old, providers: result } : old))
      return result
    },
    openRepo: async (path: string) => {
      setError('')
      try {
        const value = await request('/api/coding/repos', { path })
        setRepo(value)
        localStorage.setItem('parallax-repo-path', value.path)
        return value
      } catch (problem) {
        setError(String(problem))
        return null
      }
    },
    start: (
      task: string,
      provider: 'live' | 'test',
      compare: boolean,
      investigate = false,
      sequential = false,
    ) =>
      action(
        '/api/coding/sessions',
        {
          path: repo?.path,
          task,
          provider,
          compare,
          investigate,
          modelSelection: config?.providers?.selection,
          sequential,
        },
        true,
      ),
    saveScenario: (scenario: unknown, baseDigest = session?.projectReplay?.saved?.digest ?? null) =>
      action(`/api/coding/sessions/${session?.id}/replay/scenario`, { scenario, baseDigest }),
    replayProject: (order: string[], version: string) =>
      action(`/api/coding/sessions/${session?.id}/replay/run`, { order, version }),
    generateFixes: (sequential = false) =>
      action(`/api/coding/sessions/${session?.id}/replay/fixes`, { sequential }),
    resume: (runId: string, additional?: number) =>
      action(`/api/coding/sessions/${session?.id}/resume`, { runId, additional }),
    resolveTool: (runId: string, callId: string, decision: string) =>
      action(`/api/coding/sessions/${session?.id}/resolve-tool`, { runId, callId, decision }),
    generateNext: (candidate: string) =>
      action(`/api/coding/sessions/${session?.id}/generate-next`, { candidate }),
    proposeReplay: () => action(`/api/coding/sessions/${session?.id}/replay/propose`, {}),
    followup: (message: string) =>
      action(`/api/coding/sessions/${session?.id}/followup`, { message }),
    approve: (approved: boolean) =>
      action(`/api/coding/sessions/${session?.id}/approve`, {
        requestId: session?.approval?.id,
        approved,
      }),
    cancel: () => action(`/api/coding/sessions/${session?.id}/cancel`, {}),
    review: () => action(`/api/coding/sessions/${session?.id}/review`, {}),
    apply: (candidate: string, target: string) =>
      action(`/api/coding/sessions/${session?.id}/apply`, { candidate, target }),
    newSession: () => {
      current.current = null
      setSession(null)
      localStorage.removeItem('parallax-coding-session')
      setError('')
    },
  }
}
