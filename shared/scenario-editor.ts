import {
  canonicalRequestUrl,
  localUrl,
  validateScenario,
  type ReplayScenario,
} from './project-replay.ts'

export interface ScenarioDraft {
  name: string
  app: {
    command: string
    cwd: string
    origin: string
    page: string
    readyPath: string
    prepare?: string
  }
  actions: {
    key: string
    id: string
    label: string
    kind: string
    selector: string
    value?: string
    waitForRequest?: string
  }[]
  requests: {
    key: string
    id: string
    label: string
    method: string
    url: string
    postData: string | null
    status: string
    fixture: string
  }[]
  order: string[]
  expected: { description: string; selector: string; texts: string[]; afterRequest: string | null }
  settleMs: string
  timeoutMs: string
}
export interface ScenarioDocument {
  form: ScenarioDraft
  json: string
  mode: 'guided' | 'json'
  baseDigest: string | null
}
export interface AppSuggestion {
  label: string
  reason: string
  app: Partial<ReplayScenario['app']> & { executable: string; args: string[] }
}
export const executables = ['node', 'npm', 'npx', 'python', 'python3', 'dotnet', 'go', 'cargo']
export function formatCommand(executable: string, args: string[]) {
  if (!executable && !args.length) return ''
  return [executable, ...args]
    .map((s) => (/^[\w./:{}=-]+$/.test(s) ? s : JSON.stringify(s)))
    .join(' ')
}
// This is argv parsing, never shell evaluation. JSON double quotes preserve every supported argument.
export function parseCommand(value: string) {
  const tokens: string[] = []
  let i = 0
  while (i < value.length) {
    if (/\s/.test(value[i])) {
      i++
      continue
    }
    let token = '',
      started = false
    while (i < value.length && !/\s/.test(value[i])) {
      if (value[i] === '"') {
        const start = i++
        let closed = false
        while (i < value.length) {
          if (value[i] === '\\') {
            i += 2
            continue
          }
          if (value[i++] === '"') {
            closed = true
            break
          }
        }
        if (!closed) throw new Error('Close the double quote in this command.')
        try {
          token += JSON.parse(value.slice(start, i))
        } catch {
          throw new Error(
            'Invalid quoted argument. Use double backslashes inside double quotes, or single quotes for Windows paths.',
          )
        }
      } else if (value[i] === "'") {
        const start = ++i,
          end = value.indexOf("'", start)
        if (end < 0) throw new Error('Close the single quote in this command.')
        token += value.slice(start, end)
        i = end + 1
      } else {
        if (/[|;&<>]/.test(value[i]))
          throw new Error(
            'Use an executable and arguments. Shell operators, pipes, and redirection are not supported; quote a literal argument containing these characters.',
          )
        token += value[i++]
      }
      started = true
    }
    if (started) tokens.push(token)
  }
  if (!executables.includes(tokens[0]))
    throw new Error('Start with node, npm, npx, python, python3, dotnet, go, or cargo.')
  return { executable: tokens[0], args: tokens.slice(1) }
}
export function emptyDraft(): ScenarioDraft {
  return {
    name: '',
    app: { command: '', cwd: '.', origin: 'http://127.0.0.1:{PORT}', page: '/', readyPath: '/' },
    actions: [],
    requests: [],
    order: [],
    expected: { description: '', selector: '', texts: [], afterRequest: null },
    settleMs: '100',
    timeoutMs: '5000',
  }
}
function object(value: unknown, path: string, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must be an object.`)
  const record = value as Record<string, unknown>
  const extra = Object.keys(record).filter((k) => !keys.includes(k))
  if (extra.length)
    throw new Error(
      `Unsupported field ${path}.${extra[0]}. The replay engine does not use this field; remove it explicitly before switching or saving.`,
    )
  return record
}
function string(value: unknown, path: string) {
  if (typeof value !== 'string') throw new Error(`${path} must be text.`)
  return value
}
function strings(value: unknown, path: string) {
  if (!Array.isArray(value) || !value.every((s) => typeof s === 'string'))
    throw new Error(`${path} must be a list of strings.`)
  return value as string[]
}
function numeric(value: unknown, path: string) {
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new Error(`${path} must be a number.`)
  return String(value)
}
export function draftFromInput(input: unknown): ScenarioDraft {
  const s = object(input, 'scenario', [
    'name',
    'app',
    'actions',
    'requests',
    'order',
    'expected',
    'settleMs',
    'timeoutMs',
  ])
  const app = object(s.app, 'app', [
    'executable',
    'args',
    'cwd',
    'origin',
    'page',
    'readyPath',
    'prepare',
  ])
  const expected = object(s.expected, 'expected', [
    'description',
    'selector',
    'texts',
    'afterRequest',
  ])
  let prepare: string | undefined
  if (app.prepare !== undefined) {
    const p = object(app.prepare, 'app.prepare', ['executable', 'args'])
    prepare = formatCommand(
      string(p.executable, 'prepare executable'),
      strings(p.args, 'prepare arguments'),
    )
  }
  if (!Array.isArray(s.actions) || !Array.isArray(s.requests))
    throw new Error('actions and requests must be lists.')
  if (expected.afterRequest !== null && typeof expected.afterRequest !== 'string')
    throw new Error('expected.afterRequest must be a request ID or null.')
  return {
    name: string(s.name, 'name'),
    app: {
      command: formatCommand(
        string(app.executable, 'app executable'),
        strings(app.args, 'app arguments'),
      ),
      cwd: string(app.cwd, 'cwd'),
      origin: string(app.origin, 'origin'),
      page: string(app.page, 'page'),
      readyPath: string(app.readyPath, 'readyPath'),
      ...(prepare !== undefined ? { prepare } : {}),
    },
    actions: s.actions.map((v, i) => {
      const a = object(v, `actions.${i}`, [
        'id',
        'label',
        'kind',
        'selector',
        'value',
        'waitForRequest',
      ])
      return {
        key: `action-${i}`,
        id: string(a.id, 'action ID'),
        label: string(a.label, 'action name'),
        kind: string(a.kind, 'action type'),
        selector: string(a.selector, 'action selector'),
        ...(a.value !== undefined ? { value: string(a.value, 'action value') } : {}),
        ...(a.waitForRequest !== undefined
          ? { waitForRequest: string(a.waitForRequest, 'request gate') }
          : {}),
      }
    }),
    requests: s.requests.map((v, i) => {
      const r = object(v, `requests.${i}`, [
        'id',
        'label',
        'method',
        'url',
        'postData',
        'status',
        'json',
      ])
      if (r.postData !== null && typeof r.postData !== 'string')
        throw new Error('Request postData must be exact text or null.')
      if (r.json === undefined) throw new Error('Each request needs a json fixture.')
      return {
        key: `request-${i}`,
        id: string(r.id, 'request ID'),
        label: string(r.label, 'request name'),
        method: string(r.method, 'method'),
        url: string(r.url, 'request URL'),
        postData: r.postData as string | null,
        status: numeric(r.status, 'HTTP status'),
        fixture: JSON.stringify(r.json, null, 2),
      }
    }),
    order: strings(s.order, 'order'),
    expected: {
      description: string(expected.description, 'expected description'),
      selector: string(expected.selector, 'expected selector'),
      texts: strings(expected.texts, 'expected texts'),
      afterRequest: expected.afterRequest as string | null,
    },
    settleMs: numeric(s.settleMs, 'settleMs'),
    timeoutMs: numeric(s.timeoutMs, 'timeoutMs'),
  }
}
export function draftInput(d: ScenarioDraft): ReplayScenario {
  const number = (s: string) => {
    if (!s.trim() || !Number.isFinite(Number(s)))
      throw new Error('Enter a number in the timing and HTTP status fields.')
    return Number(s)
  }
  return {
    name: d.name,
    app: {
      ...(d.app.command.trim() ? parseCommand(d.app.command) : { executable: '', args: [] }),
      cwd: d.app.cwd,
      origin: d.app.origin,
      page: d.app.page,
      readyPath: d.app.readyPath,
      ...(d.app.prepare !== undefined
        ? {
            prepare: d.app.prepare.trim()
              ? parseCommand(d.app.prepare)
              : { executable: '', args: [] },
          }
        : {}),
    },
    actions: d.actions.map(({ key: _key, ...a }) => a as ReplayScenario['actions'][number]),
    requests: d.requests.map(({ key: _key, fixture, status, ...r }) => ({
      ...r,
      status: number(status),
      json: JSON.parse(fixture),
    })),
    order: [...d.order],
    expected: { ...d.expected, texts: [...d.expected.texts] },
    settleMs: number(d.settleMs),
    timeoutMs: number(d.timeoutMs),
  }
}
export function draftIssues(d: ScenarioDraft) {
  const errors: Record<string, string> = {}
  const required = (v: string, path: string, label: string) => {
    if (!v.trim() || v.length > 2000) errors[path] = `Enter ${label} (up to 2000 characters).`
  }
  required(d.name, 'name', 'a scenario name')
  for (const field of ['cwd', 'origin', 'page', 'readyPath'] as const)
    required(d.app[field], `app.${field}`, field === 'cwd' ? 'a working directory' : field)
  try {
    parseCommand(d.app.command)
  } catch (e) {
    errors['app.command'] = (e as Error).message
  }
  if (d.app.prepare !== undefined)
    try {
      parseCommand(d.app.prepare)
    } catch (e) {
      errors['app.prepare'] = (e as Error).message
    }
  let depth = 0,
    escapes = false
  for (const part of d.app.cwd.split(/[\\/]/)) {
    if (part === '..') {
      if (!depth) escapes = true
      else depth--
    } else if (part && part !== '.') depth++
  }
  if (
    /^(?:[A-Za-z]:|[\\/])/.test(d.app.cwd) ||
    /[\r\n\0:]/.test(d.app.cwd) ||
    escapes ||
    /(^|[\\/])(?:\.git|node_modules|\.env[^\\/]*|artifacts)([\\/]|$)/i.test(d.app.cwd)
  )
    errors['app.cwd'] =
      'Use a directory within the worktree source, such as . or web. Absolute, escaping, credential, and metadata paths are unsupported.'
  else if (d.app.cwd && depth === 0 && d.app.cwd !== '.')
    errors['app.cwd'] = 'Use . for the worktree root, or a directory within it.'
  try {
    const u = localUrl(d.app.origin)
    if (u.pathname !== '/' || u.search)
      throw new Error('Use only local HTTP host and port, without a path or query.')
  } catch (e) {
    errors['app.origin'] = (e as Error).message
  }
  for (const field of ['page', 'readyPath'] as const)
    try {
      if (localUrl(d.app[field], d.app.origin).origin !== localUrl(d.app.origin).origin)
        throw new Error('Use a path or URL on the app origin.')
    } catch (e) {
      errors[`app.${field}`] = (e as Error).message
    }
  if (d.actions.length < 1 || d.actions.length > 20) errors.actions = 'Add 1 to 20 user actions.'
  if (d.requests.length < 1 || d.requests.length > 6)
    errors.requests = 'Add 1 to 6 controlled requests.'
  const ids = d.requests.map((r) => r.id)
  d.actions.forEach((a, i) => {
    const p = `actions.${i}`
    for (const field of ['id', 'label', 'selector'] as const)
      required(a[field], `${p}.${field}`, `an action ${field === 'label' ? 'name' : field}`)
    if (d.actions.filter((b) => b.id === a.id).length > 1)
      errors[`${p}.id`] = 'Give each action a unique ID.'
    if (!['click', 'fill', 'select'].includes(a.kind))
      errors[`${p}.kind`] = 'Only click, fill, and select are supported.'
    if (a.kind !== 'click' && a.value === undefined)
      errors[`${p}.value`] =
        'Enter a value, or explicitly choose an empty value to clear this field.'
    if (a.waitForRequest !== undefined && !ids.includes(a.waitForRequest))
      errors[`${p}.waitForRequest`] =
        'This request was removed or renamed. Choose an existing request gate.'
  })
  d.requests.forEach((r, i) => {
    const p = `requests.${i}`
    required(r.label, `${p}.label`, 'a readable request name')
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(r.id) || ids.filter((id) => id === r.id).length > 1)
      errors[`${p}.id`] =
        'Use a unique ID beginning with a letter, up to 32 letters, digits, hyphens, or underscores.'
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method.toUpperCase()))
      errors[`${p}.method`] = 'Choose GET, POST, PUT, PATCH, or DELETE.'
    required(r.url, `${p}.url`, 'an exact request URL')
    try {
      canonicalRequestUrl(r.url, d.app.origin)
    } catch (e) {
      errors[`${p}.url`] = (e as Error).message
    }
    const status = Number(r.status)
    if (
      !r.status.trim() ||
      !Number.isInteger(status) ||
      status < 200 ||
      status > 599 ||
      [204, 205, 304].includes(status)
    )
      errors[`${p}.status`] =
        'Choose 200 to 599, excluding 204, 205, and 304: the response must carry JSON.'
    try {
      JSON.parse(r.fixture)
    } catch {
      errors[`${p}.fixture`] =
        'Enter valid JSON for this response fixture, including quotes around property names.'
    }
    for (let j = 0; j < i; j++) {
      const other = d.requests[j]
      try {
        if (
          r.method.toUpperCase() === other.method.toUpperCase() &&
          canonicalRequestUrl(r.url, d.app.origin) ===
            canonicalRequestUrl(other.url, d.app.origin) &&
          (r.postData === null || other.postData === null || r.postData === other.postData)
        ) {
          const msg = `Ambiguous with “${other.label || other.id}”. Use a distinct URL or exact, different request bodies.`
          errors[`${p}.url`] = msg
          errors[`requests.${j}.url`] =
            `Ambiguous with “${r.label || r.id}”. Separate the URLs or exact bodies.`
        }
      } catch {
        /* URL error is already beside its field. */
      }
    }
  })
  if (
    d.order.length !== ids.length ||
    new Set(d.order).size !== ids.length ||
    !d.order.every((id) => ids.includes(id))
  )
    errors.order = 'Include each controlled response exactly once in the delivery order.'
  required(d.expected.description, 'expected.description', 'a description of expected behavior')
  required(d.expected.selector, 'expected.selector', 'a visible-DOM selector')
  if (d.expected.afterRequest !== null && !ids.includes(d.expected.afterRequest))
    errors['expected.afterRequest'] =
      'Choose an existing request checkpoint or final checkpoint only.'
  for (const [field, min, max] of [
    ['settleMs', 0, 2000],
    ['timeoutMs', 500, 15000],
  ] as const) {
    const n = Number(d[field])
    if (!d[field].trim() || !Number.isInteger(n) || n < min || n > max)
      errors[field] = `Enter ${min} to ${max} milliseconds.`
  }
  return errors
}
export function analyzeDocument(doc: ScenarioDocument) {
  let form = doc.form
  try {
    if (doc.mode === 'json') form = draftFromInput(JSON.parse(doc.json))
  } catch (e) {
    return { errors: { json: (e as Error).message } as Record<string, string>, form }
  }
  const errors = draftIssues(form)
  let input: ReplayScenario | undefined
  try {
    const value = draftInput(form)
    if (!Object.keys(errors).length) input = validateScenario(value)
  } catch (e) {
    if (!Object.keys(errors).length) errors.json = (e as Error).message
  }
  return { errors, form, input }
}
export function stableScenario(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableScenario).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableScenario(v)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
export function actionSummary(a: ScenarioDraft['actions'][number]) {
  return `${a.kind === 'fill' ? 'Fill' : a.kind === 'select' ? 'Select' : 'Click'}${a.kind !== 'click' ? ` ${JSON.stringify(a.value ?? '')}` : ''} — ${a.label || a.selector || 'choose an element'}`
}
