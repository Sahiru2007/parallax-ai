import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { runGeminiAgent } from './gemini-provider.ts'
import {
  geminiContext,
  jsonBytes,
  measureGeminiRequest,
  modelToolResult,
  sourceRange,
} from './model-context.ts'
import { CodingEngine } from './coding-engine.ts'
import { ProviderSettingsStore } from './provider-settings.ts'
import { git } from './process.ts'
import { rememberSecret } from './provider-secrets.ts'

test('file range pagination reports delivered lines without skipping text at the character bound', () => {
  const text = [
    '',
    ...Array.from({ length: 160 }, (_, i) => String(i).padStart(3, '0') + 'x'.repeat(100)),
  ].join('\n')
  const chunks: string[] = []
  let start = 1
  while (start <= text.split('\n').length) {
    const r = sourceRange(text, start, 120)
    chunks.push(r.content)
    if (r.nextStartLine === undefined) break
    assert(r.nextStartLine > start)
    start = r.nextStartLine
  }
  assert.equal(chunks.join('\n'), text)
  assert.throws(() => sourceRange('one', 2, 1), /exceeds/)
  assert.equal(sourceRange('x'.repeat(6000), 1, 120).partialLine, true)
})

const reply = (name?: string, args: Record<string, unknown> = {}) =>
  new Response(
    'data: ' +
      JSON.stringify({
        modelVersion: 'context-budget-double',
        candidates: [
          {
            content: {
              role: 'model',
              parts: name
                ? [
                    {
                      thoughtSignature: 'KEEP_OPAQUE_SIGNATURE',
                      functionCall: { id: name, name, args },
                    },
                  ]
                : [{ text: 'Verified retained work.' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
      }) +
      '\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

test('actual Gemini body bounds tool history without editing task, signatures or function-call IDs; metrics contain counts only', async () => {
  const source = 'PRIVATE_SOURCE_SENTINEL\n' + 'x'.repeat(80_000)
  const output = JSON.stringify({
    stats: { tests: 5000, passes: 4999, failures: 1 },
    failures: ['REAL_FAILURE'],
    passes: ['p'.repeat(145_000)],
  })
  const native = [
    { role: 'user', parts: [{ text: 'ORIGINAL_TASK_KEEP' }] },
    ...['read_file', 'search_files', 'run_command', 'read_file', 'inspect_diff'].flatMap(
      (name, i) => [
        {
          role: 'model',
          parts: [
            { thoughtSignature: 'SIGNED_' + i, functionCall: { id: 'call-' + i, name, args: {} } },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call-' + i,
                name,
                response: {
                  result:
                    name === 'run_command'
                      ? {
                          id: 'check',
                          status: 'failed',
                          exitCode: 1,
                          digest: 'digest',
                          output,
                          stdout: output,
                          stderr: '',
                        }
                      : name === 'search_files'
                        ? Array.from({ length: 200 }, (_, n) => `${n}: ${source.slice(0, 500)}`)
                        : source,
                },
              },
            },
          ],
        },
      ],
    ),
  ]
  const options = {
    task: 'unused',
    model: 'models/double',
    apiKey: 'inert-size-key',
    signal: new AbortController().signal,
    tools: [],
    instructions: 'KEEP_REPOSITORY_INSTRUCTIONS',
    onText: () => {},
    execute: async () => null,
  }
  const c = {
    state: {
      version: 1 as const,
      context: native,
      ledger: [],
      rounds: 0,
      allowance: 2,
      sourceDigest: 'digest',
      requests: 0,
      retry: { attempts: 0, totalAttempts: 0, allowanceWaitMs: 0, totalWaitMs: 0 },
    },
    save: async () => {},
  }
  const measured: unknown[] = []
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = String(init.body),
      parsed = JSON.parse(body)
    const originalBytes = jsonBytes({ ...parsed, contents: native })
    assert(Buffer.byteLength(body) < originalBytes / 10)
    assert.match(body, /ORIGINAL_TASK_KEEP|KEEP_REPOSITORY_INSTRUCTIONS/)
    for (let i = 0; i < 5; i++) assert.deepEqual(parsed.contents[1 + i * 2], native[1 + i * 2])
    assert.deepEqual(
      parsed.contents
        .filter((_: unknown, i: number) => i > 0 && i % 2 === 0)
        .map(
          (v: { parts: { functionResponse: { id: string } }[] }) => v.parts[0].functionResponse.id,
        ),
      Array.from({ length: 5 }, (_, i) => 'call-' + i),
    )
    assert(!body.includes('"stdout"'))
    assert.equal((measured[0] as { bytes: number }).bytes, Buffer.byteLength(body))
    return reply()
  })
  try {
    await runGeminiAgent({ ...options, continuation: c, onRequest: (size) => measured.push(size) })
  } finally {
    m.mock.restore()
  }
  assert.doesNotMatch(
    JSON.stringify(measured),
    /PRIVATE_SOURCE|inert-size|SIGNED_|ORIGINAL_TASK|check|REAL_FAILURE/,
  )
  assert.equal(c.state.rounds, 1)
  const projected = geminiContext(native)
  assert(jsonBytes(projected) < jsonBytes(native) / 10)
  assert.match(
    JSON.stringify(
      modelToolResult('run_command', { id: 'c', output, exitCode: 1, status: 'failed' }),
    ),
    /"failures":1/,
  )
})

test('oversized mandatory signed context is a visible blocker, never silently damaged or sent', async () => {
  const modelPart = {
    thoughtSignature: 'IMMUTABLE',
    functionCall: { id: 'id', name: 'write_file', args: { content: 'x'.repeat(520_000) } },
  }
  const c = {
    state: {
      version: 1 as const,
      context: [
        { role: 'user', parts: [{ text: 'task' }] },
        { role: 'model', parts: [modelPart] },
      ],
      ledger: [],
      rounds: 0,
      allowance: 2,
      sourceDigest: 'd',
      requests: 0,
      retry: { attempts: 0, totalAttempts: 0, allowanceWaitMs: 0, totalWaitMs: 0 },
    },
    save: async () => {},
  }
  const m = mock.method(globalThis, 'fetch', async () => {
    throw new Error('Must not send')
  })
  try {
    await assert.rejects(
      runGeminiAgent({
        task: 'task',
        model: 'models/double',
        apiKey: 'inert',
        tools: [],
        signal: new AbortController().signal,
        continuation: c,
        onText: () => {},
        execute: async () => null,
      }),
      /512 KB model-context budget/,
    )
    assert.equal(m.mock.callCount(), 0)
    assert.equal(c.state.context[1].parts[0], modelPart)
  } finally {
    m.mock.restore()
  }
})

test('large output, equivalent reads, precise edit/focused check, complete logs and restart/resume retain evidence without duplicate execution', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'parallax-context-budget-'))),
    repo = join(dir, 'repo with spaces'),
    sessions = join(dir, 'sessions')
  await mkdir(repo)
  await writeFile(
    join(repo, 'AGENTS.md'),
    'Keep ORIGINAL_RULES. Use node --test focused.test.cjs; preserve unrelated files.\n',
  )
  await writeFile(join(repo, 'value.cjs'), 'module.exports=0;\n')
  await writeFile(
    join(repo, 'large.cjs'),
    Array.from({ length: 3000 }, (_, n) => `// INSPECT_MARK ${n} ${'x'.repeat(80)}`).join('\n'),
  )
  await writeFile(
    join(repo, 'focused.test.cjs'),
    "const fs=require('node:fs'),assert=require('node:assert/strict');fs.appendFileSync('.execution-count','x');assert.equal(require('./value.cjs'),1);console.log('FOCUSED_TEST_PASSED');\n",
  )
  await writeFile(
    join(repo, 'large-output.cjs'),
    "console.log('BEGIN_COMPLETE_OUTPUT');console.log(JSON.stringify({stats:{tests:7000,passes:6999,failures:1},tests:Array.from({length:10000},()=>({fullTitle:'case '+ 'x'.repeat(200)})),failures:[{fullTitle:'EXPECTED_FIXTURE_FAILURE'}]} ,null,2));console.log('END_COMPLETE_OUTPUT');\n",
  )
  await writeFile(join(repo, '.gitignore'), '.execution-count\n')
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
    get: async () => 'inert-control-key',
    set: async () => {},
    remove: async () => {},
  }
  const providers = new ProviderSettingsStore(join(dir, 'providers.json'), key, key)
  await providers.restore()
  providers.state.testTransport = true
  providers.state.gemini.models = ['models/context-double']
  providers.state.gemini.checks['models/context-double'] = {
    ok: true,
    at: new Date().toISOString(),
    message: 'Controlled',
  }
  const selection = providers.selectionFrom('gemini', 'models/context-double')
  selection.maxToolRounds = 18
  providers.state.selection = selection
  let engine = new CodingEngine(sessions, providers)
  await engine.restore()
  let round = 0,
    blocked = true,
    checkId = '',
    largeCheckId = ''
  const sizes: number[] = []
  const focused = { executable: 'node', args: ['--test', 'focused.test.cjs'], cwd: '.' }
  const m = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    round++
    const body = String(init.body),
      parsed = JSON.parse(body)
    sizes.push(Buffer.byteLength(body))
    assert.match(body, /ORIGINAL_RULES/)
    assert(!body.includes('"stdout"'))
    const responses = parsed.contents
      .flatMap((v: { parts: unknown[] }) => v.parts)
      .filter((p: { functionResponse?: unknown }) => p.functionResponse)
    const last = responses.at(-1)?.functionResponse?.response?.result
    if (round === 1) return reply('read_file', { path: 'large.cjs' })
    if (round === 2) return reply('search_files', { query: 'INSPECT_MARK' })
    if (round === 3)
      return reply('read_file_range', { path: './large.cjs', start_line: 1, line_count: 120 })
    if (round === 4) {
      assert.match(JSON.stringify(last), /Investigation has not changed source/)
      return reply('run_command', {
        executable: 'node',
        args: ['node', '--test', 'focused.test.cjs'],
        cwd: '.',
      })
    }
    if (round === 5) {
      assert.match(JSON.stringify(last), /executable is duplicated/)
      return reply('run_command', { executable: 'node', args: ['large-output.cjs'], cwd: '.' })
    }
    if (round === 6) {
      assert.equal(last.testStats.tests, 7000)
      largeCheckId = last.id
      return reply('search_check_output', {
        check_id: largeCheckId,
        query: 'EXPECTED_FIXTURE_FAILURE',
      })
    }
    if (round === 7) {
      assert.match(JSON.stringify(last), /EXPECTED_FIXTURE_FAILURE/)
      return reply('replace_in_file', {
        path: 'value.cjs',
        old_text: 'module.exports=0;',
        new_text: 'module.exports=1;',
      })
    }
    if (round === 8) return reply('run_command', focused)
    if (round === 9) {
      checkId = last.id
      if (blocked)
        return Response.json({ error: { message: 'Controlled interruption' } }, { status: 400 })
    }
    if (round === 10)
      return reply('run_command', { cwd: '.', args: focused.args, executable: 'node' })
    assert.equal(last.id, checkId)
    return reply()
  })
  async function settled() {
    for (let i = 0; i < 2000; i++) {
      const s = engine.list()[0]
      if (s && !s.busy) return s
      if (s?.approval) engine.approve(s.id, s.approval.id, true)
      await delay(10)
    }
    throw new Error('Fixture did not settle')
  }
  try {
    const s = await engine.start(
      repo,
      'Investigate the fixture and make value equal one. Preserve the original task and approved checks.',
      'live',
      false,
      false,
      selection,
    )
    await settled()
    assert.equal(s.providerRuns![0].status, 'interrupted')
    assert(s.events.some((e) => e.title === 'Investigation progress check'))
    assert.equal(s.checks.length, 2, 'Malformed command never executes or asks approval')
    assert(s.checks.at(-1)!.status === 'passed')
    assert(s.providerRuns![0].requestSizes!.every((v, i) => v.bytes === sizes[i]))
    const log = await engine.checkOutputFile(s.id, largeCheckId),
      complete = await readFile(log, 'utf8')
    assert(complete.length > 150_000)
    assert(complete.startsWith('BEGIN_COMPLETE_OUTPUT'))
    assert.match(complete, /END_COMPLETE_OUTPUT/)
    const candidate = s.candidates[0],
      before = (await stat(join(candidate.worktree, 'value.cjs'))).mtimeMs
    assert.equal(await readFile(join(candidate.worktree, '.execution-count'), 'utf8'), 'x')
    const cp = JSON.parse(
      await readFile(join(sessions, s.id, `agent-${s.providerRuns![0].id}.json`), 'utf8'),
    )
    const edit = cp.ledger.find((c: { name: string }) => c.name === 'replace_in_file')
    assert(edit.expectedFileDigest)
    await engine.close()
    engine = new CodingEngine(sessions, providers)
    await engine.restore()
    blocked = false
    await engine.resume(s.id, s.providerRuns![0].id)
    const restored = await settled()
    assert.equal(restored.providerRuns![0].status, 'completed')
    assert.equal(await readFile(join(candidate.worktree, '.execution-count'), 'utf8'), 'x')
    assert.equal((await stat(join(candidate.worktree, 'value.cjs'))).mtimeMs, before)
    assert.equal(restored.checks.filter((c) => c.status !== 'skipped').length, 2)
    assert.equal(await readFile(await engine.checkOutputFile(s.id, largeCheckId), 'utf8'), complete)
    assert.equal(await readFile(join(repo, 'value.cjs'), 'utf8'), 'module.exports=0;\n')
    assert(restored.providerRuns![0].requestSizes!.every((v) => v.bytes < 60_000))
    const runtime = engine.sessions.get(s.id)!,
      run = restored.providerRuns![0]
    const firstPage = (await engine.tool(runtime, candidate, 'search_files', {
      query: 'INSPECT_MARK',
    })) as { items: string[]; nextOffset: number; totalMatches: number }
    const nextPage = (await engine.tool(runtime, candidate, 'search_files_page', {
      query: 'INSPECT_MARK',
      offset: firstPage.nextOffset,
    })) as { items: string[]; offset: number }
    assert.equal(firstPage.totalMatches, 3000)
    assert(firstPage.items.length <= 40)
    assert.equal(nextPage.offset, firstPage.items.length)
    assert.notEqual(nextPage.items[0], firstPage.items[0])
    await engine.attachCheckpoint(runtime, candidate, run, '', true)
    const uncertain = runtime.checkpoint!.ledger.find((c) => c.name === 'replace_in_file')!
    uncertain.status = 'uncertain'
    assert.equal(
      await engine.inspectTool(runtime, candidate, uncertain),
      'completed',
      'Interrupted replacement recovered by expected content hash',
    )
    await assert.rejects(
      engine.tool(runtime, candidate, 'read_check_output', {
        check_id: 'another-candidate-check',
        start_line: 1,
        line_count: 10,
      }),
      /belonging to this candidate/,
    )
    await assert.rejects(
      engine.tool(runtime, candidate, 'replace_in_file', {
        path: 'value.cjs',
        old_text: 'absent',
        new_text: 'anything',
      }),
      /exactly once/,
    )
  } finally {
    m.mock.restore()
    await engine.close()
  }
})

test('diagnostic counters never retain registered secrets or source text', () => {
  rememberSecret('NOT_A_REAL_CREDENTIAL')
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: 'NOT_A_REAL_CREDENTIAL SOURCE_TEXT' }] },
    tools: [],
    contents: [{ role: 'user', parts: [{ text: 'SOURCE_TEXT' }] }],
  })
  const counters = measureGeminiRequest(body, 1)
  assert.equal(counters.bytes, Buffer.byteLength(body))
  assert.doesNotMatch(JSON.stringify(counters), /SOURCE_TEXT|CREDENTIAL|parts|text/)
})
