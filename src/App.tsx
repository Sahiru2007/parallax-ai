import { Component, Suspense, lazy, type ReactNode } from 'react'

const AgentWorkspace = lazy(() => import('./features/agent/AgentWorkspace'))
const LegacyApp = lazy(() => import('./LegacyApp'))

class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <div className="boot-screen">
          <h1>The workspace could not open.</h1>
          <p>Reload the page to reconnect to the local runner.</p>
          <button onClick={() => window.location.reload()}>Reload workspace</button>
        </div>
      )
    return this.props.children
  }
}
export default function App() {
  return (
    <WorkspaceBoundary>
      <Suspense fallback={<div className="boot-screen">Opening PARALLAX…</div>}>
        {window.location.pathname.startsWith('/legacy') ? <LegacyApp /> : <AgentWorkspace />}
      </Suspense>
    </WorkspaceBoundary>
  )
}
