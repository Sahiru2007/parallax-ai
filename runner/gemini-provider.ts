import type { AgentProgress, TokenUsage } from '../shared/providers.ts'
import { rememberSecret, redactSecrets, secretStream } from './provider-secrets.ts'

const root = 'https://generativelanguage.googleapis.com/v1beta'
export function preferGeminiModels(models: string[]) {
  const score = (id: string) =>
    (/flash[-.]?lite/i.test(id) ? 0 : /flash/i.test(id) ? 2 : 4) +
    (/preview|experimental|\bexp\b/i.test(id) ? 1 : 0)
  return [...new Set(models)].sort(
    (a, b) => score(a) - score(b) || b.localeCompare(a, undefined, { numeric: true }),
  )
}
export async function geminiModels(apiKey: string, baseURL = root) {
  rememberSecret(apiKey)
  const models: string[] = [],
    seen = new Set<string>()
  let pageToken = ''
  for (let page = 0; page < 20; page++) {
    const url = new URL(baseURL + '/models')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetch(url, {
      headers: { 'x-goog-api-key': apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(geminiHTTPError(response.status))
    const payload = (await response.json()) as {
      models?: { name: string; supportedGenerationMethods?: string[] }[]
      nextPageToken?: string
    }
    if (!Array.isArray(payload.models)) throw new Error('Gemini returned an invalid model list.')
    for (const model of payload.models)
      if (
        /^models\/[A-Za-z0-9._-]+$/.test(model.name) &&
        model.supportedGenerationMethods?.includes('generateContent')
      )
        models.push(model.name)
    if (!payload.nextPageToken) return preferGeminiModels(models)
    if (seen.has(payload.nextPageToken))
      throw new Error('Gemini model pagination repeated a page. Retry the connection test.')
    pageToken = payload.nextPageToken
    seen.add(pageToken)
  }
  throw new Error('Gemini model listing exceeded its page limit. Retry the connection test.')
}
function geminiHTTPError(status: number) {
  return `Gemini request failed (HTTP ${status}). ${status === 429 ? 'Quota or rate limit reached. Check Google AI Studio billing/quota and retry later; no automatic retries or provider switch were used.' : status === 401 || status === 403 ? 'Check your API key, API restrictions, and Gemini API access in Google AI Studio.' : status === 404 ? 'This model is unavailable. Refresh the model list and select an available model.' : 'Check model compatibility, your network, and Gemini service availability.'}`
}
interface Part {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> }
  [key: string]: unknown
}
interface GeminiChunk {
  candidates?: {
    index?: number
    content?: { role?: string; parts?: Part[] }
    finishReason?: string
  }[]
  modelVersion?: string
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    cachedContentTokenCount?: number
    totalTokenCount?: number
  }
  promptFeedback?: { blockReason?: string }
  error?: unknown
}
// SSE records may span arbitrary UTF-8 chunks. Yield only complete events, never partial calls.
async function* sse(response: Response) {
  if (!response.body) throw new Error('Gemini response has no stream body.')
  const reader = response.body.getReader(),
    decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const result = await reader.read()
      buffer += decoder.decode(result.value, { stream: !result.done }).replaceAll('\r', '')
      if (buffer.length > 2_000_000) throw new Error('Gemini stream event exceeded the size limit.')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const record = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = record
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data && data !== '[DONE]') {
          let payload: GeminiChunk
          try {
            payload = JSON.parse(data)
          } catch {
            throw new Error(
              'Gemini sent malformed stream data. Partial tool calls were not executed.',
            )
          }
          yield payload
        }
      }
      if (result.done) {
        if (buffer.trim())
          throw new Error(
            'Gemini stream ended with an incomplete event. Partial tool calls were not executed.',
          )
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export async function runGeminiAgent(
  options: AgentProgress & {
    task: string
    model: string
    apiKey: string
    baseURL?: string
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
  rememberSecret(options.apiKey)
  const model = options.model.startsWith('models/') ? options.model : 'models/' + options.model
  if (!/^models\/[A-Za-z0-9._-]+$/.test(model))
    throw new Error('Invalid Gemini model ID. Refresh the available models.')
  const declarations = options.tools.map((entry) => {
    const { name, description, parameters } = entry as Record<string, unknown>
    return { name, description, parametersJsonSchema: parameters }
  })
  const contents: unknown[] = [
    ...(options.history ?? []).map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }],
    })),
    { role: 'user', parts: [{ text: options.task }] },
  ]
  const limit = options.maxTurns ?? 12
  for (let round = 1; round <= limit; round++) {
    options.signal.throwIfAborted()
    options.onRound?.(round, limit)
    let response: Response
    try {
      response = await fetch(`${options.baseURL ?? root}/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(120000)]),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [
              { text: options.instructions ?? 'Use the supplied tools to complete the user task.' },
            ],
          },
          tools: [{ functionDeclarations: declarations }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: { candidateCount: 1, maxOutputTokens: 8192 },
        }),
      })
    } catch {
      options.signal.throwIfAborted()
      throw new Error(
        'Gemini is unreachable or timed out. Check the network and retry; no fallback provider was used.',
      )
    }
    if (!response.ok) throw new Error(geminiHTTPError(response.status))
    const parts: Part[] = []
    let text = '',
      finish = '',
      usage: TokenUsage | undefined
    const redactDelta = secretStream()
    try {
      for await (const chunk of sse(response)) {
        options.signal.throwIfAborted()
        if (chunk.error || chunk.promptFeedback?.blockReason)
          throw new Error(
            'Gemini blocked or rejected this response. No tool calls from it were executed.',
          )
        if (chunk.modelVersion) options.onModel?.(chunk.modelVersion)
        if (chunk.usageMetadata) {
          const u = chunk.usageMetadata
          usage = {
            inputTokens: u.promptTokenCount,
            outputTokens: u.candidatesTokenCount,
            thoughtTokens: u.thoughtsTokenCount,
            cachedTokens: u.cachedContentTokenCount,
            totalTokens: u.totalTokenCount,
          }
        }
        const candidate = chunk.candidates?.find((c) => (c.index ?? 0) === 0)
        if (candidate?.finishReason) finish = candidate.finishReason
        for (const part of candidate?.content?.parts ?? []) {
          parts.push(part) // Preserve opaque signatures in their original parts, including empty text.
          if (part.text && !part.thought) {
            text += part.text
            options.onDelta?.(redactDelta(part.text))
          }
        }
      }
    } catch (error) {
      if (usage) options.onUsage?.(usage)
      options.signal.throwIfAborted()
      throw new Error(
        error instanceof Error && /Gemini/.test(error.message)
          ? error.message
          : 'Gemini stream was interrupted. Retry explicitly; partial tool calls were not executed.',
      )
    }
    options.onDelta?.(redactDelta('', true))
    if (usage) options.onUsage?.(usage)
    if (finish !== 'STOP')
      throw new Error(
        finish === 'MAX_TOKENS'
          ? 'Gemini reached the response token limit. Partial tool calls were not executed; narrow the task and retry.'
          : 'Gemini response did not finish successfully. No tool calls from it were executed.',
      )
    if (!parts.length) throw new Error('Gemini returned an empty response.')
    contents.push({ role: 'model', parts })
    if (text.trim()) options.onText(redactSecrets(text))
    const calls = parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []))
    if (!calls.length) return
    if (calls.length > 24)
      throw new Error(
        'Gemini requested too many tools in a single round. Partial changes remain available.',
      )
    const ids = calls.flatMap((c) => (c.id ? [c.id] : []))
    if (new Set(ids).size !== ids.length)
      throw new Error(
        'Gemini repeated a function-call ID. No tools from this response were executed.',
      )
    const responses: unknown[] = []
    for (const call of calls) {
      options.signal.throwIfAborted()
      let result: unknown
      try {
        result = await options.execute(
          call.name,
          JSON.parse(redactSecrets(JSON.stringify(call.args ?? {}))),
        )
      } catch (error) {
        options.signal.throwIfAborted()
        result = { error: error instanceof Error ? error.message : 'Repository tool failed.' }
      }
      responses.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response: { result: result ?? null },
        },
      })
    }
    contents.push({ role: 'user', parts: responses })
  }
  throw new Error(
    `Gemini reached the ${limit}-round agent limit. It stopped without retrying; partial changes and checks remain available for review.`,
  )
}
