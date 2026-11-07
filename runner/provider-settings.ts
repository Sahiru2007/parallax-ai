import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  ModelSelection,
  ProviderCheck,
  ProviderSettings,
  ProviderId,
} from '../shared/providers.ts'
import { WindowsCredentialStore, type CredentialStore } from './credentials.ts'
import { rememberSecret } from './provider-secrets.ts'
import { runLiveAgent } from './provider.ts'
import { runOllamaAgent } from './ollama-provider.ts'
import { geminiModels, runGeminiAgent } from './gemini-provider.ts'

export function localOllamaURL(value: unknown) {
  if (typeof value !== 'string') throw new Error('Enter a loopback Ollama URL.')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter an HTTP loopback URL such as http://127.0.0.1:11434.')
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Ollama must use a loopback HTTP origin without a path, credentials, or query.')
  return url.origin
}
const check = (ok: boolean, message: string): ProviderCheck => ({
  ok,
  message,
  at: new Date().toISOString(),
})
const initial = (): ProviderSettings => ({
  maxToolRounds: 12,
  selection: null,
  gemini: {
    keySource: 'none',
    credentialStore: process.platform === 'win32',
    models: [],
    checks: {},
  },
  openai: {
    keySource: 'none',
    credentialStore: process.platform === 'win32',
    models: [],
    checks: {},
  },
  ollama: { endpoint: 'http://127.0.0.1:11434', models: [], checks: {} },
  testTransport: false,
})
export class ProviderSettingsStore {
  file: string
  credentials: CredentialStore
  geminiCredentials: CredentialStore
  state = initial()
  useEnvironment = true
  useGeminiEnvironment = true
  openaiBase = 'https://api.openai.com/v1'
  geminiBase = 'https://generativelanguage.googleapis.com/v1beta'
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    file: string,
    credentials: CredentialStore = new WindowsCredentialStore(),
    geminiCredentials: CredentialStore = new WindowsCredentialStore('PARALLAX AI/Gemini'),
  ) {
    this.file = file
    this.credentials = credentials
    this.geminiCredentials = geminiCredentials
    if (process.env.PARALLAX_ENABLE_TEST_PROVIDER === '1' && process.env.PARALLAX_GEMINI_TEST_URL) {
      this.geminiBase = localOllamaURL(process.env.PARALLAX_GEMINI_TEST_URL) + '/v1beta'
      this.state.testTransport = true
    }
    if (process.env.PARALLAX_ENABLE_TEST_PROVIDER === '1' && process.env.PARALLAX_OPENAI_TEST_URL) {
      this.openaiBase = localOllamaURL(process.env.PARALLAX_OPENAI_TEST_URL) + '/v1'
      this.state.testTransport = true
    }
  }
  async restore() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'))
      this.useEnvironment = data.useEnvironment !== false
      this.useGeminiEnvironment = data.useGeminiEnvironment !== false
      this.state.maxToolRounds =
        Number.isInteger(data.maxToolRounds) && data.maxToolRounds >= 2 && data.maxToolRounds <= 24
          ? data.maxToolRounds
          : 12
      this.state.selection = data.selection ?? null
      this.state.ollama = { ...this.state.ollama, ...data.ollama }
      this.state.ollama.endpoint = localOllamaURL(this.state.ollama.endpoint)
      // Readiness is tested again after a runner restart; saved model choices remain visible.
      this.state.ollama.checks = {}
      this.state.openai.models = data.openaiModels ?? []
      this.state.gemini.models = data.geminiModels ?? []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.state.openai.connection = check(
          false,
          'Saved provider settings could not be read. Reconfigure providers.',
        )
    }
    await this.refreshKeySource().catch(() => {
      this.state.openai.connection = check(
        false,
        'Windows Credential Manager could not be read. Check your Windows account access and retry in settings.',
      )
    })
    await this.refreshKeySource('gemini').catch(() => {
      this.state.gemini.connection = check(
        false,
        'Windows Credential Manager could not be read. Check Windows account access and retry in settings.',
      )
    })
    if (
      !this.state.selection &&
      this.state.openai.keySource === 'environment' &&
      process.env.PARALLAX_MODEL
    )
      this.state.selection = { provider: 'openai', model: process.env.PARALLAX_MODEL }
  }
  private cloudCredentials(provider: 'openai' | 'gemini') {
    return provider === 'gemini' ? this.geminiCredentials : this.credentials
  }
  private environmentKey(provider: 'openai' | 'gemini') {
    return provider === 'gemini'
      ? this.useGeminiEnvironment && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
      : this.useEnvironment && process.env.OPENAI_API_KEY
  }
  private setEnvironment(provider: 'openai' | 'gemini', value: boolean) {
    if (provider === 'gemini') this.useGeminiEnvironment = value
    else this.useEnvironment = value
  }
  async refreshKeySource(provider: 'openai' | 'gemini' = 'openai') {
    const credentials = this.cloudCredentials(provider),
      current = this.state[provider]
    current.credentialStore = credentials.available
    const saved = credentials.available ? await credentials.get() : null
    rememberSecret(saved)
    current.keySource = saved
      ? 'credential-store'
      : this.environmentKey(provider)
        ? 'environment'
        : 'none'
  }
  async key(provider: 'openai' | 'gemini' = 'openai') {
    const credentials = this.cloudCredentials(provider)
    const stored = credentials.available ? await credentials.get() : null
    const key = stored || this.environmentKey(provider)
    if (!key)
      throw new Error(
        `${provider === 'gemini' ? 'Gemini' : 'OpenAI'} has no API key. Open Manage providers to connect it.`,
      )
    rememberSecret(key)
    return key
  }
  snapshot(): ProviderSettings {
    return structuredClone(this.state)
  }
  async persist() {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(
      this.file + '.tmp',
      JSON.stringify(
        {
          selection: this.state.selection,
          useEnvironment: this.useEnvironment,
          useGeminiEnvironment: this.useGeminiEnvironment,
          maxToolRounds: this.state.maxToolRounds,
          openaiModels: this.state.openai.models,
          geminiModels: this.state.gemini.models,
          ollama: {
            endpoint: this.state.ollama.endpoint,
            models: this.state.ollama.models,
            checks: {},
          },
        },
        null,
        2,
      ),
    )
    await rename(this.file + '.tmp', this.file)
  }
  async handle(data: Record<string, unknown>) {
    const task = this.queue.catch(() => {}).then(() => this.update(data))
    this.queue = task
    return task
  }
  private async update(data: Record<string, unknown>) {
    if (data.action === 'round-limit') {
      if (!Number.isInteger(data.limit) || Number(data.limit) < 2 || Number(data.limit) > 24)
        throw new Error('Agent round limit must be an integer from 2 to 24.')
      this.state.maxToolRounds = Number(data.limit)
      if (this.state.selection) this.state.selection.maxToolRounds = this.state.maxToolRounds
      await this.persist()
      return this.snapshot()
    }
    const provider = data.provider
    if (provider !== 'gemini' && provider !== 'openai' && provider !== 'ollama')
      throw new Error('Choose Gemini, OpenAI, or Ollama.')
    const current = this.state[provider]
    if (data.action === 'save-key' && provider !== 'ollama') {
      if (
        typeof data.key !== 'string' ||
        data.key.length < 8 ||
        data.key.length > 2000 ||
        /\s/.test(data.key)
      )
        throw new Error('Enter a valid API key without spaces (8–2000 characters).')
      rememberSecret(data.key)
      await this.cloudCredentials(provider).set(data.key)
      this.setEnvironment(provider, false)
      current.models = []
      current.checks = {}
      current.connection = undefined
      await this.refreshKeySource(provider)
    } else if (data.action === 'remove-key' && provider !== 'ollama') {
      await this.cloudCredentials(provider).remove()
      this.setEnvironment(provider, false)
      current.models = []
      current.checks = {}
      current.connection = undefined
      await this.refreshKeySource(provider)
    } else if (data.action === 'use-environment' && provider !== 'ollama') {
      await this.cloudCredentials(provider).remove()
      this.setEnvironment(provider, true)
      current.checks = {}
      await this.refreshKeySource(provider)
    } else if (data.action === 'endpoint' && provider === 'ollama') {
      this.state.ollama = { endpoint: localOllamaURL(data.endpoint), models: [], checks: {} }
    } else if (data.action === 'connection') {
      try {
        if (provider === 'gemini') {
          current.models = await geminiModels(await this.key('gemini'), this.geminiBase)
        } else if (provider === 'openai') {
          const key = await this.key()
          const response = await fetch(this.openaiBase + '/models', {
            headers: { Authorization: `Bearer ${key}` },
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          })
          if (!response.ok)
            throw new Error(
              `OpenAI connection failed (HTTP ${response.status}). Check the key, network, and account permissions.`,
            )
          const payload = (await response.json()) as { data?: { id: string }[] }
          if (!Array.isArray(payload.data))
            throw new Error('OpenAI returned an invalid model catalog.')
          current.models = payload.data
            .map((m) => m.id)
            .filter((m) => typeof m === 'string' && m.length < 200)
            .sort()
        } else {
          const response = await fetch(this.state.ollama.endpoint + '/api/tags', {
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          })
          if (!response.ok) throw new Error(`Ollama connection failed (HTTP ${response.status}).`)
          const payload = (await response.json()) as { models?: { name: string }[] }
          if (!Array.isArray(payload.models))
            throw new Error('Ollama returned an invalid installed-model list.')
          current.models = payload.models
            .map((m) => m.name)
            .filter((m) => typeof m === 'string' && !m.endsWith(':cloud'))
            .sort()
        }
        current.checks = {}
        current.connection = check(
          true,
          current.models.length
            ? `Connected. ${current.models.length} models listed. Coding-agent tool check has not run.`
            : provider === 'ollama'
              ? 'Connected, but no local models are installed. Install a local model in Ollama, then test again.'
              : 'Connected, but this account returned no models.',
        )
      } catch (error) {
        current.models = []
        current.checks = {}
        current.connection = check(
          false,
          error instanceof Error &&
            !['fetch failed', 'This operation was aborted due to timeout'].includes(error.message)
            ? error.message
            : provider === 'ollama'
              ? 'Ollama is unreachable. Start the local server and verify its loopback URL.'
              : `${provider === 'gemini' ? 'Gemini' : 'OpenAI'} is unreachable. Check your network and retry.`,
        )
      }
    } else if (data.action === 'agent-check') {
      const selection = this.selectionFrom(provider, data.model)
      try {
        let called = 0,
          returned = false,
          invalid = false
        const execute = async (name: string, args: Record<string, unknown>) => {
          if (name !== 'parallax_probe' || args.value !== 'parallax-ready') {
            invalid = true
            throw new Error('Unexpected tool call.')
          }
          called++
          return { result: 'parallax-acknowledged' }
        }
        const onText = (text: string) => {
          if (text.includes('parallax-acknowledged')) returned = true
        }
        const tools = [
          {
            type: 'function',
            name: 'parallax_probe',
            description:
              'Harmless in-memory capability check. No file, command, or network access.',
            strict: true,
            parameters: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
              additionalProperties: false,
            },
          },
        ]
        const options = {
          task: 'Call parallax_probe exactly once with value "parallax-ready". After receiving its result, reply with the exact result string.',
          strategy: 'Readiness check',
          signal: AbortSignal.timeout(90000),
          steering: () => [],
          execute,
          onText,
          tools,
          maxTurns: 3,
          instructions: 'Perform only the requested harmless tool check. No repository is open.',
          model: selection.model,
        }
        if (provider === 'gemini')
          await runGeminiAgent({
            ...options,
            apiKey: await this.key('gemini'),
            baseURL: this.geminiBase,
          })
        else if (provider === 'openai')
          await runLiveAgent({ ...options, apiKey: await this.key(), baseURL: this.openaiBase })
        else await runOllamaAgent({ ...options, endpoint: selection.endpoint! })
        if (called !== 1 || !returned || invalid)
          throw new Error('Model did not complete the tool-call/result round trip.')
        current.checks[selection.model] = check(
          true,
          'Harmless tool-call round trip passed. Ready for coding; project edits/checks have not been tested.',
        )
      } catch (error) {
        current.checks[selection.model] = check(
          false,
          `Coding-agent check failed. ${error instanceof Error ? error.message : 'Retry with a tool-capable model.'}`,
        )
      }
    } else if (data.action === 'select') {
      this.state.selection = this.selectionFrom(provider, data.model)
    } else throw new Error('Unknown provider settings action.')
    await this.persist()
    return this.snapshot()
  }
  selectionFrom(provider: ProviderId, model: unknown): ModelSelection {
    if (typeof model !== 'string' || !model || model.length > 200)
      throw new Error('Select a model.')
    if (
      !this.state[provider].models.includes(model) &&
      !(
        provider === 'openai' &&
        model === process.env.PARALLAX_MODEL &&
        this.state.openai.keySource === 'environment'
      )
    )
      throw new Error('Model is not in the available list. Test the connection again.')
    return {
      provider,
      model,
      maxToolRounds: this.state.maxToolRounds,
      ...(provider === 'ollama' ? { endpoint: this.state.ollama.endpoint } : {}),
      ...(this.state.testTransport ? { testDouble: true } : {}),
    }
  }
  assertReady(selection: ModelSelection) {
    if (Boolean(selection.testDouble) !== this.state.testTransport)
      throw new Error(
        'This session belongs to a different live/test provider transport. Reopen it with its original provider configuration.',
      )
    if (
      selection.provider !== 'gemini' &&
      selection.provider !== 'openai' &&
      selection.provider !== 'ollama'
    )
      throw new Error('Choose a provider in Manage providers.')
    if (selection.provider === 'ollama' && selection.endpoint !== this.state.ollama.endpoint)
      throw new Error(
        'This session uses a different Ollama endpoint. Restore it in Manage providers; cloud fallback is disabled.',
      )
    if (
      !this.state[selection.provider].checks[selection.model]?.ok &&
      !(
        selection.provider === 'openai' &&
        this.state.openai.keySource === 'environment' &&
        selection.model === process.env.PARALLAX_MODEL
      )
    )
      throw new Error(
        'Run the coding-agent tool check for this provider/model in Manage providers before coding. Connection success alone is insufficient.',
      )
  }
}
