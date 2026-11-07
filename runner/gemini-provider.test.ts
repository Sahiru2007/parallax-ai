import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGeminiAgent, geminiModels } from './gemini-provider.ts'
import { ProviderSettingsStore } from './provider-settings.ts'
import type { CredentialStore } from './credentials.ts'
import { command } from './process.ts'
import { rememberSecret } from './provider-secrets.ts'

const frame = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n'
const streamed = (...chunks: unknown[]) =>
  new Response(chunks.map(frame).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
const options = () => ({
  task: 'Inspect files',
  model: 'models/gemini-flash-lite-double',
  apiKey: 'inert-gemini-protocol-key',
  tools: [
    {
      type: 'function',
      name: 'list_files',
      description: 'List files',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ],
  signal: new AbortController().signal,
  onText: () => {},
  execute: async () => ['index.js'],
})

test('Gemini model listing authenticates in headers, paginates, filters methods, and prefers available stable Flash-Lite IDs', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert(!url.href.includes('inert-gemini-protocol-key'))
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'inert-gemini-protocol-key')
    return Response.json(
      url.searchParams.has('pageToken')
        ? {
            models: [
              {
                name: 'models/gemini-flash-lite-stable',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          }
        : {
            models: [
              { name: 'models/gemini-pro-double', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/embed-double', supportedGenerationMethods: ['embedContent'] },
              {
                name: 'models/gemini-flash-lite-preview',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
            nextPageToken: 'second',
          },
    )
  })
  try {
    assert.deepEqual(await geminiModels('inert-gemini-protocol-key'), [
      'models/gemini-flash-lite-stable',
      'models/gemini-flash-lite-preview',
      'models/gemini-pro-double',
    ])
  } finally {
    fetchMock.mock.restore()
  }
})

test('Gemini streamed tool loop preserves signatures/IDs, follow-up text, actual model, and last cumulative usage per response', async () => {
  const requests: Record<string, unknown>[] = [],
    rounds: number[] = [],
    usages: unknown[] = [],
    deltas: string[] = []
  const signed = {
    thoughtSignature: 'opaque-signature-double',
    functionCall: { id: 'specific-call-id', name: 'list_files', args: {} },
  }
  const fetchMock = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.match(url, /:streamGenerateContent\?alt=sse$/)
    const body = JSON.parse(String(init.body))
    requests.push(body)
    assert.deepEqual(
      body.tools[0].functionDeclarations[0].parametersJsonSchema,
      options().tools[0].parameters,
    )
    return requests.length === 1
      ? streamed(
          {
            candidates: [{ content: { parts: [signed] } }],
            usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
          },
          {
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
          },
        )
      : streamed(
          {
            modelVersion: 'gemini-flash-lite-exact-snapshot',
            candidates: [{ content: { parts: [{ text: 'Inspected ' }] } }],
          },
          {
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'files.' },
                    { text: '', thoughtSignature: 'empty-part-signature' },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 20,
              candidatesTokenCount: 3,
              thoughtsTokenCount: 1,
              totalTokenCount: 24,
            },
          },
        )
  })
  let actual = '',
    text = '',
    calls = 0
  try {
    await runGeminiAgent({
      ...options(),
      history: [
        { role: 'user', content: 'First requirement' },
        { role: 'assistant', content: 'Prior changes retained' },
      ],
      onRound: (n) => rounds.push(n),
      onUsage: (u) => usages.push(u),
      onDelta: (s) => deltas.push(s),
      onModel: (m) => {
        actual = m
      },
      onText: (s) => {
        text += s
      },
      execute: async (name) => {
        assert.equal(name, 'list_files')
        calls++
        return ['index.js']
      },
    })
    assert.equal(calls, 1)
    assert.equal(text, 'Inspected files.')
    assert.equal(deltas.join(''), text)
    assert.equal(actual, 'gemini-flash-lite-exact-snapshot')
    assert.deepEqual(rounds, [1, 2])
    assert.equal((usages[0] as { totalTokens: number }).totalTokens, 12)
    assert.equal((usages[1] as { totalTokens: number }).totalTokens, 24)
    const history = requests[1].contents as { role: string; parts: unknown[] }[]
    assert.equal(history[1].role, 'model')
    assert.deepEqual(history.at(-2)?.parts, [signed])
    assert.deepEqual(history.at(-1)?.parts, [
      {
        functionResponse: {
          id: 'specific-call-id',
          name: 'list_files',
          response: { result: ['index.js'] },
        },
      },
    ])
  } finally {
    fetchMock.mock.restore()
  }
})

test('Gemini enforces round limits, handles 429, truncated streams and max tokens without invented completion or partial tools', async () => {
  let mode = 'loop',
    requests = 0,
    calls = 0
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    requests++
    if (mode === 'quota') return new Response('', { status: 429 })
    const part = { functionCall: { name: 'list_files', args: {} } }
    if (mode === 'truncated')
      return new Response(frame({ candidates: [{ content: { parts: [part] } }] }))
    return streamed({
      candidates: [
        { content: { parts: [part] }, finishReason: mode === 'tokens' ? 'MAX_TOKENS' : 'STOP' },
      ],
    })
  })
  const opts = {
    ...options(),
    maxTurns: 2,
    execute: async () => {
      calls++
      return []
    },
  }
  try {
    await assert.rejects(runGeminiAgent(opts), /2-round agent limit/)
    assert.equal(requests, 2)
    assert.equal(calls, 2)
    for (const next of ['quota', 'truncated', 'tokens']) {
      mode = next
      calls = 0
      requests = 0
      await assert.rejects(
        runGeminiAgent(opts),
        next === 'quota' ? /HTTP 429/ : next === 'tokens' ? /token limit/ : /did not finish/,
      )
      assert.equal(calls, 0)
      assert.equal(requests, 1)
    }
  } finally {
    fetchMock.mock.restore()
  }
})

test('cancelling an active real HTTP Gemini stream stops it before any tool executes', async () => {
  let calls = 0
  const server = createServer((_req, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(': keep-alive\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const abort = new AbortController()
  try {
    const running = runGeminiAgent({
      ...options(),
      signal: abort.signal,
      baseURL: `http://127.0.0.1:${address.port}`,
      execute: async () => {
        calls++
        return null
      },
    })
    const failed = assert.rejects(running, /abort/i)
    await once(server, 'request')
    abort.abort()
    await failed
    assert.equal(calls, 0)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  }
})

test('Gemini credential/settings separation, round-limit persistence and command environment exclusion', async () => {
  let geminiKey: string | null = null
  const noOpenAI: CredentialStore = {
    available: false,
    get: async () => null,
    set: async () => {
      throw new Error('Wrong credential store')
    },
    remove: async () => {
      throw new Error('Wrong credential store')
    },
  }
  const geminiVault: CredentialStore = {
    available: true,
    get: async () => geminiKey,
    set: async (s) => {
      geminiKey = s
    },
    remove: async () => {
      geminiKey = null
    },
  }
  const dir = await mkdtemp(join(tmpdir(), 'parallax-gemini-')),
    store = new ProviderSettingsStore(join(dir, 'settings.json'), noOpenAI, geminiVault)
  await store.restore()
  await store.handle({ provider: 'gemini', action: 'save-key', key: 'inert-gemini-settings-key' })
  assert.equal(await store.key('gemini'), 'inert-gemini-settings-key')
  await store.handle({ action: 'round-limit', limit: 6 })
  await assert.rejects(store.handle({ action: 'round-limit', limit: 100 }), /2 to 24/)
  assert(!(await readFile(store.file, 'utf8')).includes('inert-gemini-settings-key'))
  const restored = new ProviderSettingsStore(store.file, noOpenAI, geminiVault)
  await restored.restore()
  assert.equal(restored.state.maxToolRounds, 6)
  await store.handle({ provider: 'gemini', action: 'remove-key' })
  assert.equal(geminiKey, null)
  const previous = [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]
  process.env.GEMINI_API_KEY = 'inert-gemini-settings-key'
  process.env.GOOGLE_API_KEY = 'inert-google-settings-key'
  try {
    const result = await command(process.cwd(), process.execPath, [
      '-e',
      'console.log(Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY))',
    ])
    assert.equal(result.output.trim(), 'false')
  } finally {
    for (const [i, name] of ['GEMINI_API_KEY', 'GOOGLE_API_KEY'].entries())
      if (previous[i] === undefined) delete process.env[name]
      else process.env[name] = previous[i]
  }
})

test('saved-key redaction streams short nonsecret output before a long-running command exits', async () => {
  rememberSecret('inert-secret-longer-than-the-command-ready-line')
  const abort = new AbortController()
  let observed = false
  const deadline = setTimeout(() => abort.abort(), 3000)
  try {
    await assert.rejects(
      command(
        process.cwd(),
        process.execPath,
        ['-e', "console.log('stream probe active');setInterval(()=>{},1000)"],
        abort.signal,
        {
          onOutput: (text) => {
            if (text.includes('stream probe active')) {
              observed = true
              abort.abort()
            }
          },
        },
      ),
      /cancelled/,
    )
    assert.equal(observed, true, 'A saved API key must not delay benign output until process exit.')
  } finally {
    clearTimeout(deadline)
    abort.abort()
  }
})
