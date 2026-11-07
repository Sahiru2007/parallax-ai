import { redactSecrets } from './provider-secrets.ts'
import type { AgentProgress } from '../shared/providers.ts'
import {
  drainPending,
  preparePending,
  RecoveryRequired,
  type Continuation,
  type DurableExecute,
} from './continuation.ts'
import { providerRequest } from './provider-retry.ts'
export async function runOllamaAgent(
  options: AgentProgress & {
    task: string
    model: string
    endpoint: string
    signal: AbortSignal
    history?: { role: 'user' | 'assistant'; content: string }[]
    instructions?: string
    tools: unknown[]
    maxTurns?: number
    execute: DurableExecute
    continuation?: Continuation
    onText: (text: string) => void
    onModel?: (model: string) => void
  },
) {
  const c = options.continuation
  const messages: unknown[] = c?.state.context ?? [
    { role: 'system', content: options.instructions ?? '' },
    ...(options.history ?? []),
    { role: 'user', content: options.task },
  ]
  if (c) {
    c.state.context = messages
    await c.save()
    if (c.state.complete) return
  }
  const settle = async () => {
    if (!c?.state.pending) return
    const results = await drainPending(c, options.execute)
    messages.push(
      ...results.map(({ call, result }) => ({
        role: 'tool',
        tool_name: call.name,
        content: JSON.stringify(result),
      })),
    )
    c.state.pending = undefined
    await c.save()
  }
  await settle()
  if (c?.state.inspection) {
    messages.push({ role: 'user', content: c.state.inspection })
    c.state.inspection = undefined
    await c.save()
  }
  const tools = options.tools.map((tool) => {
    const { name, description, parameters } = tool as Record<string, unknown>
    return { type: 'function', function: { name, description, parameters } }
  })
  const limit = c?.state.allowance ?? options.maxTurns ?? 24
  for (let turn = c?.state.rounds ?? 0; turn < limit; turn++) {
    options.signal.throwIfAborted()
    if (c) {
      c.state.rounds = turn + 1
      await c.save()
    }
    options.onRound?.(turn + 1, limit)
    let response: Response
    try {
      response = await providerRequest(
        'ollama',
        (requestSignal) =>
          fetch(options.endpoint + '/api/chat', {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.any([requestSignal, AbortSignal.timeout(120000)]),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: options.model, stream: false, messages, tools }),
          }),
        options.signal,
        c,
      )
    } catch (error) {
      if (error instanceof RecoveryRequired) throw error
      options.signal.throwIfAborted()
      throw new Error(
        'Ollama is unreachable or timed out. Start the selected local server and retry. No cloud fallback was used.',
      )
    }
    if (!response.ok)
      throw new Error(
        `Ollama request failed (HTTP ${response.status}). Check that the selected local model is installed and supports tools. No cloud fallback was used.`,
      )
    const payload = (await response.json()) as {
      prompt_eval_count?: number
      eval_count?: number
      model?: string
      message?: {
        role: string
        content?: string
        tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
      }
    }
    if (!payload.message || payload.message.role !== 'assistant')
      throw new Error('Ollama returned an invalid assistant response.')
    if (payload.model) options.onModel?.(payload.model)
    if (payload.prompt_eval_count !== undefined || payload.eval_count !== undefined)
      options.onUsage?.({
        inputTokens: payload.prompt_eval_count,
        outputTokens: payload.eval_count,
      })
    const message = payload.message
    let pendingCalls
    try {
      if (
        message.tool_calls &&
        (!Array.isArray(message.tool_calls) || message.tool_calls.length > 24)
      )
        throw new Error('Invalid tool calls')
      pendingCalls = (message.tool_calls ?? []).map((call) => {
        const args = JSON.parse(redactSecrets(JSON.stringify(call.function.arguments)))
        if (!call.function.name || !args || typeof args !== 'object' || Array.isArray(args))
          throw new Error('Invalid tool arguments')
        return { name: call.function.name, args }
      })
    } catch {
      throw new Error(
        'Ollama returned invalid tool calls. No tools from this response were executed; resume retains the previous valid context.',
      )
    }
    messages.push(message)
    if (message.content) options.onText(redactSecrets(message.content))
    if (!message.tool_calls?.length) {
      if (c) {
        c.state.complete = true
        await c.save()
      }
      return
    }
    if (c) {
      await preparePending(c, pendingCalls, turn + 1)
      await settle()
      continue
    }
    for (const call of message.tool_calls) {
      options.signal.throwIfAborted()
      let result: unknown
      try {
        result = await options.execute(
          call.function.name,
          JSON.parse(redactSecrets(JSON.stringify(call.function.arguments))),
        )
      } catch (error) {
        options.signal.throwIfAborted()
        result = { error: error instanceof Error ? error.message : String(error) }
      }
      messages.push({
        role: 'tool',
        tool_name: call.function.name,
        content: JSON.stringify(result),
      })
    }
  }
  throw new RecoveryRequired({
    kind: 'limit',
    message: `Ollama reached the ${limit}-round tool-turn limit. Explicitly continue with an additional bounded allowance. Partial changes remain available.`,
  })
}
