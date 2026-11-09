export type ProviderId = 'gemini' | 'openai' | 'ollama'
export const providerName = (id: ProviderId) =>
  ({ gemini: 'Google Gemini', openai: 'OpenAI', ollama: 'Ollama' })[id]
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  thoughtTokens?: number
  cachedTokens?: number
  totalTokens?: number
}
export interface AgentProgress {
  onRound?: (round: number, limit: number) => void
  onUsage?: (usage: TokenUsage) => void
  onDelta?: (text: string) => void
  onRequest?: (size: RequestSize) => void
}
export interface RequestSize {
  round: number
  bytes: number
  systemBytes: number
  schemaBytes: number
  modelBytes: number
  userBytes: number
  toolBytes: { files: number; search: number; commands: number; other: number }
  toolResponses: number
  messages: number
}
export interface ModelSelection {
  provider: ProviderId
  model: string
  endpoint?: string
  testDouble?: boolean
  maxToolRounds?: number
}
export interface ProviderRun extends ModelSelection {
  id: string
  turn: number
  candidate: string
  startedAt: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  actualModel?: string
  rounds?: number
  toolCalls?: number
  usage?: TokenUsage
  recovery?: RecoveryInfo
  recoveryHistory?: RecoveryInfo[]
  continuations?: number
  requests?: number
  autoRetries?: number
  waitedMs?: number
  resumable?: boolean
  legacyRecovery?: boolean
  checkpointed?: boolean
  requestSizes?: RequestSize[]
  calls?: {
    id: string
    name: string
    status: string
    detail?: string
    approval?: string
    approvalHistory?: { id: string; command: string; cwd: string; decision: string }[]
  }[]
}
export interface RecoveryInfo {
  at?: string
  kind:
    | 'rate-limit'
    | 'unavailable'
    | 'quota'
    | 'unknown-429'
    | 'limit'
    | 'cancelled'
    | 'restart'
    | 'uncertain'
    | 'provider'
  message: string
  retryAfterMs?: number
  retryAt?: number
  waiting?: boolean
  attempt?: number
  maxRetries?: number
  maxWaitMs?: number
}
export interface ProviderCheck {
  ok: boolean
  message: string
  at: string
}
export interface ProviderSettings {
  maxToolRounds: number
  selection: ModelSelection | null
  gemini: ProviderSettings['openai']
  openai: {
    keySource: 'credential-store' | 'environment' | 'none'
    credentialStore: boolean
    models: string[]
    connection?: ProviderCheck
    checks: Record<string, ProviderCheck>
  }
  ollama: {
    endpoint: string
    models: string[]
    connection?: ProviderCheck
    checks: Record<string, ProviderCheck>
  }
  testTransport: boolean
}
