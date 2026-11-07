import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProviderSettingsStore, localOllamaURL } from './provider-settings.ts'
import { WindowsCredentialStore, type CredentialStore } from './credentials.ts'
import { rememberSecret, secretStream } from './provider-secrets.ts'
import { command } from './process.ts'

test(
  'Windows Credential Manager stores, replaces, retrieves and removes an inert test credential',
  { skip: process.platform !== 'win32' },
  async () => {
    const store = new WindowsCredentialStore(`PARALLAX AI/Test/${randomUUID()}`)
    try {
      await store.set('inert-parallax-key-one')
      assert.equal(await store.get(), 'inert-parallax-key-one')
      await store.set('inert-parallax-key-two')
      assert.equal(await store.get(), 'inert-parallax-key-two')
    } finally {
      await store.remove()
    }
    assert.equal(await store.get(), null)
  },
)

test('provider settings separate connection from tool readiness, persist selection without secrets, invalidate replaced keys', async () => {
  let key: string | null = null
  const credentials: CredentialStore = {
    available: true,
    get: async () => key,
    set: async (v) => {
      key = v
    },
    remove: async () => {
      key = null
    },
  }
  const dir = await mkdtemp(join(tmpdir(), 'parallax-provider-'))
  const store = new ProviderSettingsStore(join(dir, 'settings.json'), credentials)
  await store.restore()
  let toolCapable = false
  const requests: { url: string; body: Record<string, unknown>; auth?: string | null }[] = []
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      requests.push({
        url: String(url),
        body,
        auth: new Headers(init?.headers).get('Authorization'),
      })
      if (String(url).endsWith('/models'))
        return Response.json({ data: [{ id: 'protocol-model' }] })
      const answered = (body.input as { type?: string }[]).some(
        (m) => m.type === 'function_call_output',
      )
      return Response.json({
        model: 'protocol-model-snapshot',
        output:
          toolCapable && !answered
            ? [
                {
                  type: 'function_call',
                  name: 'parallax_probe',
                  call_id: 'probe',
                  arguments: '{"value":"parallax-ready"}',
                },
              ]
            : [
                {
                  type: 'message',
                  content: [
                    { type: 'output_text', text: answered ? 'parallax-acknowledged' : 'Hello' },
                  ],
                },
              ],
      })
    },
  )
  try {
    await store.handle({
      provider: 'openai',
      action: 'save-key',
      key: 'inert-openai-test-credential',
    })
    await store.handle({ provider: 'openai', action: 'connection' })
    assert.equal(store.state.openai.connection?.ok, true)
    const selection = store.selectionFrom('openai', 'protocol-model')
    assert.throws(() => store.assertReady(selection), /Connection success alone/)
    await store.handle({ provider: 'openai', action: 'agent-check', model: 'protocol-model' })
    assert.equal(store.state.openai.checks['protocol-model'].ok, false)
    toolCapable = true
    await store.handle({ provider: 'openai', action: 'agent-check', model: 'protocol-model' })
    store.assertReady(selection)
    await store.handle({ provider: 'openai', action: 'select', model: 'protocol-model' })
    assert(requests.every((r) => r.auth === 'Bearer inert-openai-test-credential'))
    assert(!JSON.stringify(store.snapshot()).includes('inert-openai-test-credential'))
    assert(!(await readFile(store.file, 'utf8')).includes('inert-openai-test-credential'))
    const restored = new ProviderSettingsStore(store.file, credentials)
    await restored.restore()
    assert.deepEqual(restored.state.selection, selection)
    assert.throws(() => restored.assertReady(selection), /tool check/)
    await store.handle({ provider: 'openai', action: 'save-key', key: 'inert-openai-replacement' })
    assert.throws(() => store.assertReady(selection), /tool check/)
    await store.handle({ provider: 'openai', action: 'remove-key' })
    assert.equal(store.state.openai.keySource, 'none')
    await assert.rejects(store.key(), /no API key/)
  } finally {
    fetchMock.mock.restore()
  }
})

test('Ollama rejects nonloopback and redirects, reports stopped/empty/tool-incapable states, and never calls OpenAI', async () => {
  for (const value of [
    'https://localhost:11434',
    'http://example.com',
    'http://127.0.0.1.evil.test',
    'http://user@localhost:11434',
    'http://localhost:11434/proxy',
  ])
    assert.throws(() => localOllamaURL(value))
  const dir = await mkdtemp(join(tmpdir(), 'parallax-ollama-'))
  const store = new ProviderSettingsStore(join(dir, 'settings.json'), {
    available: false,
    get: async () => null,
    set: async () => {},
    remove: async () => {},
  })
  await store.restore()
  let mode = 'offline'
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async (url: string | URL, init?: RequestInit) => {
      assert(String(url).startsWith('http://127.0.0.1:11434/'))
      assert.equal(init?.redirect, 'error')
      assert.equal(new Headers(init?.headers).has('Authorization'), false)
      if (mode === 'offline') throw new TypeError('fetch failed')
      if (String(url).endsWith('/tags'))
        return Response.json({
          models: mode === 'empty' ? [] : [{ name: 'local-double' }, { name: 'hosted:cloud' }],
        })
      const body = JSON.parse(String(init?.body))
      const answered = body.messages.some((m: { role: string }) => m.role === 'tool')
      return Response.json({
        model: 'local-double',
        message: {
          role: 'assistant',
          content: answered ? 'parallax-acknowledged' : 'no tool',
          ...(mode === 'tools' && !answered
            ? {
                tool_calls: [
                  { function: { name: 'parallax_probe', arguments: { value: 'parallax-ready' } } },
                ],
              }
            : {}),
        },
      })
    },
  )
  try {
    await store.handle({ provider: 'ollama', action: 'connection' })
    assert.match(store.state.ollama.connection!.message, /unreachable/)
    mode = 'empty'
    await store.handle({ provider: 'ollama', action: 'connection' })
    assert.match(store.state.ollama.connection!.message, /no local models/)
    mode = 'no-tools'
    await store.handle({ provider: 'ollama', action: 'connection' })
    assert.deepEqual(store.state.ollama.models, ['local-double'])
    await store.handle({ provider: 'ollama', action: 'agent-check', model: 'local-double' })
    assert.equal(store.state.ollama.checks['local-double'].ok, false)
    mode = 'tools'
    await store.handle({ provider: 'ollama', action: 'agent-check', model: 'local-double' })
    const selected = store.selectionFrom('ollama', 'local-double')
    store.assertReady(selected)
    await store.handle({
      provider: 'ollama',
      action: 'endpoint',
      endpoint: 'http://localhost:11434',
    })
    assert.throws(() => store.assertReady(selected), /different Ollama endpoint/)
  } finally {
    fetchMock.mock.restore()
  }
})

test('secrets split across output chunks are redacted and development credentials stay out of commands', async () => {
  const key = 'inert-split-credential-4b'
  rememberSecret(key)
  const redact = secretStream()
  const result =
    redact('prefix ' + key.slice(0, 10)) + redact(key.slice(10) + ' suffix') + redact('', true)
  assert.equal(result, 'prefix [REDACTED] suffix')
  const repeated = secretStream()
  const twice =
    repeated(key + ' / ' + key.slice(0, 10)) + repeated(key.slice(10)) + repeated('', true)
  assert.equal(twice, '[REDACTED] / [REDACTED]')
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = key
  try {
    const run = await command(process.cwd(), process.execPath, [
      '-e',
      'console.log(Boolean(process.env.OPENAI_API_KEY))',
    ])
    assert.equal(run.output.trim(), 'false')
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})
