import { rememberSecret, redactSecrets } from './provider-secrets.ts'
interface FunctionCall {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}
interface Message {
  type: 'message'
  content: { type: string; text?: string }[]
}
interface ResponseOutput {
  model?: string
  output: (FunctionCall | Message | { type: string })[]
  error?: { message: string }
}
const fields = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const string = { type: 'string' }
const tools = [
  {
    type: 'function',
    name: 'list_files',
    description: 'List the repository snapshot files.',
    strict: true,
    parameters: fields({}),
  },
  {
    type: 'function',
    name: 'read_file',
    description: 'Read a source file from this candidate worktree.',
    strict: true,
    parameters: fields({ path: string }),
  },
  {
    type: 'function',
    name: 'write_file',
    description:
      'Update the pickup-search useAddressSearch.ts hook in this candidate worktree. The shared harness is immutable.',
    strict: true,
    parameters: fields({ path: string, content: string }),
  },
  {
    type: 'function',
    name: 'run_checks',
    description:
      'Run actual type checks and both response-order browser assertions against this candidate.',
    strict: true,
    parameters: fields({}),
  },
  {
    type: 'function',
    name: 'inspect_diff',
    description: 'Read the actual Git patch against the baseline snapshot.',
    strict: true,
    parameters: fields({}),
  },
]
export function providerState() {
  return {
    configured: Boolean(process.env.OPENAI_API_KEY && process.env.PARALLAX_MODEL),
    provider: 'OpenAI Responses API',
    model: process.env.PARALLAX_MODEL ?? null,
  }
}
export async function runLiveAgent(options: {
  task: string
  strategy: string
  signal: AbortSignal
  steering: () => string[]
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>
  onText: (text: string) => void
  instructions?: string
  tools?: unknown[]
  history?: { role: 'user' | 'assistant'; content: string }[]
  maxTurns?: number
  model?: string
  apiKey?: string
  baseURL?: string
  onModel?: (model: string) => void
}) {
  const model = options.model ?? process.env.PARALLAX_MODEL
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
  rememberSecret(apiKey)
  if (!model || !apiKey)
    throw new Error(
      'Live mode requires OPENAI_API_KEY and PARALLAX_MODEL in the runner environment. No prewritten fallback was used.',
    )
  const input: unknown[] = [...(options.history ?? []), { role: 'user', content: options.task }]
  let steeringCount = 0
  const maxTurns = options.maxTurns ?? 12
  for (let turn = 0; turn < maxTurns; turn++) {
    options.signal.throwIfAborted()
    const steering = options.steering()
    for (const text of steering.slice(steeringCount))
      input.push({ role: 'user', content: `Developer steering: ${text}` })
    steeringCount = steering.length
    const response = await fetch((options.baseURL ?? 'https://api.openai.com/v1') + '/responses', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        include: ['reasoning.encrypted_content'],
        max_output_tokens: 8192,
        store: false,
        tools: options.tools ?? tools,
        instructions:
          options.instructions ??
          `You are PARALLAX's coding agent. Work only in the supplied detached candidate worktree. Inspect files, implement a fix, invoke run_checks, and inspect_diff before concluding. Candidate strategy: ${options.strategy}. The reproducible fixture uses Col then Colombo; both response orders must keep the Colombo results. Only fixtures/pickup-search/src/useAddressSearch.ts is writable in this first vertical slice. Do not edit tests, instrumentation, package manifests, or the active checkout. Report real evidence; never claim checks ran without the run_checks tool.`,
        input,
      }),
    })
    if (!response.ok)
      throw new Error(
        `OpenAI provider request failed (HTTP ${response.status}). Check the runner's credentials, model access, and quota.`,
      )
    const payload = (await response.json()) as ResponseOutput
    if (payload.error || !Array.isArray(payload.output))
      throw new Error('Invalid provider response from OpenAI. Check model access and retry.')
    if (payload.model) options.onModel?.(payload.model)
    // Replay all output items, including reasoning, to preserve stateless tool-call context.
    input.push(...payload.output)
    const calls = payload.output.filter(
      (item): item is FunctionCall => item.type === 'function_call',
    )
    for (const item of payload.output) {
      if (item.type === 'message' && 'content' in item) {
        for (const content of item.content)
          if (content.text) options.onText(redactSecrets(content.text))
      }
    }
    if (!calls.length) return
    for (const call of calls) {
      let result: unknown
      try {
        result = await options.execute(
          call.name,
          JSON.parse(redactSecrets(call.arguments)) as Record<string, unknown>,
        )
      } catch (error) {
        options.signal.throwIfAborted()
        result = { error: error instanceof Error ? error.message : String(error) }
      }
      input.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      })
    }
  }
  throw new Error(
    `Live agent reached the ${maxTurns}-turn limit. The partial candidate remains available for review.`,
  )
}
