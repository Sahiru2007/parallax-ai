import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chromium } from '@playwright/test'
import { newScenario, validateScenario, replayOrder } from '../shared/project-replay.ts'
import { driveProjectReplay } from './project-replay-driver.ts'
import { CodingEngine } from './coding-engine.ts'
import { sourceSnapshot } from './coding-files.ts'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { git } from './process.ts'
import { saveScenario } from './project-replay-engine.ts'
import type { CodingSession } from '../shared/coding.ts'

test('scenario revisions retain immutable fixtures and assertions for older recordings', () => {
  assert.throws(() => validateScenario(undefined), /scenario JSON object/)
  const state = { busy: false } as CodingSession,
    original = structuredClone(newScenario)
  const first = saveScenario(state, original)
  original.expected.texts.push('Must not mutate saved evidence')
  assert.deepEqual(first.scenario.expected.texts, newScenario.expected.texts)
  const changed = structuredClone(newScenario)
  changed.expected.texts = ['Changed assertion']
  const second = saveScenario(state, changed)
  assert.notEqual(first.digest, second.digest)
  assert.equal(second.revision, 2)
  assert.deepEqual(
    state.projectReplay!.history![0].scenario.expected.texts,
    newScenario.expected.texts,
  )
})

test('scenario validation rejects ambiguous matches, remote URLs, and incomplete schedules', () => {
  const spec = structuredClone(newScenario)
  spec.requests[1].url = spec.requests[0].url
  assert.throws(() => validateScenario(spec), /Ambiguous match/)
  spec.requests[0].method = 'POST'
  spec.requests[1].method = 'POST'
  spec.requests[0].postData = '{"period":"previous"}'
  spec.requests[1].postData = '{"period":"current"}'
  assert.equal(validateScenario(spec).requests.length, 2)
  spec.requests[0].postData = null
  assert.throws(() => validateScenario(spec), /Ambiguous/)
  const remote = structuredClone(newScenario)
  remote.app.origin = 'https://example.com'
  assert.throws(() => validateScenario(remote), /local HTTP/)
  assert.throws(
    () => replayOrder(['previous', 'previous'], ['previous', 'current']),
    /exactly once/,
  )
})

test('scenario proposals cannot edit candidate files before user review', async () => {
  const dir = resolve('artifacts/proposal-readonly', randomUUID()),
    repo = join(dir, 'repo')
  await mkdir(dir, { recursive: true })
  await git(process.cwd(), ['clone', '--shared', '--', process.cwd(), repo])
  const recipe = join(dir, 'provider.json')
  await writeFile(
    recipe,
    JSON.stringify({
      turns: [
        { calls: [], message: 'unused' },
        {
          calls: [
            {
              name: 'write_file',
              args: { path: 'README.md', content: 'This must not replace the candidate file.' },
            },
          ],
          message: 'blocked',
        },
      ],
    }),
  )
  const enabled = process.env.PARALLAX_ENABLE_TEST_PROVIDER,
    file = process.env.PARALLAX_TEST_PROVIDER_FILE
  process.env.PARALLAX_ENABLE_TEST_PROVIDER = '1'
  process.env.PARALLAX_TEST_PROVIDER_FILE = recipe
  const engine = new CodingEngine(join(dir, 'sessions'))
  try {
    const session = await engine.start(
      repo,
      'Propose a scenario without writes',
      'test',
      false,
      true,
    )
    await engine.wait(session.id)
    const before = await sourceSnapshot(session.candidates[0].worktree)
    await engine.proposeReplay(session.id)
    await engine.wait(session.id)
    assert.equal(session.status, 'error')
    assert.match(session.error!, /read-only/)
    assert.equal((await sourceSnapshot(session.candidates[0].worktree)).digest, before.digest)
  } finally {
    await engine.close()
    if (enabled === undefined) delete process.env.PARALLAX_ENABLE_TEST_PROVIDER
    else process.env.PARALLAX_ENABLE_TEST_PROVIDER = enabled
    if (file === undefined) delete process.env.PARALLAX_TEST_PROVIDER_FILE
    else process.env.PARALLAX_TEST_PROVIDER_FILE = file
  }
})

test('real XHR POST gates distinguish exact bodies and flip the buggy result with only response order', async () => {
  const html = `<button id="previous">Previous</button><button id="current">Current</button><div id="result"></div><script>function send(which){const xhr=new XMLHttpRequest();xhr.open('POST','/metrics');xhr.setRequestHeader('Content-Type','application/json');xhr.withCredentials=true;xhr.onload=()=>{document.querySelector('#result').textContent=JSON.parse(xhr.responseText).text};xhr.send(JSON.stringify({period:which}))}document.querySelector('#previous').onclick=()=>{send('previous');if(location.pathname==='/duplicate')send('previous')};document.querySelector('#current').onclick=()=>send('current');</script>`
  let backendRequests = 0
  const backend = createServer((_request, response) => {
    backendRequests++
    response.end('The browser fixture must intercept this request.')
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const backendAddress = backend.address()
  if (!backendAddress || typeof backendAddress === 'string') throw new Error('No backend port')
  const api = `http://127.0.0.1:${backendAddress.port}/metrics`
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(_request.url === '/cross' ? html.replace("'/metrics'", JSON.stringify(api)) : html)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const origin = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ headless: true })
  const spec = validateScenario({
    ...newScenario,
    app: { ...newScenario.app, origin, page: '/' },
    actions: [
      {
        id: 'previous',
        label: 'Previous',
        kind: 'click',
        selector: '#previous',
        waitForRequest: 'previous',
      },
      {
        id: 'current',
        label: 'Current',
        kind: 'click',
        selector: '#current',
        waitForRequest: 'current',
      },
    ],
    requests: [
      {
        id: 'previous',
        label: 'Previous POST',
        method: 'POST',
        url: '/metrics',
        postData: '{"period":"previous"}',
        status: 200,
        json: { text: 'Previous value' },
      },
      {
        id: 'current',
        label: 'Current POST',
        method: 'POST',
        url: '/metrics',
        postData: '{"period":"current"}',
        status: 200,
        json: { text: 'Current value' },
      },
    ],
    expected: {
      description: 'Keep the current value.',
      selector: '#result',
      texts: ['Current value'],
      afterRequest: 'current',
    },
    timeoutMs: 1500,
    settleMs: 20,
  })
  try {
    for (const [order, passed] of [
      [['previous', 'current'], true],
      [['current', 'previous'], false],
    ] as const) {
      const page = await browser.newPage({ serviceWorkers: 'block' })
      const result = await driveProjectReplay(page, spec, [...order], origin)
      assert.equal(result.executionError, undefined)
      assert.equal(result.passed, passed)
      assert.equal(result.coverage.different, false)
      assert.deepEqual(result.coverage.seen, ['previous', 'current'])
      if (!passed) assert.equal(result.firstUnexpected, 'ui:previous')
      await page.close()
    }
    const page = await browser.newPage({ serviceWorkers: 'block' })
    const duplicate = await driveProjectReplay(
      page,
      { ...spec, app: { ...spec.app, page: '/duplicate' } },
      ['current', 'previous'],
      origin,
    )
    assert.match(duplicate.executionError!, /Ambiguous repeated match/)
    assert.equal(duplicate.coverage.different, true)
    assert.equal(duplicate.firstUnexpected, undefined)
    await page.close()
    const cross = await browser.newPage({ serviceWorkers: 'block' })
    const crossed = await driveProjectReplay(
      cross,
      {
        ...spec,
        app: { ...spec.app, page: '/cross' },
        requests: spec.requests.map((request) => ({ ...request, url: api })),
      },
      ['previous', 'current'],
      origin,
    )
    assert.equal(crossed.executionError, undefined)
    assert.equal(crossed.passed, true)
    assert.equal(backendRequests, 0)
    await cross.close()
  } finally {
    await browser.close()
    await new Promise<void>((r) => server.close(() => r()))
    await new Promise<void>((r) => backend.close(() => r()))
  }
})
