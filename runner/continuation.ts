import type { RecoveryInfo } from '../shared/providers.ts'

export interface PendingCall {
  key: string
  id?: string
  name: string
  args: Record<string, unknown>
}
export interface ToolReceipt extends PendingCall {
  status: 'prepared' | 'awaiting-approval' | 'running' | 'completed' | 'uncertain'
  beforeDigest: string
  afterDigest?: string
  result?: unknown
  approval?: {
    id: string
    executable: string
    args: string[]
    cwd: string
    detail: string
    decision?: boolean
  }
  checkId?: string
  processId?: number
  inspected?: string
  reusedFrom?: string
  approvalHistory?: NonNullable<ToolReceipt['approval']>[]
}
// Runner-private: includes provider-native context/signatures, never returned by session APIs.
export interface AgentCheckpoint {
  version: 1
  context?: unknown[]
  instructions?: string
  recoveryNote?: string
  inspection?: string
  pending?: {
    calls: PendingCall[]
    next: number
    results: { call: PendingCall; result: unknown }[]
  }
  ledger: ToolReceipt[]
  rounds: number
  allowance: number
  complete?: boolean
  sourceDigest: string
  proposalOnly?: boolean
  requests: number
  retry: {
    attempts: number
    totalAttempts: number
    allowanceWaitMs: number
    totalWaitMs: number
    notBefore?: number
  }
}
export interface Continuation {
  state: AgentCheckpoint
  save: () => Promise<void>
  onRecovery?: (info: RecoveryInfo) => void
}
export class RecoveryRequired extends Error {
  info: RecoveryInfo
  constructor(info: RecoveryInfo) {
    super(info.message)
    this.info = info
  }
}
export type DurableExecute = (
  name: string,
  args: Record<string, unknown>,
  key?: string,
) => Promise<unknown>
export async function drainPending(c: Continuation, execute: DurableExecute) {
  const pending = c.state.pending
  if (!pending) return []
  while (pending.next < pending.calls.length) {
    const call = pending.calls[pending.next]
    const result = await execute(call.name, call.args, call.key)
    pending.results.push({ call, result })
    pending.next++
    await c.save()
  }
  return pending.results
}
export async function preparePending(
  c: Continuation,
  calls: Omit<PendingCall, 'key'>[],
  round: number,
) {
  c.state.pending = {
    calls: calls.map((call, i) => ({ ...call, key: `round-${round}-call-${i}` })),
    next: 0,
    results: [],
  }
  await c.save()
}
