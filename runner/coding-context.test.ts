import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { CodingEngine } from './coding-engine.ts'
import { ProviderSettingsStore } from './provider-settings.ts'
import { git } from './process.ts'
import { newScenario } from '../shared/project-replay.ts'

test('comparison isolates conversation, tools, files and patches through follow-up, restore and resume', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'parallax-context-'))),
    repo = join(dir, 'source'),
    sessions = join(dir, 'sessions')
  await mkdir(repo)
  await writeFile(join(repo, 'value.cjs'), "module.exports='SHARED_BASELINE';\n")
  await git(repo, ['init', '--initial-branch=main'])
  await git(repo, ['add', '.'])
  await git(repo, [
    '-c',
    'user.name=Context Test',
    '-c',
    'user.email=context@parallax.invalid',
    'commit',
    '-m',
    'Shared baseline',
  ])
  const baseline = await git(repo, ['rev-parse', 'HEAD'])
  const credential = {
    available: true,
    get: async () => 'inert-context-key',
    set: async () => {},
    remove: async () => {},
  }
  const providers = new ProviderSettingsStore(join(dir, 'providers.json'), credential, credential)
  await providers.restore()
  providers.state.testTransport = true
  providers.state.gemini.models = ['models/context-double']
  providers.state.gemini.checks['models/context-double'] = {
    ok: true,
    at: new Date().toISOString(),
    message: 'Controlled context test',
  }
  const selection = providers.selectionFrom('gemini', 'models/context-double')
  providers.state.selection = selection
  const requests: { candidate: string; turn: number; round: number; body: string }[] = []
  const counts = new Map<string, number>()
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = String(init.body),
      parsed = JSON.parse(body)
    const candidate = /Candidate: Approach ([AB])\./.exec(
      parsed.systemInstruction.parts[0].text,
    )![1]
    const turn = body.includes('SHARED_FOLLOWUP_TASK') ? 2 : 1
    const key = `${candidate}-${turn}`,
      round = (counts.get(key) ?? 0) + 1
    counts.set(key, round)
    requests.push({ candidate, turn, round, body })
    if (candidate === 'B' && turn === 2 && round === 3)
      return Response.json(
        { error: { message: 'Controlled interruption after the edit' } },
        { status: 400 },
      )
    const call = (name: string, args: Record<string, unknown>) => ({
      functionCall: { name, args, id: `${key}-${round}` },
      thoughtSignature: 'context-signature',
    })
    let parts: unknown[]
    if (round === 1) parts = [call('read_file', { path: 'value.cjs' })]
    else if (turn === 1 && round === 2)
      parts = [
        call('run_command', {
          executable: 'node',
          args: ['-e', `console.log('${candidate}_PRIVATE_TOOL_RESULT')`],
          cwd: '.',
        }),
      ]
    else if ((turn === 1 && round === 3) || (turn === 2 && round === 2))
      parts = [
        call('write_file', {
          path: 'value.cjs',
          content: `module.exports='${candidate}_PRIVATE_PATCH_${turn}';\n`,
        }),
      ]
    else parts = [{ text: `${candidate}_PRIVATE_CONVERSATION_${turn}` }]
    return new Response(
      `data: ${JSON.stringify({ modelVersion: 'context-double', candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  })
  let engine = new CodingEngine(sessions, providers)
  async function stopped(id: string, ready = true) {
    const deadline = Date.now() + 30000
    while (engine.state(id).busy && Date.now() < deadline) {
      const s = engine.state(id)
      if (s.approval) {
        assert.equal(
          s.approval.cwd,
          s.candidates.find((c) => c.id === s.approval!.candidate)!.worktree,
        )
        engine.approve(id, s.approval.id, true)
      }
      await delay(20)
    }
    const s = engine.state(id)
    assert.equal(s.busy, false)
    if (ready) assert.equal(s.status, 'ready', s.error)
    return s
  }
  try {
    await engine.restore()
    let s = await engine.start(
      repo,
      'SHARED_ORIGINAL_TASK improve the value.',
      'live',
      true,
      false,
      selection,
      true,
    )
    const id = s.id
    await stopped(id)
    assert.equal(
      await readFile(join(s.candidates[1].worktree, 'value.cjs'), 'utf8'),
      "module.exports='SHARED_BASELINE';\n",
    )
    await engine.generateNext(id, 'b')
    s = await stopped(id)
    for (const c of s.candidates)
      assert.equal(await git(c.worktree, ['rev-parse', 'HEAD']), baseline)
    assert.notEqual(s.candidates[0].worktree, s.candidates[1].worktree)
    s.projectReplay = {
      saved: {
        revision: 1,
        digest: 'shared-scenario',
        scenario: { ...newScenario, name: 'SHARED_SAVED_SCENARIO' },
      },
      proposal: { ...newScenario, name: 'UNACCEPTED_PRIVATE_PROPOSAL' },
      order: [],
      orderRevision: 0,
      runs: ['baseline', 'a', 'b'].map((version) => ({
        id: version,
        version,
        attemptId: 'controlled-fixture',
        startedAt: new Date().toISOString(),
        scenarioRevision: 1,
        scenarioDigest: 'shared-scenario',
        sourceDigest: 'fixture',
        baselineRevision: baseline,
        order: [],
        orderRevision: 0,
        status: 'passed',
        events: [],
        coverage: { seen: [], cancelled: [], missing: [], unexpected: [], different: false },
        finalTexts: [],
        durationMs: 0,
        output:
          version === 'baseline'
            ? 'SHARED_BASELINE_EVIDENCE'
            : `${version.toUpperCase()}_PRIVATE_REPLAY_EVIDENCE`,
      })),
    }
    for (const c of s.candidates) {
      const result = await engine.tool(engine.sessions.get(id)!, c, 'inspect_replay', {})
      const serialized = JSON.stringify(result)
      assert.match(serialized, /SHARED_BASELINE_EVIDENCE/)
      assert.doesNotMatch(
        serialized,
        new RegExp(`${c.id === 'a' ? 'B' : 'A'}_PRIVATE_|UNACCEPTED_PRIVATE_PROPOSAL`),
      )
    }
    // Legacy conversations remain available for user review, but have no reliable owner.
    s.messages.push({ role: 'assistant', content: 'UNATTRIBUTED_LEGACY_MESSAGE', turn: 1 })
    await engine.review(id)
    engine = new CodingEngine(sessions, providers)
    await engine.restore()
    await engine.followup(id, 'SHARED_FOLLOWUP_TASK continue each own implementation.')
    await stopped(id)
    await engine.generateNext(id, 'b')
    s = await stopped(id, false)
    const interrupted = s.providerRuns!.at(-1)!
    assert.equal(interrupted.candidate, 'b')
    assert.equal(interrupted.status, 'interrupted')
    const receipts = interrupted.calls!.map((c) => c.id)
    const checkpointFile = join(sessions, id, `agent-${interrupted.id}.json`)
    const checkpointBytes = await readFile(checkpointFile)
    const legacy = JSON.parse(checkpointBytes.toString())
    delete legacy.contextIsolationVersion
    delete legacy.candidate
    await writeFile(checkpointFile, JSON.stringify(legacy))
    engine = new CodingEngine(sessions, providers)
    await engine.restore()
    const priorRequests = requests.length
    await assert.rejects(engine.resume(id, interrupted.id), /predates verified candidate isolation/)
    assert.equal(
      requests.length,
      priorRequests,
      'Unsafe historical contexts must not reach a provider',
    )
    await writeFile(checkpointFile, checkpointBytes)
    await engine.resume(id, interrupted.id)
    s = await stopped(id)
    assert.deepEqual(
      s.providerRuns!.at(-1)!.calls!.map((c) => c.id),
      receipts,
      'Resume must reuse completed tools',
    )
    assert.equal(counts.get('B-2'), 4)
    for (const c of s.candidates) {
      const name = c.id.toUpperCase(),
        peer = name === 'A' ? 'B' : 'A'
      assert.equal(
        await readFile(join(c.worktree, 'value.cjs'), 'utf8'),
        `module.exports='${name}_PRIVATE_PATCH_2';\n`,
      )
      assert.match(c.patch, new RegExp(`${name}_PRIVATE_PATCH_2`))
      assert.doesNotMatch(c.patch, new RegExp(`${peer}_PRIVATE_`))
    }
    assert.equal(
      await readFile(join(repo, 'value.cjs'), 'utf8'),
      "module.exports='SHARED_BASELINE';\n",
    )
    const runtime = engine.sessions.get(id)!
    await assert.rejects(
      engine.tool(runtime, s.candidates[0], 'read_file', { path: '../b/value.cjs' }),
      /must stay inside the worktree/,
    )
    await assert.rejects(
      engine.tool(runtime, s.candidates[0], 'write_file', {
        path: join(s.candidates[1].worktree, 'value.cjs'),
        content: 'CROSS_CANDIDATE_WRITE',
      }),
      /must stay inside the worktree/,
    )
    for (const req of requests) {
      const peer = req.candidate === 'A' ? 'B' : 'A'
      assert.doesNotMatch(
        req.body,
        new RegExp(`${peer}_PRIVATE_|UNATTRIBUTED_LEGACY_MESSAGE`),
        `${req.candidate} turn${req.turn} round${req.round} must not receive peer context`,
      )
      assert.match(req.body, /SHARED_ORIGINAL_TASK/)
      if (req.turn === 2) {
        assert.match(req.body, /SHARED_FOLLOWUP_TASK/)
        assert.match(req.body, new RegExp(`${req.candidate}_PRIVATE_CONVERSATION_1`))
        assert.match(req.body, new RegExp(`${req.candidate}_PRIVATE_TOOL_RESULT`))
      }
    }
    for (const name of ['A', 'B']) {
      const first = requests.find((r) => r.candidate === name && r.turn === 1 && r.round === 2)!
      assert.match(first.body, /SHARED_BASELINE/, 'Both read identical source before their edits')
      assert(
        s.messages.some((m) => m.content === `${name}_PRIVATE_CONVERSATION_2`),
        'Both conversations remain visible in review state',
      )
      assert(
        s.messages.some(
          (m) =>
            m.content === `${name}_PRIVATE_CONVERSATION_2` && m.candidate === name.toLowerCase(),
        ),
      )
    }
    assert(s.messages.some((m) => m.content === 'UNATTRIBUTED_LEGACY_MESSAGE'))
  } finally {
    fetchMock.mock.restore()
  }
})
