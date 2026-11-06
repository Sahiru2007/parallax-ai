export interface ReplayScenario {
  name: string
  app: {
    executable: string
    args: string[]
    cwd: string
    origin: string
    page: string
    readyPath: string
    prepare?: { executable: string; args: string[] }
  }
  actions: {
    id: string
    label: string
    kind: 'click' | 'fill' | 'select'
    selector: string
    value?: string
    waitForRequest?: string
  }[]
  requests: {
    id: string
    label: string
    method: string
    url: string
    postData: string | null
    status: number
    json: unknown
  }[]
  order: string[]
  expected: { description: string; selector: string; texts: string[]; afterRequest: string | null }
  settleMs: number
  timeoutMs: number
}
export interface ReplayEvent {
  key: string
  track: 'action' | 'response' | 'ui'
  label: string
  atMs: number
  requestId?: string
  texts?: string[]
  checked?: boolean
  unexpected?: boolean
  screenshot?: string
  delivery?: 'delivered' | 'cancelled'
  detail?: string
}
export interface RequestCoverage {
  seen: string[]
  cancelled: string[]
  missing: string[]
  unexpected: string[]
  different: boolean
}
export interface ProjectReplayRun {
  id: string
  version: string
  attemptId: string
  startedAt: string
  scenarioRevision: number
  scenarioDigest: string
  sourceDigest: string
  baselineRevision: string
  order: string[]
  orderRevision: number
  status: 'running' | 'passed' | 'failed' | 'error' | 'cancelled'
  events: ReplayEvent[]
  coverage: RequestCoverage
  firstUnexpected?: string
  finalTexts: string[]
  durationMs: number
  output: string
  error?: string
}
export interface ProjectReplayState {
  saved?: { revision: number; digest: string; scenario: ReplayScenario }
  proposal?: ReplayScenario
  history?: { revision: number; digest: string; scenario: ReplayScenario }[]
  order: string[]
  orderRevision: number
  runs: ProjectReplayRun[]
  baselineWorktree?: string
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Scenario fields must be objects.')
  return value as Record<string, unknown>
}
const text = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    throw new Error(`Provide ${field} (1–2000 characters).`)
  return value
}
export function localUrl(value: string, base?: string) {
  const url = new URL(value.replaceAll('{PORT}', '4319'), base?.replaceAll('{PORT}', '4319'))
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error(
      'Replay URLs must use local HTTP (127.0.0.1, localhost, or [::1]), without credentials or fragments.',
    )
  return url
}
export function canonicalRequestUrl(value: string, origin: string) {
  const url = localUrl(value, origin)
  url.searchParams.sort()
  return url.href
}
export function replayOrder(value: unknown, ids: string[]) {
  if (
    !Array.isArray(value) ||
    value.length !== ids.length ||
    new Set(value).size !== ids.length ||
    !value.every((id) => typeof id === 'string' && ids.includes(id))
  )
    throw new Error(
      `Schedule cannot execute: include each controlled request exactly once (${ids.join(', ')}).`,
    )
  return value as string[]
}
export function validateScenario(input: unknown): ReplayScenario {
  const encoded = JSON.stringify(input)
  if (!encoded) throw new Error('Provide a scenario JSON object.')
  if (encoded.length > 50_000) throw new Error('Keep the scenario and fixtures under 50 KB.')
  const data = record(input),
    app = record(data.app),
    expected = record(data.expected)
  const executable = text(app.executable, 'app executable')
  if (!['node', 'npm', 'npx', 'python', 'python3', 'dotnet', 'go', 'cargo'].includes(executable))
    throw new Error('Use a supported executable and argv, not a shell command.')
  if (!Array.isArray(app.args) || !app.args.every((arg) => typeof arg === 'string'))
    throw new Error('App arguments must be an array of strings.')
  const origin = text(app.origin, 'app origin'),
    originUrl = localUrl(origin)
  if (originUrl.pathname !== '/' || originUrl.search)
    throw new Error('App origin must contain only scheme, local host, and port.')
  const page = text(app.page, 'page URL/path'),
    readyPath = text(app.readyPath, 'readiness path')
  let prepare: ReplayScenario['app']['prepare']
  if (app.prepare !== undefined) {
    const setup = record(app.prepare)
    if (
      !['node', 'npm', 'npx', 'python', 'python3', 'dotnet', 'go', 'cargo'].includes(
        String(setup.executable),
      ) ||
      !Array.isArray(setup.args) ||
      !setup.args.every((arg) => typeof arg === 'string')
    )
      throw new Error('App prepare requires a supported executable and string argv.')
    prepare = { executable: String(setup.executable), args: setup.args as string[] }
  }
  if (
    localUrl(page, origin).origin !== originUrl.origin ||
    localUrl(readyPath, origin).origin !== originUrl.origin
  )
    throw new Error('Page and readiness URL must belong to the app origin.')
  if (!Array.isArray(data.requests) || data.requests.length < 1 || data.requests.length > 6)
    throw new Error('Configure 1–6 controlled HTTP requests.')
  const requests = data.requests.map((value) => {
    const r = record(value),
      id = text(r.id, 'request ID')
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id))
      throw new Error('Request IDs must be short unique identifiers.')
    const method = text(r.method, 'request method').toUpperCase(),
      url = text(r.url, 'request URL')
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
      throw new Error('Use GET, POST, PUT, PATCH, or DELETE.')
    canonicalRequestUrl(url, origin)
    if (r.postData !== null && typeof r.postData !== 'string')
      throw new Error('postData must be an exact string or null (any body).')
    if (
      typeof r.status !== 'number' ||
      !Number.isInteger(r.status) ||
      r.status < 200 ||
      r.status > 599 ||
      [204, 205, 304].includes(r.status)
    )
      throw new Error('Choose an HTTP status that can carry a JSON fixture.')
    if (r.json === undefined) throw new Error(`Request ${id} needs a JSON response fixture.`)
    return {
      id,
      label: text(r.label, 'request label'),
      method,
      url,
      postData: r.postData as string | null,
      status: r.status,
      json: r.json,
    }
  })
  const ids = requests.map((r) => r.id)
  if (new Set(ids).size !== ids.length) throw new Error('Request IDs must be unique.')
  for (let i = 0; i < requests.length; i++)
    for (let j = i + 1; j < requests.length; j++) {
      const a = requests[i],
        b = requests[j]
      if (
        a.method === b.method &&
        canonicalRequestUrl(a.url, origin) === canonicalRequestUrl(b.url, origin) &&
        (a.postData === null || b.postData === null || a.postData === b.postData)
      )
        throw new Error(
          `Ambiguous match: ${a.id} and ${b.id}. Use distinct URLs or exact postData bodies.`,
        )
    }
  if (!Array.isArray(data.actions) || !data.actions.length || data.actions.length > 20)
    throw new Error('Configure 1–20 browser actions.')
  const actions = data.actions.map((value) => {
    const action = record(value)
    if (!['click', 'fill', 'select'].includes(String(action.kind)))
      throw new Error('Actions support click, fill, and select.')
    if (action.kind !== 'click' && typeof action.value !== 'string')
      throw new Error('Fill/select actions require a string value.')
    if (action.waitForRequest !== undefined && !ids.includes(String(action.waitForRequest)))
      throw new Error('An action references an unknown request gate.')
    return {
      id: text(action.id, 'action ID'),
      label: text(action.label, 'action label'),
      kind: action.kind as 'click' | 'fill' | 'select',
      selector: text(action.selector, 'action selector'),
      ...(typeof action.value === 'string' ? { value: action.value } : {}),
      ...(typeof action.waitForRequest === 'string'
        ? { waitForRequest: action.waitForRequest }
        : {}),
    }
  })
  if (new Set(actions.map((a) => a.id)).size !== actions.length)
    throw new Error('Action IDs must be unique.')
  if (!Array.isArray(expected.texts) || !expected.texts.every((t) => typeof t === 'string'))
    throw new Error('Expected texts must be an array of strings, one per matching element.')
  if (expected.afterRequest !== null && !ids.includes(String(expected.afterRequest)))
    throw new Error(
      'Expected afterRequest must name a controlled request or be null (final checkpoint only).',
    )
  const settleMs = Number(data.settleMs),
    timeoutMs = Number(data.timeoutMs)
  if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 2000)
    throw new Error('settleMs must be 0–2000 milliseconds.')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15_000)
    throw new Error('timeoutMs must be 500–15000 milliseconds.')
  return {
    name: text(data.name, 'scenario name'),
    app: {
      executable,
      args: app.args as string[],
      cwd: text(app.cwd, 'working directory'),
      origin,
      page,
      readyPath,
      ...(prepare ? { prepare } : {}),
    },
    requests,
    actions,
    order: replayOrder(data.order, ids),
    expected: {
      description: text(expected.description, 'expected behavior'),
      selector: text(expected.selector, 'observed UI selector'),
      texts: expected.texts as string[],
      afterRequest: expected.afterRequest as string | null,
    },
    settleMs,
    timeoutMs,
  }
}
export const newScenario: ReplayScenario = {
  name: 'Filter response race',
  app: {
    executable: 'npm',
    args: ['run', 'dev', '--', '--port', '{PORT}'],
    cwd: '.',
    origin: 'http://127.0.0.1:{PORT}',
    page: '/',
    readyPath: '/',
  },
  actions: [
    {
      id: 'previous-filter',
      label: 'Choose previous filter',
      kind: 'click',
      selector: '[data-filter="previous"]',
      waitForRequest: 'previous',
    },
    {
      id: 'current-filter',
      label: 'Choose current filter',
      kind: 'click',
      selector: '[data-filter="current"]',
      waitForRequest: 'current',
    },
  ],
  requests: [
    {
      id: 'previous',
      label: 'Previous filter',
      method: 'GET',
      url: '/api/report?filter=previous',
      postData: null,
      status: 200,
      json: { items: ['Previous result'] },
    },
    {
      id: 'current',
      label: 'Current filter',
      method: 'GET',
      url: '/api/report?filter=current',
      postData: null,
      status: 200,
      json: { items: ['Current result'] },
    },
  ],
  order: ['current', 'previous'],
  expected: {
    description: 'The active filter keeps its results after both responses finish.',
    selector: '[data-result]',
    texts: ['Current result'],
    afterRequest: 'current',
  },
  settleMs: 100,
  timeoutMs: 5000,
}
