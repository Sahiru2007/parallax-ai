export type FutureId = 'jwt' | 'sessions' | 'managed'
export type Accent = 'violet' | 'cyan' | 'blue'
export type Screen =
  'dashboard' | 'explorer' | 'contracts' | 'mission' | 'timeline' | 'evidence' | 'settings'
export type TestStatus = 'passed' | 'failed' | 'pending'

export interface ExampleTest {
  id: string
  name: string
  status: TestStatus
  detail: string
}

export interface FileChange {
  path: string
  kind: 'added' | 'modified'
  additions: number
  deletions: number
  before: string
  after: string
}

export interface Future {
  id: FutureId
  letter: 'A' | 'B' | 'C'
  title: string
  subtitle: string
  accent: Accent
  description: string
  strategy: string[]
  tradeoff: string
  dependencies: { name: string; purpose: string }[]
  files: FileChange[]
  tests: ExampleTest[]
  architecture: string
}

export interface Contract {
  id: string
  title: string
  condition: string
  enabled: boolean
  category: 'Compatibility' | 'Security' | 'Experience'
}

export interface TimelineEvent {
  id: string
  time: string
  title: string
  description: string
  kind: 'objective' | 'branch' | 'contract' | 'evidence' | 'decision'
}

export interface Experiment {
  id: string
  name: string
  workspace: string
  objective: string
  source: 'mock'
  futures: Future[]
  contracts: Contract[]
  timeline: TimelineEvent[]
}
