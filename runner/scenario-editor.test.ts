import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newScenario, validateScenario } from '../shared/project-replay.ts'
import {
  analyzeDocument,
  draftFromInput,
  draftInput,
  draftIssues,
  emptyDraft,
  formatCommand,
  parseCommand,
  stableScenario,
  type ScenarioDocument,
} from '../shared/scenario-editor.ts'
import { replaySuggestions } from './replay-suggestions.ts'

test('command editing round-trips literal argv including spaces, quotes, Windows paths and empty values', () => {
  const args = [
    'run',
    'a b',
    '',
    String.raw`C:\some folder\file.js`,
    'a"b',
    "a'b",
    'a&&b',
    '\n',
    '{PORT}',
    'hello ☀',
    '--label=has space',
  ]
  assert.deepEqual(parseCommand(formatCommand('node', args)), { executable: 'node', args })
  assert.deepEqual(parseCommand("node 'C:\\some folder\\app.js' --port {PORT}"), {
    executable: 'node',
    args: [String.raw`C:\some folder\app.js`, '--port', '{PORT}'],
  })
  for (const cmd of [
    'node a.js && npm test',
    'node a.js | tee log',
    'powershell.exe file',
    'node "unfinished',
  ])
    assert.throws(() => parseCommand(cmd))
})

test('guided and advanced documents round-trip every supported field without normalizing away optional values', () => {
  const scenario = structuredClone(newScenario)
  scenario.app = {
    executable: 'node',
    args: ['server with spaces.cjs', '{PORT}', ''],
    cwd: 'nested app',
    origin: 'http://localhost:{PORT}',
    page: '/dashboard?tab=1',
    readyPath: '/health?ready=1',
    prepare: { executable: 'node', args: ['-e', 'console.log("a b")', ''] },
  }
  scenario.actions = [
    {
      id: 'click',
      label: 'Click period',
      kind: 'click',
      selector: '#period',
      value: 'retained click value',
    },
    { id: 'clear', label: 'Clear field', kind: 'fill', selector: '#search', value: '' },
    {
      id: 'select',
      label: 'Select Month in Period',
      kind: 'select',
      selector: '#period',
      value: 'month',
      waitForRequest: 'post-b',
    },
  ]
  scenario.requests = [
    {
      id: 'post-a',
      label: 'Previous report',
      method: 'POST',
      url: '/api/report',
      postData: '',
      status: 201,
      json: null,
    },
    {
      id: 'post-b',
      label: 'Active report',
      method: 'POST',
      url: '/api/report',
      postData: '{"period":"month"}',
      status: 299,
      json: { rows: [' leading ', 'multi\nline', ''] },
    },
    {
      id: 'get',
      label: 'Flags',
      method: 'GET',
      url: '/flags',
      postData: null,
      status: 599,
      json: false,
    },
  ]
  scenario.order = ['post-b', 'post-a', 'get']
  scenario.expected = {
    description: 'Exact visible metrics',
    selector: '.metric',
    texts: [' leading ', 'multi\nline', ''],
    afterRequest: null,
  }
  scenario.settleMs = 0
  scenario.timeoutMs = 15000
  const form = draftFromInput(scenario)
  assert.deepEqual(draftIssues(form), {})
  assert.deepEqual(draftInput(form), scenario)
  const doc: ScenarioDocument = {
    form,
    json: JSON.stringify(scenario),
    mode: 'json',
    baseDigest: 'unchanged',
  }
  assert.deepEqual(analyzeDocument(doc).input, validateScenario(scenario))
  doc.mode = 'guided'
  assert.deepEqual(analyzeDocument(doc).input, scenario)
  assert.equal(
    stableScenario({ ...scenario, name: 'changed' }),
    stableScenario({ ...scenario, name: 'changed' }),
  )
})

test('invalid fixture text and malformed advanced JSON retain the entered draft for repair', () => {
  const form = draftFromInput(newScenario)
  form.requests[0].fixture = '{"rows":broken'
  const doc: ScenarioDocument = { form, json: 'last JSON', mode: 'guided', baseDigest: null }
  assert.match(analyzeDocument(doc).errors['requests.0.fixture'], /valid JSON/)
  assert.equal(doc.form.requests[0].fixture, '{"rows":broken')
  assert.equal(analyzeDocument(doc).input, undefined)
  doc.mode = 'json'
  doc.json = '{"name":'
  assert(analyzeDocument(doc).errors.json)
  assert.equal(doc.json, '{"name":')
  assert.equal(doc.form.requests[0].fixture, '{"rows":broken')
})

test('preflight points to ambiguous matches, missing gates, unsupported app setup and timing fields', () => {
  const d = draftFromInput(newScenario)
  d.app.cwd = '../original'
  d.app.origin = 'https://example.com'
  d.app.command = 'npm run dev && npm test'
  d.app.page = 'http://localhost:9999/remote'
  d.timeoutMs = ''
  d.requests[0].status = '204'
  d.actions[0].waitForRequest = 'removed'
  const errors = draftIssues(d)
  for (const field of [
    'app.cwd',
    'app.origin',
    'app.command',
    'app.page',
    'timeoutMs',
    'requests.0.status',
    'actions.0.waitForRequest',
  ])
    assert(errors[field], field)
  const ambiguous = draftFromInput(newScenario)
  ambiguous.requests[0].url = '/same?b=2&a=1'
  ambiguous.requests[1].url = '/same?a=1&b=2'
  assert.match(draftIssues(ambiguous)['requests.1.url'], /Ambiguous/)
  ambiguous.requests.forEach((r, i) => {
    r.method = 'POST'
    r.postData = i ? ' {"x":1}' : '{"x":1}'
  })
  assert.deepEqual(draftIssues(ambiguous), {}) // Exact text, not semantic JSON matching.
  ambiguous.requests[0].postData = null
  assert.match(draftIssues(ambiguous)['requests.1.url'], /Ambiguous/)
})

test('unsupported fields and types are explicit errors instead of being silently discarded', () => {
  const extra = {
    ...structuredClone(newScenario),
    expected: { ...newScenario.expected, regex: '.*' },
  }
  assert.throws(() => draftFromInput(extra), /Unsupported field expected.regex/)
  assert.throws(
    () =>
      draftFromInput({
        ...newScenario,
        requests: [{ ...newScenario.requests[0], postData: { period: 'week' } }],
      }),
    /exact text or null/,
  )
  const blank = emptyDraft()
  assert.deepEqual(draftInput(blank).actions, [])
  assert.equal(draftIssues(blank).actions, 'Add 1 to 20 user actions.')
  blank.app.command = 'node app.cjs'
  blank.timeoutMs = ''
  assert.throws(() => draftInput(blank), /number/)
  assert.equal(blank.timeoutMs, '')
})

test('empty fill/select values, empty assertions, primitive JSON fixtures and click options survive editing', () => {
  const value = structuredClone(newScenario)
  value.actions[0] = { ...value.actions[0], kind: 'fill', value: '' }
  value.actions[1] = { ...value.actions[1], kind: 'select', value: '' }
  value.expected.texts = []
  value.requests[0].json = 0
  value.requests[1].json = 'string fixture'
  const d = draftFromInput(value)
  assert.deepEqual(draftIssues(d), {})
  assert.deepEqual(draftInput(d), value)
})

test('setup detection inspects baseline files without executing scripts or changing them', () => {
  const files = new Map([
    [
      'web/package.json',
      Buffer.from(
        JSON.stringify({ scripts: { dev: 'vite --host', start: 'echo danger && node server.js' } }),
      ),
    ],
    [
      'dashboard.cjs',
      Buffer.from('const port=Number(process.argv[2]);http.createServer(handler).listen(port)'),
    ],
    ['broken/package.json', Buffer.from('{broken')],
  ])
  const before = [...files].map(([k, v]) => [k, v.toString()])
  const suggestions = replaySuggestions(files)
  assert(suggestions.some((s) => s.app.cwd === 'web' && s.app.args.includes('{PORT}')))
  assert(suggestions.some((s) => s.app.executable === 'node' && s.app.args[0] === 'dashboard.cjs'))
  assert(
    suggestions.some(
      (s) => s.label === 'npm run start in web' && s.app.args.join(' ') === 'run start',
    ),
  )
  assert.deepEqual(
    [...files].map(([k, v]) => [k, v.toString()]),
    before,
  )
})
