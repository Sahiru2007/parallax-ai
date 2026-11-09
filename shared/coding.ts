import type { ToolEvent } from './investigation.ts'
import type { ProjectReplayState } from './project-replay.ts'
import type { ModelSelection, ProviderRun, ProviderSettings } from './providers.ts'

export interface CodingRepo {
  id: string
  path: string
  name: string
  branch: string
  revision: string
  dirty: boolean
}
export interface FileChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
  patch: string
}
export interface CodingCheck {
  id: string
  candidate: string
  turn: number
  command: string
  cwd: string
  digest: string
  status: 'passed' | 'failed' | 'skipped' | 'running'
  output: string
  exitCode?: number
  outputChars?: number
  fullOutput?: boolean
  modelSummary?: { testStats?: unknown; highlights: string[] }
}
export interface CodingCandidate {
  id: string
  name: string
  worktree: string
  digest: string
  patch: string
  files: FileChange[]
}
export interface CommandApproval {
  id: string
  candidate: string
  executable: string
  args: string[]
  cwd: string
  detail: string
}
export interface CodingSession {
  id: string
  sequence: number
  repo: CodingRepo
  baseline: { revision: string; digest: string; dirty: boolean }
  provider: 'live' | 'test'
  modelSelection?: ModelSelection
  providerRuns?: ProviderRun[]
  compare: boolean
  investigation?: boolean
  projectReplay?: ProjectReplayState
  status: 'running' | 'ready' | 'interrupted' | 'cancelled' | 'error'
  activity: string
  busy: boolean
  turn: number
  createdAt: string
  messages: { role: 'user' | 'assistant'; content: string; turn: number; candidate?: string }[]
  events: ToolEvent[]
  checks: CodingCheck[]
  candidates: CodingCandidate[]
  approval?: CommandApproval
  error?: string
  sequential?: boolean
  generation?: { turn: number; queued: string[] }
  applied?: { path: string; digest: string; at: string }
}
export interface CodingConfig {
  token: string
  live: { configured: boolean; provider: string; model: string | null }
  testProvider: boolean
  defaultRepo: CodingRepo | null
  providers?: ProviderSettings
}
