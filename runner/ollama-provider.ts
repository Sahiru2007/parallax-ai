import { redactSecrets } from './provider-secrets.ts'
import type { AgentProgress } from '../shared/providers.ts'
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
    execute: (name: string, args: Record<string, unknown>) => Promise<unknown>
    onText: (text: string) => void
    onModel?: (model: string) => void
  },
) {
  const messages: unknown[] = [
    { role: 'system', content: options.instructions ?? '' },
    ...(options.history ?? []),
    { role: 'user', content: options.task },
  ]
  const tools = options.tools.map((tool) => {
    const { name, description, parameters } = tool as Record<string, unknown>
    return { type: 'function', function: { name, description, parameters } }
  })
  for (let turn = 0; turn < (options.maxTurns ?? 24); turn++) {
    options.signal.throwIfAborted()
    options.onRound?.(turn + 1, options.maxTurns ?? 24)
    let response: Response
    try {
      response = await fetch(options.endpoint + '/api/chat', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(120000)]),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: options.model, stream: false, messages, tools }),
      })
    } catch {
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
    messages.push(message)
    if (message.content) options.onText(redactSecrets(message.content))
    if (!message.tool_calls?.length) return
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
  throw new Error(
    'Ollama reached the tool-turn limit. Partial changes remain available for review.',
  )
}
