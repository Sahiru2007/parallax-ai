import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { useAppStore } from './stores/useAppStore'
import { useExperiment } from './hooks/useExperiment'
import { AppShell } from './layouts/AppShell'
import { Button, Logo } from './components/ui'

const Dashboard = lazy(() =>
  import('./features/dashboard/Dashboard').then((m) => ({ default: m.Dashboard })),
)
const FutureExplorer = lazy(() =>
  import('./features/explorer/FutureExplorer').then((m) => ({ default: m.FutureExplorer })),
)
const ContractStudio = lazy(() =>
  import('./features/contracts/ContractStudio').then((m) => ({ default: m.ContractStudio })),
)
const MissionControl = lazy(() =>
  import('./features/mission/MissionControl').then((m) => ({ default: m.MissionControl })),
)
const DevelopmentTimeline = lazy(() =>
  import('./features/timeline/DevelopmentTimeline').then((m) => ({
    default: m.DevelopmentTimeline,
  })),
)
const EvidenceInspector = lazy(() =>
  import('./features/evidence/EvidenceInspector').then((m) => ({ default: m.EvidenceInspector })),
)
const Settings = lazy(() =>
  import('./features/settings/Settings').then((m) => ({ default: m.Settings })),
)

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() {
    return { error: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PARALLAX render error', error, info.componentStack)
  }
  render() {
    return this.state.error ? (
      <div className="boot-screen">
        <Logo />
        <h1>Something interrupted this workspace.</h1>
        <p>Reload to try again. Your saved preferences remain in this browser.</p>
        <Button onClick={() => window.location.reload()}>Reload workspace</Button>
      </div>
    ) : (
      this.props.children
    )
  }
}

function Workspace() {
  const { experiment, error } = useExperiment()
  const screen = useAppStore((state) => state.screen)
  const reduceMotion = useAppStore((state) => state.reduceMotion)
  if (error)
    return (
      <div className="boot-screen" role="alert">
        <Logo />
        <p>{error}</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    )
  if (!experiment)
    return (
      <div className="boot-screen">
        <Logo />
        <p>Opening your multiverse…</p>
      </div>
    )
  const screens = {
    dashboard: <Dashboard experiment={experiment} />,
    explorer: <FutureExplorer experiment={experiment} />,
    contracts: <ContractStudio />,
    mission: <MissionControl />,
    timeline: <DevelopmentTimeline experiment={experiment} />,
    evidence: <EvidenceInspector experiment={experiment} />,
    settings: <Settings />,
  }
  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <div className={reduceMotion ? 'reduce-motion' : ''}>
        <AppShell experiment={experiment}>
          <Suspense fallback={<div className="empty-state">Opening perspective…</div>}>
            {screens[screen] ?? screens.explorer}
          </Suspense>
        </AppShell>
      </div>
    </MotionConfig>
  )
}

export default function App() {
  return (
    <AppErrorBoundary>
      <Workspace />
    </AppErrorBoundary>
  )
}
