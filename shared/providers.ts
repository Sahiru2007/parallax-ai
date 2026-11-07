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
