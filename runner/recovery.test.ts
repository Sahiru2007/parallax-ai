import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, stat, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { CodingEngine } from './coding-engine.ts'
import { ProviderSettingsStore } from './provider-settings.ts'
import { git } from './process.ts'
import type { AgentCheckpoint, Continuation } from './continuation.ts'
import { RecoveryRequired } from './continuation.ts'
import { providerRequest, rateLimitInfo } from './provider-retry.ts'
import { runLiveAgent } from './provider.ts'
import { runOllamaAgent } from './ollama-provider.ts'
import { runGeminiAgent } from './gemini-provider.ts'

const noKey = {
  available: false,
  get: async () => null,
  set: async () => {},
  remove: async () => {},
}
const key = {
  available: true,
  get: async () => 'inert-recovery-key',
  set: async () => {},
  remove: async () => {},
}
const commandArgs = { executable: 'node', args: ['--test', 'check.test.cjs'], cwd: '.' }
const batch = (value: number) => [
  { name: 'write_file', args: { path: 'value.cjs', content: `module.exports=${value};\n` } },
  { name: 'run_command', args: commandArgs },
]
function reply(calls: { name: string; args: Record<string, unknown> }[], tag = 'round') {
  const parts = calls.length
    ? calls.map((call, i) => ({
        thoughtSignature: 'opaque-recovery-signature',
        functionCall: { id: `${tag}-${i}`, name: call.name, args: call.args },
      }))
    : [{ text: 'Retained work verified.' }]
  return new Response(
    'data: ' +
      JSON.stringify({
        modelVersion: 'recovery-double-version',
        candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
      }) +
      '\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
const quota = () =>
  Response.json(
    {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerDay' }],
          },
        ],
      },
    },
    { status: 429 },
  )
async function setup() {
  const dir = resolve('artifacts/step5-unit', randomUUID()),
    repo = join(dir, 'test repo')
  await mkdir(dir, { recursive: true })
  await git(process.cwd(), ['clone', '--shared', '--', resolve('artifacts/step2-seed'), repo])
  await writeFile(join(repo, 'value.cjs'), 'module.exports=0;\n')
  await writeFile(join(repo, '.gitignore'), '.recovery-count\n')
  await writeFile(
    join(repo, 'check.test.cjs'),
    "const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');test('actual check',()=>{fs.appendFileSync('.recovery-count','x');assert(require('./value.cjs')>0)});\n",
  )
  const providers = new ProviderSettingsStore(join(dir, 'providers.json'), noKey, key)
  await providers.restore()
  providers.state.testTransport = true
  providers.state.gemini.models = ['models/recovery-double']
  providers.state.gemini.checks['models/recovery-double'] = {
    ok: true,
    message: 'Explicit controlled provider double',
    at: new Date().toISOString(),
  }
  providers.state.selection = providers.selectionFrom('gemini', 'models/recovery-double')
  const engine = new CodingEngine(join(dir, 'sessions'), providers)
  await engine.restore()
  return { engine, providers, repo, dir }
}
async function settled(engine: CodingEngine, id: string, approve = true) {
  for (let i = 0; i < 1000; i++) {
    const state = engine.state(id)
    if (!state.busy) return state
    if (approve && state.approval) engine.approve(id, state.approval.id, true)
    await delay(10)
  }
  throw new Error('Controlled run did not settle')
}
async function waitApproval(engine: CodingEngine, id: string) {
  for (let i = 0; i < 500; i++) {
    const s = engine.state(id)
    if (s.approval) return s.approval
    if (!s.busy) throw new Error(s.error)
    await delay(10)
  }
  throw new Error('No approval')
}

test('interruption before an edit resumes pinned native conversation and executes one real edit/check', async () => {
  const { engine, providers, repo } = await setup()
  let blocked = true
  const fetched: Record<string, unknown>[] = []
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    fetched.push(body)
    if (blocked) return quota()
    const responses = body.contents
      .flatMap((c: { parts: { functionResponse?: unknown }[] }) => c.parts)
      .filter((p: { functionResponse?: unknown }) => p.functionResponse).length
    return reply(responses ? [] : batch(1))
  })
  try {
    const state = await engine.start(
      repo,
      'Controlled feature',
      'live',
      false,
      false,
      providers.state.selection!,
    )
    await settled(engine, state.id)
    assert.equal(state.providerRuns![0].recovery?.kind, 'quota')
    assert.equal(state.candidates[0].files.length, 0)
    const run = state.providerRuns![0]
    blocked = false
    providers.state.selection = { provider: 'openai', model: 'unrelated-default' }
    await engine.resume(state.id, run.id)
    await settled(engine, state.id)
    assert.equal(run.status, 'completed')
    assert.equal(run.model, 'models/recovery-double')
    assert.equal(run.provider, 'gemini')
    assert.equal(await readFile(join(state.candidates[0].worktree, '.recovery-count'), 'utf8'), 'x')
    assert.equal(await readFile(join(repo, 'value.cjs'), 'utf8'), 'module.exports=0;\n')
    assert.equal(fetched[0].model, undefined)
    assert(run.rounds! >= 3)
    assert.equal(run.continuations, 1)
    assert.equal(run.usage?.totalTokens, 24)
  } finally {
    m.mock.restore()
    await engine.close()
  }
})

test('after-edit 429 retains outputs; model-requested duplicate writes and commands reuse durable receipts', async () => {
  const { engine, providers, repo } = await setup()
  let blocked = true
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const count = body.contents
      .flatMap((c: { parts: { functionResponse?: unknown }[] }) => c.parts)
      .filter((p: { functionResponse?: unknown }) => p.functionResponse).length
    if (count === 2 && blocked) return quota()
    return reply(count >= 4 ? [] : batch(1), count ? 'duplicate' : 'first')
  })
  try {
    const state = await engine.start(
      repo,
      'Controlled edit and interruption',
      'live',
      false,
      false,
      providers.state.selection!,
    )
    await settled(engine, state.id)
    const run = state.providerRuns![0],
      path = join(state.candidates[0].worktree, 'value.cjs')
    assert.equal(run.status, 'interrupted')
    assert.equal(state.checks.filter((c) => c.status === 'passed').length, 1)
    const before = (await stat(path)).mtimeMs
    blocked = false
    await delay(30)
    await engine.resume(state.id, run.id)
    await settled(engine, state.id)
    assert.equal(run.status, 'completed')
    assert.equal((await stat(path)).mtimeMs, before)
    assert.equal(await readFile(join(state.candidates[0].worktree, '.recovery-count'), 'utf8'), 'x')
    assert.equal(state.checks.filter((c) => c.status === 'passed').length, 1)
    assert(state.events.some((e) => e.title === 'Reused completed run_command'))
  } finally {
    m.mock.restore()
    await engine.close()
  }
})

test('cancellation while awaiting approval restores the pending call without repeating the retained edit', async () => {
  const { engine, providers, repo } = await setup()
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    return reply(
      body.contents.some((c: { parts: { functionResponse?: unknown }[] }) =>
        c.parts.some((p) => p.functionResponse),
      )
        ? []
        : batch(1),
    )
  })
  try {
    const state = await engine.start(
      repo,
      'Approval interruption',
      'live',
      false,
      false,
      providers.state.selection!,
    )
    const original = await waitApproval(engine, state.id),
      path = join(state.candidates[0].worktree, 'value.cjs'),
      stamp = (await stat(path)).mtimeMs
    engine.cancel(state.id)
    await settled(engine, state.id, false)
    assert.equal(
      await access(join(state.candidates[0].worktree, '.recovery-count')).then(
        () => true,
        () => false,
      ),
      false,
    )
    await engine.resume(state.id, state.providerRuns![0].id)
    const renewed = await waitApproval(engine, state.id)
    assert.notEqual(original.id, renewed.id)
    assert.equal((await stat(path)).mtimeMs, stamp)
    engine.approve(state.id, renewed.id, true)
    await settled(engine, state.id)
    assert.equal(await readFile(join(state.candidates[0].worktree, '.recovery-count'), 'utf8'), 'x')
    assert.equal(state.providerRuns![0].status, 'completed')
  } finally {
    m.mock.restore()
    await engine.close()
  }
})

test('manual A then interrupted B retains A and resumes only B from the same baseline', async () => {
  const { engine, providers, repo } = await setup()
  let blockB = true
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)),
      b = /Candidate: Approach B\./.test(body.systemInstruction.parts[0].text)
    if (b && blockB) return quota()
    return reply(
      body.contents.some((c: { parts: { functionResponse?: unknown }[] }) =>
        c.parts.some((p) => p.functionResponse),
      )
        ? []
        : batch(b ? 2 : 1),
    )
  })
  try {
    const state = await engine.start(
      repo,
      'Compare controlled approaches',
      'live',
      true,
      false,
      providers.state.selection!,
      true,
    )
    await settled(engine, state.id)
    const aPatch = state.candidates[0].patch,
      baseline = state.baseline.digest
    assert.deepEqual(state.generation?.queued, ['b'])
    assert.equal(state.providerRuns?.length, 1)
    await engine.generateNext(state.id, 'b')
    await settled(engine, state.id)
    assert.equal(state.providerRuns![0].status, 'completed')
    assert.equal(state.providerRuns![1].status, 'interrupted')
    assert.equal(state.candidates[0].patch, aPatch)
    blockB = false
    await engine.resume(state.id, state.providerRuns![1].id)
    await settled(engine, state.id)
    assert.equal(state.candidates[0].patch, aPatch)
    assert.equal(state.baseline.digest, baseline)
    assert.equal(await readFile(join(state.candidates[0].worktree, '.recovery-count'), 'utf8'), 'x')
    assert.equal(await readFile(join(state.candidates[1].worktree, '.recovery-count'), 'utf8'), 'x')
    assert.equal(state.providerRuns![1].status, 'completed')
  } finally {
    m.mock.restore()
    await engine.close()
  }
})

test('uncertain active command is inspected and never silently executed twice', async () => {
  const { engine, providers, repo } = await setup()
  const args = {
    executable: 'node',
    args: [
      '-e',
      "require('node:fs').appendFileSync('.recovery-count','x');console.log('active command');setInterval(()=>{},1000)",
    ],
    cwd: '.',
  }
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    return reply(
      body.contents.some((c: { parts: { functionResponse?: unknown }[] }) =>
        c.parts.some((p) => p.functionResponse),
      )
        ? []
        : [{ name: 'run_command', args }],
    )
  })
  try {
    const state = await engine.start(
      repo,
      'Uncertain command',
      'live',
      false,
      false,
      providers.state.selection!,
    )
    const approval = await waitApproval(engine, state.id)
    engine.approve(state.id, approval.id, true)
    for (let i = 0; i < 300 && !state.checks.some((c) => c.output.includes('active command')); i++)
      await delay(10)
    assert(state.checks.some((c) => c.output.includes('active command')))
    engine.cancel(state.id)
    await settled(engine, state.id, false)
    const run = state.providerRuns![0]
    await engine.resume(state.id, run.id)
    await settled(engine, state.id, false)
    assert.equal(run.recovery?.kind, 'uncertain')
    const call = run.calls!.find((c) => c.status === 'uncertain')!
    assert(call.detail?.includes('Outcome is not verified'))
    assert.equal(await readFile(join(state.candidates[0].worktree, '.recovery-count'), 'utf8'), 'x')
    await engine.resolveTool(state.id, run.id, call.id, 'skip')
    await engine.resume(state.id, run.id)
    await settled(engine, state.id)
    assert.equal(run.status, 'completed')
    assert.equal(state.checks[0].status, 'skipped')
    assert.equal(await readFile(join(state.candidates[0].worktree, '.recovery-count'), 'utf8'), 'x')
  } finally {
    m.mock.restore()
    await engine.close()
  }
})

test('restart after a file effect but before its receipt recovers by inspection without rewriting it', async () => {
  const { engine, providers, repo } = await setup()
  const originalTool = engine.tool.bind(engine)
  let injected = false
  engine.tool = async (...args) => {
    const result = await originalTool(...args)
    if (!injected && args[2] === 'write_file') {
      injected = true
      throw new RecoveryRequired({
        kind: 'restart',
        message: 'Controlled crash window after file effect, before acknowledgement.',
      })
    }
    return result
  }
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    return reply(
      body.contents.some((c: { parts: { functionResponse?: unknown }[] }) =>
        c.parts.some((p) => p.functionResponse),
      )
        ? []
        : batch(1),
    )
  })
  let restored: CodingEngine | undefined
  try {
    const state = await engine.start(
      repo,
      'Inspect uncertain file effect',
      'live',
      false,
      false,
      providers.state.selection!,
    )
    await settled(engine, state.id)
    const path = join(state.candidates[0].worktree, 'value.cjs'),
      stamp = (await stat(path)).mtimeMs
    await engine.close()
    restored = new CodingEngine(engine.base, providers)
    await restored.restore()
    const next = restored.state(state.id)
    await restored.resume(state.id, next.providerRuns![0].id)
    await settled(restored, state.id)
    assert.equal(next.providerRuns![0].status, 'completed')
    assert.equal((await stat(path)).mtimeMs, stamp)
    assert.equal(await readFile(join(next.candidates[0].worktree, '.recovery-count'), 'utf8'), 'x')
    assert(
      next.providerRuns![0].calls?.some((c) => c.detail?.includes('Recovered completed result')),
    )
  } finally {
    m.mock.restore()
    await restored?.close()
    await engine.close()
  }
})

test('round limit needs an explicit bounded allowance and preserves cumulative usage and receipts', async () => {
  const { engine, providers, repo } = await setup()
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)),
      responses = body.contents
        .flatMap((c: { parts: { functionResponse?: unknown }[] }) => c.parts)
        .filter((p: { functionResponse?: unknown }) => p.functionResponse).length
    return reply(
      responses >= 2 ? [] : [{ name: 'read_file', args: { path: 'value.cjs' } }],
      String(responses),
    )
  })
  try {
    const state = await engine.start(repo, 'Bounded continuation', 'live', false, false, {
      ...providers.state.selection!,
      maxToolRounds: 2,
    })
    await settled(engine, state.id)
    const run = state.providerRuns![0]
    assert.equal(run.recovery?.kind, 'limit')
    assert.equal(run.rounds, 2)
    await assert.rejects(engine.resume(state.id, run.id), /bounded allowance/)
    await engine.resume(state.id, run.id, 1)
    await settled(engine, state.id)
    assert.equal(run.status, 'completed')
    assert.equal(run.rounds, 3)
    assert.equal(run.maxToolRounds, 3)
    assert.equal(run.usage?.totalTokens, 36)
    assert.equal(run.toolCalls, 2)
  } finally {
    m.mock.restore()
    await engine.close()
  }
})

const checkpoint = (): AgentCheckpoint => ({
  version: 1,
  rounds: 0,
  allowance: 4,
  ledger: [],
  sourceDigest: 'test',
  requests: 0,
  retry: { attempts: 0, totalAttempts: 0, allowanceWaitMs: 0, totalWaitMs: 0 },
})
test('retry guidance distinguishes temporary, daily quota and unknown 429, bounds retries/wait and permits cancellation', async () => {
  assert.equal((await rateLimitInfo('gemini', quota())).kind, 'quota')
  assert.equal(
    (
      await rateLimitInfo(
        'gemini',
        Response.json({ error: { status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }),
      )
    ).kind,
    'unknown-429',
  )
  const cp = checkpoint(),
    c: Continuation = { state: cp, save: async () => {} }
  let sends = 0
  await assert.rejects(
    providerRequest(
      'gemini',
      async () => {
        sends++
        return Response.json(
          { error: { code: 'rate_limit_exceeded' } },
          { status: 429, headers: { 'Retry-After': '120' } },
        )
      },
      new AbortController().signal,
      c,
    ),
    /temporarily rate/,
  )
  assert.equal(sends, 1)
  assert.equal(cp.retry.totalAttempts, 0)
  const short = checkpoint()
  sends = 0
  await assert.rejects(
    providerRequest(
      'openai',
      async () => {
        sends++
        return Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 })
      },
      new AbortController().signal,
      { state: short, save: async () => {} },
    ),
    /temporarily rate/,
  )
  assert.equal(sends, 3)
  assert.equal(short.retry.totalAttempts, 2)
  assert(short.retry.totalWaitMs < 60000)
  const abort = new AbortController(),
    waiting = checkpoint()
  sends = 0
  await assert.rejects(
    providerRequest(
      'gemini',
      async () => {
        sends++
        return Response.json(
          { error: { code: 'rate_limit_exceeded' } },
          { status: 429, headers: { 'Retry-After': '10' } },
        )
      },
      abort.signal,
      {
        state: waiting,
        save: async () => {},
        onRecovery: (r) => {
          if (r.waiting) setTimeout(() => abort.abort(), 20)
        },
      },
    ),
    /abort/i,
  )
  assert.equal(sends, 1)
})

test('OpenAI and Ollama preserve native tool results across manual continuation', async () => {
  for (const provider of ['openai', 'ollama'] as const) {
    const cp = checkpoint(),
      c: Continuation = { state: cp, save: async () => {} }
    let requests = 0,
      effects = 0
    const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      requests++
      if (requests === 2) return quota()
      const body = JSON.parse(String(init.body))
      if (requests === 3) assert(JSON.stringify(body).includes('retained-result'))
      return Response.json(
        provider === 'openai'
          ? {
              output:
                requests === 1
                  ? [
                      {
                        type: 'function_call',
                        call_id: 'call-stable',
                        name: 'read_file',
                        arguments: '{"path":"value.cjs"}',
                      },
                    ]
                  : [{ type: 'message', content: [{ type: 'output_text', text: 'finished' }] }],
            }
          : {
              message: {
                role: 'assistant',
                content: requests === 1 ? '' : 'finished',
                ...(requests === 1
                  ? {
                      tool_calls: [
                        { function: { name: 'read_file', arguments: { path: 'value.cjs' } } },
                      ],
                    }
                  : {}),
              },
            },
      )
    })
    const options = {
      task: 'Inspect',
      model: 'model-double',
      apiKey: 'inert-recovery-key',
      endpoint: 'http://127.0.0.1:11434',
      tools: [],
      strategy: 'test',
      steering: () => [],
      signal: new AbortController().signal,
      continuation: c,
      execute: async () => {
        effects++
        return 'retained-result'
      },
      onText: () => {},
    }
    try {
      const run = () => (provider === 'openai' ? runLiveAgent(options) : runOllamaAgent(options))
      await assert.rejects(run(), /quota|429/)
      await run()
      assert.equal(effects, 1)
      assert.equal(cp.complete, true)
    } finally {
      m.mock.restore()
    }
  }
})

test('malformed tool responses never poison the context used by a continuation', async () => {
  for (const provider of ['gemini', 'openai', 'ollama'] as const) {
    const cp = checkpoint(),
      c: Continuation = { state: cp, save: async () => {} }
    let requests = 0,
      effects = 0
    const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      requests++
      if (requests > 1) {
        const body = JSON.parse(String(init.body))
        assert(!JSON.stringify(body).includes('invalid-call'))
        assert(!JSON.stringify(body).includes('bad-signature'))
      }
      if (provider === 'gemini') {
        const parts =
          requests === 1
            ? [0, 1].map(() => ({
                thoughtSignature: 'bad-signature',
                functionCall: {
                  id: 'invalid-call',
                  name: 'write_file',
                  args: { path: 'value.cjs', content: 'bad' },
                },
              }))
            : [{ text: 'finished' }]
        return new Response(
          'data: ' +
            JSON.stringify({
              candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
            }) +
            '\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      if (provider === 'openai')
        return Response.json({
          output:
            requests === 1
              ? [
                  {
                    type: 'function_call',
                    call_id: 'invalid-call',
                    name: 'write_file',
                    arguments: '{malformed',
                  },
                ]
              : [{ type: 'message', content: [{ type: 'output_text', text: 'finished' }] }],
        })
      return Response.json({
        message: {
          role: 'assistant',
          content: requests === 1 ? '' : 'finished',
          ...(requests === 1
            ? { tool_calls: [{ function: { name: 'invalid-call', arguments: 'invalid' } }] }
            : {}),
        },
      })
    })
    const options = {
      task: 'Inspect',
      model: 'model-double',
      apiKey: 'inert-recovery-key',
      endpoint: 'http://127.0.0.1:11434',
      tools: [],
      strategy: 'test',
      steering: () => [],
      signal: new AbortController().signal,
      continuation: c,
      execute: async () => {
        effects++
        return {}
      },
      onText: () => {},
    }
    try {
      const run = () =>
        provider === 'gemini'
          ? runGeminiAgent(options)
          : provider === 'openai'
            ? runLiveAgent(options)
            : runOllamaAgent(options)
      await assert.rejects(run(), /repeated|invalid tool/)
      assert.equal(cp.pending, undefined)
      assert.equal(effects, 0)
      await run()
      assert.equal(cp.complete, true)
      assert.equal(effects, 0)
    } finally {
      m.mock.restore()
    }
  }
})

test('restart retains reported retry guidance and enforces it before sending another request', async () => {
  const { engine, providers, repo } = await setup()
  let requests = 0,
    restored: CodingEngine | undefined
  const m = mock.method(globalThis, 'fetch', async () => {
    requests++
    return Response.json(
      { error: { code: 'rate_limit_exceeded' } },
      { status: 429, headers: { 'Retry-After': '120' } },
    )
  })
  try {
    const state = await engine.start(
      repo,
      'Controlled delayed recovery',
      'live',
      false,
      false,
      providers.state.selection!,
    )
    await settled(engine, state.id)
    const run = state.providerRuns![0]
    assert.equal(run.recovery?.kind, 'rate-limit')
    assert.equal(requests, 1)
    // Simulate a process death after retry guidance was durable, before terminal status was durable.
    state.busy = true
    run.status = 'running'
    await engine.persist(engine.sessions.get(state.id)!)
    await engine.close()
    restored = new CodingEngine(engine.base, providers)
    await restored.restore()
    const recovered = restored.state(state.id).providerRuns![0]
    assert.equal(recovered.status, 'interrupted')
    assert.equal(recovered.recovery?.waiting, false)
    assert.equal(recovered.recovery?.retryAfterMs, 120000)
    assert(recovered.recovery!.retryAt! > Date.now())
    await assert.rejects(restored.resume(state.id, run.id), /requires waiting/)
    assert.equal(requests, 1)
    assert.equal(restored.state(state.id).busy, false)
  } finally {
    m.mock.restore()
    await engine.close()
    await restored?.close()
  }
})

test(
  'failed-turn cleanup retains the active lock until checkpoint ownership is released',
  { timeout: 20000 },
  async () => {
    const { engine, providers, repo } = await setup()
    let blocked = true,
      held = false,
      release!: () => void,
      entered!: () => void
    const cleaning = new Promise<void>((r) => {
        entered = r
      }),
      continueCleanup = new Promise<void>((r) => {
        release = r
      })
    const realSave = engine.saveCheckpoint.bind(engine)
    engine.saveCheckpoint = async (runtime) => {
      if (!held && runtime.state.status === 'error' && runtime.checkpoint) {
        held = true
        entered()
        await continueCleanup
      }
      await realSave(runtime)
    }
    const m = mock.method(globalThis, 'fetch', async () => (blocked ? quota() : reply([])))
    try {
      const state = await engine.start(
        repo,
        'Controlled failed-turn cleanup',
        'live',
        false,
        false,
        providers.state.selection!,
      )
      await cleaning
      assert.equal(
        state.busy,
        true,
        'An interrupted turn is not idle while its checkpoint is being released',
      )
      const run = state.providerRuns![0]
      await assert.rejects(engine.resume(state.id, run.id), /active work/)
      await assert.rejects(
        engine.resolveTool(state.id, run.id, 'not-executed', 'skip'),
        /current operation/,
      )
      release()
      await engine.wait(state.id)
      assert.equal(state.busy, false)
      blocked = false
      await engine.resume(state.id, run.id)
      await settled(engine, state.id)
      assert.equal(run.status, 'completed')
      assert.equal(run.continuations, 1)
    } finally {
      release()
      m.mock.restore()
      await engine.close()
    }
  },
)
