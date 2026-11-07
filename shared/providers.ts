export type ProviderId = 'openai' | 'ollama'
export interface ModelSelection {
  provider: ProviderId
  model: string
  endpoint?: string
  testDouble?: boolean
}
export interface ProviderRun extends ModelSelection {
  id: string
  turn: number
  candidate: string
  startedAt: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  actualModel?: string
}
export interface ProviderCheck {
  ok: boolean
  message: string
  at: string
}
export interface ProviderSettings {
  selection: ModelSelection | null
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
