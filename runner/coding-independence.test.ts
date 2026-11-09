import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { CodingEngine } from './coding-engine.ts'
import { ProviderSettingsStore } from './provider-settings.ts'
import { git } from './process.ts'

test('sequential comparison keeps A edits and responses out of B provider context', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'parallax-independent-')),
    repo = join(dir, 'source')
  await mkdir(repo)
  await writeFile(join(repo, 'value.cjs'), 'module.exports=0;\n')
  await git(repo, ['init', '--initial-branch=main'])
  await git(repo, ['add', '.'])
  await git(repo, [
    '-c',
    'user.name=Parallax Isolation Test',
    '-c',
    'user.email=isolation@parallax.invalid',
    'commit',
    '-m',
    'Ordinary source baseline',
  ])
  const credential = {
    available: true,
    get: async () => 'inert-independence-test-key',
    set: async () => {},
    remove: async () => {},
  }
  const providers = new ProviderSettingsStore(join(dir, 'providers.json'), credential, credential)
  await providers.restore()
  providers.state.testTransport = true
  providers.state.gemini.models = ['models/independence-double']
  providers.state.gemini.checks['models/independence-double'] = {
    ok: true,
    at: new Date().toISOString(),
    message: 'Controlled protocol double; no live inference',
  }
  const selection = providers.selectionFrom('gemini', 'models/independence-double')
  providers.state.selection = selection
  const requests: string[] = []
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = String(init.body)
    requests.push(body)
    const count = requests.length
    const parts =
      count === 1 || count === 3
        ? [
            {
              thoughtSignature: 'opaque-isolation-signature',
              functionCall: {
                id: `write-${count}`,
                name: 'write_file',
                args: {
                  path: 'value.cjs',
                  content: `module.exports='PRIVATE_${count === 1 ? 'A' : 'B'}_PATCH_SENTINEL';\n`,
                },
              },
            },
          ]
        : [{ text: count === 2 ? 'PRIVATE_A_MESSAGE_SENTINEL' : 'B completed independently.' }]
    return new Response(
      `data: ${JSON.stringify({
        modelVersion: 'independence-protocol-double',
        candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
      })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  })
  try {
    const engine = new CodingEngine(join(dir, 'sessions'), providers)
    await engine.restore()
    const state = await engine.start(
      repo,
      'Improve the value implementation.',
      'live',
      true,
      false,
      selection,
      true,
    )
    async function idle() {
      const deadline = Date.now() + 30000
      while (state.busy && Date.now() < deadline) await delay(25)
      assert.equal(state.busy, false, 'Candidate did not finish in time')
      assert.equal(state.status, 'ready', state.error)
    }
    await idle()
    assert.equal(requests.length, 2)
    assert.match(state.candidates[0].patch, /PRIVATE_A_PATCH_SENTINEL/)
    assert.equal(state.candidates[1].patch, '')
    await engine.generateNext(state.id, 'b')
    await idle()
    assert.equal(requests.length, 4)
    assert.doesNotMatch(requests[2], /PRIVATE_A_PATCH_SENTINEL|PRIVATE_A_MESSAGE_SENTINEL/)
    assert.match(requests[2], /materially distinct approach for Approach B/)
    assert.match(state.candidates[1].patch, /PRIVATE_B_PATCH_SENTINEL/)
    assert.doesNotMatch(state.candidates[1].patch, /PRIVATE_A_PATCH_SENTINEL/)
    assert.equal(state.providerRuns?.length, 2)
    // Older versions could acknowledge a changed digest while silently losing its export.
    const retainedPatch = state.candidates[0].patch
    state.candidates[0].patch = ''
    await engine.review(state.id)
    assert.equal(state.candidates[0].patch, retainedPatch)
    assert.equal(requests.length, 4, 'Repairing retained export must not invoke a model')
  } finally {
    fetchMock.mock.restore()
  }
})
