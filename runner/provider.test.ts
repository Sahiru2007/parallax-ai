import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { runLiveAgent } from './provider.ts'

test('provider HTTP, transport, malformed response, and cancellation failures never fall back; retry has fresh context', async () => {
  const oldKey = process.env.OPENAI_API_KEY
  const oldModel = process.env.PARALLAX_MODEL
  process.env.OPENAI_API_KEY = 'test-double-placeholder'
  process.env.PARALLAX_MODEL = 'test-double-model'
  const requests: { input: unknown[] }[] = []
  let respond: () => Promise<Response> = async () => new Response('', { status: 429 })
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return respond()
  })
  let toolCalls = 0
  const options = {
    task: 'Fix the race',
    strategy: 'latest request',
    signal: new AbortController().signal,
    steering: () => [],
    execute: async () => {
      toolCalls++
      return null
    },
    onText: () => {},
  }
  try {
    await assert.rejects(runLiveAgent(options), /HTTP 429/)
    respond = async () => {
      throw new Error('Transport offline (test double)')
    }
    await assert.rejects(runLiveAgent(options), /Transport offline/)
    respond = async () => Response.json({ output: null })
    await assert.rejects(runLiveAgent(options), /Invalid provider response/)
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(runLiveAgent({ ...options, signal: abort.signal }), /abort/i)
    respond = async () =>
      Response.json({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Fresh retry' }] }],
      })
    await runLiveAgent(options)
    assert.equal(toolCalls, 0)
    assert.equal(requests.length, 4)
    assert(requests.every((request) => request.input.length === 1))
  } finally {
    fetchMock.mock.restore()
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = oldKey
    if (oldModel === undefined) delete process.env.PARALLAX_MODEL
    else process.env.PARALLAX_MODEL = oldModel
  }
})

test('general provider carries conversation, custom instructions, and tool outputs through a real-shaped tool loop', async () => {
  const oldKey = process.env.OPENAI_API_KEY,
    oldModel = process.env.PARALLAX_MODEL
  process.env.OPENAI_API_KEY = 'test-double-placeholder'
  process.env.PARALLAX_MODEL = 'test-double-model'
  const requests: Record<string, unknown>[] = []
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return Response.json({
      output:
        requests.length === 1
          ? [
              {
                type: 'function_call',
                name: 'read_file',
                arguments: '{"path":"index.js"}',
                call_id: 'call-read',
              },
            ]
          : [
              {
                type: 'message',
                content: [
                  { type: 'output_text', text: 'Continuation inspected the retained edit.' },
                ],
              },
            ],
    })
  })
  const inspected: unknown[] = []
  try {
    await runLiveAgent({
      task: 'Make it opt in',
      history: [
        { role: 'user', content: 'Add bigint support' },
        { role: 'assistant', content: 'Existing candidate edits are retained.' },
      ],
      instructions: 'Apply repository AGENTS.md instructions',
      tools: [{ type: 'function', name: 'read_file' }],
      strategy: 'Implementation',
      signal: new AbortController().signal,
      steering: () => [],
      execute: async (name, args) => {
        inspected.push({ name, args })
        return 'Existing bigint implementation'
      },
      onText: () => {},
    })
    assert.equal(requests[0].instructions, 'Apply repository AGENTS.md instructions')
    assert.deepEqual((requests[0].input as unknown[]).slice(0, 2), [
      { role: 'user', content: 'Add bigint support' },
      { role: 'assistant', content: 'Existing candidate edits are retained.' },
    ])
    assert.deepEqual(inspected, [{ name: 'read_file', args: { path: 'index.js' } }])
    assert(
      (requests[1].input as { type?: string; call_id?: string; output?: string }[]).some(
        (item) =>
          item.type === 'function_call_output' &&
          item.call_id === 'call-read' &&
          item.output?.includes('Existing bigint implementation'),
      ),
    )
  } finally {
    fetchMock.mock.restore()
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = oldKey
    if (oldModel === undefined) delete process.env.PARALLAX_MODEL
    else process.env.PARALLAX_MODEL = oldModel
  }
})
