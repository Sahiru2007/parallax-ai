export type VersionId = 'baseline' | 'a' | 'b'
export type RequestId = 'A' | 'B'
export type Schedule = [RequestId, RequestId]
export type RunStatus = 'passed' | 'failed' | 'error'
export interface TraceEvent {
  id: string
  kind: 'action' | 'response' | 'state'
  atMs: number
  label: string
  requestId: RequestId
  query: string
  payload?: string[]
  items?: string[]
  causedBy?: string
  screenshot?: string
  changed?: boolean
}
export interface ReplayResult {
  id: string
  attemptId?: string
  version: VersionId
  schedule: Schedule
  status: RunStatus
  events: TraceEvent[]
  finalItems: string[]
  expectedItems: string[]
  durationMs: number
  output: string
  error?: string
  command: string
}
export interface ToolEvent {
  id: number
  at: string
  kind: 'user' | 'agent' | 'read' | 'command' | 'worktree' | 'patch' | 'check' | 'error'
  title: string
  detail: string
}
export interface CheckResult {
  attemptId?: string
  version: VersionId
  command: string
  exitCode: number
  output: string
}
export interface Candidate {
  id: VersionId
  name: string
  strategy: string
  worktree?: string
  patch?: string
  patchOrigin: 'baseline' | 'prewritten' | 'model'
  ready: boolean
}
export interface Investigation {
  id: string
  sequence?: number
  attemptId?: string
  cleanedAt?: string
  task: string
  mode: 'sample' | 'live'
  status: 'running' | 'ready' | 'cancelled' | 'error'
  activity: string
  revision: string
  snapshot: string
  dirty: boolean
  capturedFiles: number
  createdAt: string
  selectedSchedule: Schedule
  busy: boolean
  events: ToolEvent[]
  candidates: Candidate[]
  runs: ReplayResult[]
  checks: CheckResult[]
  steering: string[]
  error?: string
}
export interface RunnerConfig {
  token: string
  repo: { id: string; name: string; path: string; revision: string; dirty: boolean }
  live: { configured: boolean; provider: string; model: string | null }
}
export const SAMPLE_TASK =
  'Fix the pickup search race: typing Col then Colombo lets the older response replace the latest suggestions. Reproduce it, compare two fixes, and save the delivery order as a regression.'
