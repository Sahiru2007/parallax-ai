import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { CodingEngine } from './coding-engine.ts'
import { ProviderSettingsStore } from './provider-settings.ts'
import { git } from './process.ts'
import { providerRequest, retryBounds, serviceUnavailableInfo } from './provider-retry.ts'
import type { AgentCheckpoint } from './continuation.ts'
import type { RecoveryInfo } from '../shared/providers.ts'
import { geminiContext } from './model-context.ts'

const unavailable = (seconds?: string) =>
  Response.json(
    { error: { status: 'UNAVAILABLE', message: 'controlled unavailable' } },
    { status: 503, headers: seconds ? { 'Retry-After': seconds } : {} },
  )
const args = { executable: 'node', args: ['check.cjs'], cwd: '.' }
const batch = [
  { name: 'write_file', args: { path: 'value.cjs', content: 'module.exports=1;\n' } },
  { name: 'run_command', args },
]
function reply(
  calls: { name: string; args: Record<string, unknown> }[] = [],
  tag = 'reply',
  text = 'Controlled completion',
) {
  return new Response(
    'data: ' +
      JSON.stringify({
        modelVersion: 'EXPLICIT_503_DOUBLE',
        candidates: [
          {
            content: {
              role: 'model',
              parts: calls.length
                ? calls.map((call, i) => ({
                    thoughtSignature: 'signed-503-context',
                    functionCall: { id: tag + '-' + i, ...call },
                  }))
                : [{ text }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
      }) +
      '\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
async function setup() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'parallax-service-'))),
    repo = join(dir, 'repo with spaces'),
    base = join(dir, 'sessions')
  await mkdir(repo)
  await writeFile(join(repo, 'value.cjs'), 'module.exports=0;\n')
  await writeFile(join(repo, '.gitignore'), '.effect-count\n')
  await writeFile(
    join(repo, 'check.cjs'),
    "const fs=require('node:fs'),assert=require('node:assert/strict');fs.appendFileSync('.effect-count','x');assert.equal(require('./value.cjs'),1);console.log('actual check passed');\n",
  )
  await git(repo, ['init', '--initial-branch=main'])
  await git(repo, ['add', '.'])
  await git(repo, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@parallax.invalid',
    'commit',
    '-m',
    'Baseline',
  ])
  const key = {
    available: true,
    get: async () => 'inert-service-test-key',
    set: async () => {},
    remove: async () => {},
  }
  const providers = new ProviderSettingsStore(join(dir, 'providers.json'), key, key)
  await providers.restore()
  providers.state.testTransport = true
  providers.state.gemini.models = ['models/service-double']
  providers.state.gemini.checks['models/service-double'] = {
    ok: true,
    at: new Date().toISOString(),
    message: 'Controlled provider',
  }
  const selection = providers.selectionFrom('gemini', 'models/service-double')
  selection.maxToolRounds = 18
  providers.state.selection = selection
  const engine = new CodingEngine(base, providers)
  await engine.restore()
  return { dir, repo, base, providers, selection, engine }
}
async function settled(engine: CodingEngine, id: string) {
  for (let i = 0; i < 2000; i++) {
    const s = engine.state(id)
    if (!s.busy) return s
    if (s.approval) engine.approve(id, s.approval.id, true)
    await delay(10)
  }
  throw new Error('Controlled turn did not stop')
}
test('one transient 503 retries the same measured request and reuses completed effects at the pinned model/worktree', async () => {
  const f = await setup(),
    bodies: string[] = [],
    statuses: RecoveryInfo[] = []
  let injected = false,
    stamp = 0
  const m = mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    assert.match(String(url), /models\/service-double:streamGenerateContent/)
    const body = String(init.body)
    bodies.push(body)
    const parsed = JSON.parse(body)
    const count = parsed.contents
      .flatMap((c: { parts: unknown[] }) => c.parts)
      .filter((p: { functionResponse?: unknown }) => p.functionResponse).length
    if (!count) return reply(batch, 'initial')
    if (!injected) {
      injected = true
      stamp = (await stat(join(f.engine.list()[0].candidates[0].worktree, 'value.cjs'))).mtimeMs
      f.providers.state.selection = { provider: 'openai', model: 'different-default' }
      return unavailable()
    }
    return count === 2 ? reply(batch, 'duplicate') : reply()
  })
  try {
    const s = await f.engine.start(
      f.repo,
      'Controlled transient 503 recovery',
      'live',
      false,
      false,
      f.selection,
    )
    const worktree = () => s.candidates[0].worktree
    f.engine.updates.on(s.id, () => {
      const r = s.providerRuns?.[0]?.recovery
      if (r) statuses.push({ ...r })
    })
    await settled(f.engine, s.id)
    const run = s.providerRuns![0]
    assert.equal(run.status, 'completed')
    assert.equal(run.model, 'models/service-double')
    assert.equal(run.maxToolRounds, 18)
    assert.equal(
      bodies[1],
      bodies[2],
      'Retry must resend the same serialized body, not reconstruct or replay tools',
    )
    assert.equal(await readFile(join(worktree(), '.effect-count'), 'utf8'), 'x')
    assert.equal((await stat(join(worktree(), 'value.cjs'))).mtimeMs, stamp)
    assert.equal(s.checks.filter((c) => c.status === 'passed').length, 1)
    assert.equal(run.autoRetries, 1)
    assert(statuses.some((r) => r.kind === 'unavailable' && r.waiting))
    assert(statuses.some((r) => /recovered after/.test(r.message)))
    assert.deepEqual(
      run.requestSizes!.map((r) => r.bytes),
      bodies.map((b) => Buffer.byteLength(b)),
    )
    assert.deepEqual(
      run.requestSizes!.map((r) => r.round),
      [1, 2, 2, 3],
    )
    assert.equal(await readFile(join(f.repo, 'value.cjs'), 'utf8'), 'module.exports=0;\n')
  } finally {
    m.mock.restore()
    await f.engine.close()
  }
})
test('persistent 503 exhausts shared bounds, then exact restart/resume keeps effects, allowance and native context', async () => {
  const f = await setup()
  let engine = f.engine,
    blocked = true,
    stamp = 0
  const bodies: string[] = []
  const m = mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    assert.match(String(url), /models\/service-double:streamGenerateContent/)
    const body = String(init.body)
    bodies.push(body)
    const parsed = JSON.parse(body),
      count = parsed.contents
        .flatMap((c: { parts: unknown[] }) => c.parts)
        .filter((p: { functionResponse?: unknown }) => p.functionResponse).length
    if (!count) return reply(batch, 'initial')
    if (blocked) {
      if (!stamp)
        stamp = (await stat(join(engine.list()[0].candidates[0].worktree, 'value.cjs'))).mtimeMs
      return unavailable()
    }
    return count === 2 ? reply(batch, 'duplicate-resumed') : reply()
  })
  try {
    const s = await engine.start(
      f.repo,
      'Controlled persistent 503',
      'live',
      false,
      false,
      f.selection,
    )
    await settled(engine, s.id)
    const run = s.providerRuns![0],
      worktree = s.candidates[0].worktree
    assert.equal(run.recovery?.kind, 'unavailable')
    assert.match(run.recovery!.message, /retry limit/)
    assert.equal(run.autoRetries, retryBounds.maxRetries)
    assert.equal(run.requests, 4)
    assert.equal(run.rounds, 2)
    assert.deepEqual(bodies.slice(1), [bodies[1], bodies[1], bodies[1]])
    const checkpoint = JSON.parse(
      await readFile(join(f.base, s.id, 'agent-' + run.id + '.json'), 'utf8'),
    ) as AgentCheckpoint
    assert.equal(checkpoint.allowance, 18)
    assert.equal(checkpoint.ledger.length, 2)
    await engine.close()
    engine = new CodingEngine(f.base, f.providers)
    await engine.restore()
    blocked = false
    f.providers.state.selection = { provider: 'openai', model: 'wrong-default' }
    const start = bodies.length
    await engine.resume(s.id, run.id)
    const next = await settled(engine, s.id),
      resumed = next.providerRuns![0]
    assert.deepEqual(JSON.parse(bodies[start]).contents, geminiContext(checkpoint.context!))
    assert.equal(JSON.parse(bodies[start]).systemInstruction.parts[0].text, checkpoint.instructions)
    assert.equal(next.candidates[0].worktree, worktree)
    assert.equal(resumed.model, 'models/service-double')
    assert.equal(resumed.maxToolRounds, 18)
    assert.equal(resumed.status, 'completed')
    assert.equal(await readFile(join(worktree, '.effect-count'), 'utf8'), 'x')
    assert.equal((await stat(join(worktree, 'value.cjs'))).mtimeMs, stamp)
    assert.deepEqual(
      resumed.requestSizes!.map((r) => r.bytes),
      bodies.map((b) => Buffer.byteLength(b)),
    )
    assert(resumed.calls!.some((c) => c.detail?.includes('Reused durable receipt')))
    assert.equal(resumed.continuations, 1)
  } finally {
    m.mock.restore()
    await engine.close()
  }
})
test('A/B isolation survives a 503 retry with shared baseline and independent private evidence', async () => {
  const f = await setup()
  let interrupted = false
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = String(init.body),
      request = JSON.parse(body)
    const candidate = /Candidate: Approach ([AB])\./.exec(
      request.systemInstruction.parts[0].text,
    )![1]
    const peer = candidate === 'A' ? 'B' : 'A'
    assert(
      !body.includes(peer + '_PRIVATE_'),
      'Peer conversation, source or tools must not cross candidate context',
    )
    const responses = request.contents
      .flatMap((c: { parts: unknown[] }) => c.parts)
      .filter((p: { functionResponse?: unknown }) => p.functionResponse)
    if (!responses.length)
      return reply([{ name: 'read_file', args: { path: 'value.cjs' } }], candidate + '-read')
    if (responses.length === 1) {
      assert(
        JSON.stringify(responses[0]).includes('module.exports=0;'),
        'Both start from the same baseline',
      )
      return reply(
        [
          {
            name: 'write_file',
            args: {
              path: 'value.cjs',
              content: `module.exports=1; // ${candidate}_PRIVATE_PATCH\n`,
            },
          },
          {
            name: 'run_command',
            args: { ...args, args: ['check.cjs', candidate + '_PRIVATE_TOOL'] },
          },
        ],
        candidate + '-tools',
      )
    }
    if (candidate === 'B' && !interrupted) {
      interrupted = true
      return unavailable()
    }
    return reply([], candidate + '-done', candidate + '_PRIVATE_REPLY')
  })
  try {
    const s = await f.engine.start(
      f.repo,
      'Shared task; isolated candidate investigation',
      'live',
      true,
      false,
      f.selection,
      true,
    )
    await settled(f.engine, s.id)
    const a = s.candidates[0],
      patch = a.patch
    await f.engine.generateNext(s.id, 'b')
    await settled(f.engine, s.id)
    const b = s.candidates[1]
    assert.notEqual(a.worktree, b.worktree)
    assert.equal(a.patch, patch)
    assert(a.patch.includes('A_PRIVATE_PATCH') && !a.patch.includes('B_PRIVATE_'))
    assert(b.patch.includes('B_PRIVATE_PATCH') && !b.patch.includes('A_PRIVATE_'))
    assert.equal(s.providerRuns![1].autoRetries, 1)
    for (const c of s.candidates)
      assert.equal(await readFile(join(c.worktree, '.effect-count'), 'utf8'), 'x')
    assert(
      s.messages.some((v) => v.content === 'A_PRIVATE_REPLY') &&
        s.messages.some((v) => v.content === 'B_PRIVATE_REPLY'),
    )
  } finally {
    m.mock.restore()
    await f.engine.close()
  }
})

test('503 guidance honors headers/RetryInfo, rejects excessive delays, and waiting is cancellable', async () => {
  const info = await serviceUnavailableInfo(
    'gemini',
    Response.json(
      {
        error: {
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.5s' }],
        },
      },
      { status: 503, headers: { 'Retry-After': '0.25' } },
    ),
  )
  assert.equal(info.kind, 'unavailable')
  assert.equal(info.retryAfterMs, 500)
  const checkpoint = (): AgentCheckpoint => ({
    version: 1,
    rounds: 1,
    allowance: 18,
    ledger: [],
    sourceDigest: 'd',
    requests: 0,
    retry: { attempts: 0, totalAttempts: 0, allowanceWaitMs: 0, totalWaitMs: 0 },
  })
  let sends = 0
  const cp = checkpoint()
  await assert.rejects(
    providerRequest(
      'gemini',
      async () => {
        sends++
        return unavailable('120')
      },
      new AbortController().signal,
      { state: cp, save: async () => {} },
    ),
    /waiting budget/,
  )
  assert.equal(sends, 1)
  assert.equal(cp.retry.totalAttempts, 0)
  const abort = new AbortController(),
    waiting = checkpoint()
  sends = 0
  await assert.rejects(
    providerRequest(
      'gemini',
      async () => {
        sends++
        return unavailable('10')
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
  assert.equal(waiting.retry.totalAttempts, 1)
  assert(waiting.retry.totalWaitMs < 1000)
})
