import { useEffect, useState, type ReactNode } from 'react'
import type { CodingSession } from '../../../shared/coding'
import type { ReplayScenario } from '../../../shared/project-replay'
import {
  actionSummary,
  analyzeDocument,
  draftFromInput,
  draftInput,
  formatCommand,
  stableScenario,
  type AppSuggestion,
  type ScenarioDocument,
  type ScenarioDraft,
} from '../../../shared/scenario-editor'
import './scenario-editor.css'

const steps = [
  'App setup',
  'User actions',
  'Controlled requests',
  'Expected behavior',
  'Review and run',
]
const newId = (prefix: string, ids: string[]) => {
  let n = 1
  while (ids.includes(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}
export function ScenarioEditor({
  document: doc,
  onChange,
  session,
  suggestions,
  suggestionsError,
  proposal,
  reviewingProposal,
  onCloseProposal,
  onSave,
  onReset,
  conflict,
  onReviewLatest,
  saving,
  saveError,
  draftStorageError,
}: {
  document: ScenarioDocument
  onChange: (doc: ScenarioDocument) => void
  session: CodingSession
  suggestions: AppSuggestion[]
  suggestionsError: string
  proposal?: ReplayScenario
  reviewingProposal: boolean
  onCloseProposal: () => void
  onSave: (input: ReplayScenario, run: boolean) => Promise<void>
  onReset: () => void
  conflict: boolean
  onReviewLatest: () => void
  saving: boolean
  saveError: string
  draftStorageError: string
}) {
  const [step, setStep] = useState(0),
    [feedback, setFeedback] = useState('')
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const analysis = analyzeDocument(doc),
    d = analysis.form,
    errors = analysis.errors
  useEffect(() => {
    if (!focusTarget) return
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(focusTarget)
      for (let parent = target?.parentElement; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement) parent.open = true
      target?.focus()
      setFocusTarget(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusTarget, doc, step])
  const id = (path: string) => `scenario-${path.replaceAll('.', '-')}`
  function edit(update: (d: ScenarioDraft) => void, focus?: string) {
    const next = structuredClone(d)
    update(next)
    let json = doc.json
    try {
      json = JSON.stringify(draftInput(next), null, 2)
    } catch {
      /* Incomplete JSON/numeric fields remain in the guided draft. */
    }
    if (focus) setFocusTarget(focus)
    onChange({ ...doc, form: next, json, mode: 'guided' })
    setFeedback('')
  }
  function navigate(next: number) {
    setStep(next)
    setFocusTarget(`scenario-step-${next}`)
  }
  function view(mode: 'guided' | 'json') {
    try {
      if (mode === 'json') onChange({ ...doc, json: JSON.stringify(draftInput(d), null, 2), mode })
      else onChange({ ...doc, form: draftFromInput(JSON.parse(doc.json)), mode })
      setFeedback('')
    } catch (e) {
      setFeedback(
        `${(e as Error).message} Your entered values are retained. Correct this field before switching editor views.`,
      )
    }
  }
  async function save(run: boolean) {
    if (!analysis.input) {
      setFeedback('Correct the highlighted fields before saving. Your draft is retained.')
      const first = Object.keys(errors)[0]
      const target =
        first === 'name' || first.startsWith('app.')
          ? 0
          : first.startsWith('actions')
            ? 1
            : first.startsWith('requests')
              ? 2
              : first.startsWith('expected') || first === 'settleMs' || first === 'timeoutMs'
                ? 3
                : 4
      if (doc.mode === 'guided') {
        setStep(target)
        const row = /^(actions|requests)\.(\d+)\.label$/.exec(first)
        setFocusTarget(
          row
            ? `row-${d[row[1] as 'actions' | 'requests'][Number(row[2])].key}-name`
            : ['actions', 'requests', 'order', 'json'].includes(first)
              ? `scenario-step-${target}`
              : id(first),
        )
      } else {
        setFocusTarget('scenario-json')
      }
      return
    }
    setFeedback('')
    await onSave(analysis.input, run)
  }
  function field(
    path: string,
    label: string,
    value: string,
    change: (value: string) => void,
    options: {
      area?: boolean
      rows?: number
      hint?: string
      placeholder?: string
      type?: string
    } = {},
  ) {
    const inputId = id(path),
      error = errors[path]
    const common = {
      id: inputId,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        change(e.target.value),
      'aria-invalid': Boolean(error),
      'aria-describedby': `${inputId}-help`,
      placeholder: options.placeholder,
      spellCheck: false,
    }
    return (
      <div className="scenario-field">
        <label htmlFor={inputId}>{label}</label>
        {options.area ? (
          <textarea {...common} rows={options.rows ?? 5} />
        ) : (
          <input {...common} type={options.type ?? 'text'} />
        )}
        <small id={`${inputId}-help`} className={error ? 'scenario-error' : ''}>
          {error ?? options.hint}
        </small>
      </div>
    )
  }
  function select(
    path: string,
    label: string,
    value: string,
    change: (value: string) => void,
    options: { value: string; label: string }[],
    hint?: string,
  ) {
    const inputId = id(path),
      missing = !options.some((o) => o.value === value)
    return (
      <div className="scenario-field">
        <label htmlFor={inputId}>{label}</label>
        <select
          id={inputId}
          value={value}
          onChange={(e) => change(e.target.value)}
          aria-invalid={Boolean(errors[path])}
          aria-describedby={`${inputId}-help`}
        >
          {missing && <option value={value}>Unsupported or missing: {value}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <small id={`${inputId}-help`} className={errors[path] ? 'scenario-error' : ''}>
          {errors[path] ?? hint}
        </small>
      </div>
    )
  }
  const gates = [
    { value: '', label: 'No request gate' },
    ...d.requests.map((r) => ({ value: r.id, label: r.label || r.id })),
  ]
  function moveRow(type: 'actions' | 'requests', index: number, offset: number) {
    const rows = d[type]
    if (index + offset < 0 || index + offset >= rows.length) return
    const key = rows[index].key
    edit((next) => {
      if (type === 'actions') {
        const [item] = next.actions.splice(index, 1)
        next.actions.splice(index + offset, 0, item)
      } else {
        const [item] = next.requests.splice(index, 1)
        next.requests.splice(index + offset, 0, item)
      }
    }, `row-${key}-name`)
  }
  function removeRow(type: 'actions' | 'requests', index: number) {
    const remaining = d[type].filter((_, i) => i !== index),
      focus = remaining[Math.min(index, remaining.length - 1)]
    edit(
      (next) => {
        if (type === 'requests') {
          const removed = next.requests[index].id
          next.order = next.order.filter((v) => v !== removed)
        }
        next[type].splice(index, 1)
      },
      focus ? `row-${focus.key}-name` : `add-${type}`,
    )
  }
  function rowName(type: 'actions' | 'requests', index: number) {
    const row = d[type][index],
      path = `${type}.${index}.label`,
      inputId = `row-${row.key}-name`
    return (
      <div className="scenario-field">
        <label htmlFor={inputId}>{type === 'actions' ? 'Action name' : 'Request name'}</label>
        <input
          id={inputId}
          value={row.label}
          onChange={(e) =>
            edit((n) => {
              n[type][index].label = e.target.value
            })
          }
          aria-invalid={Boolean(errors[path])}
          aria-describedby={`${inputId}-help`}
          placeholder={type === 'actions' ? 'Select Month in Period' : 'Monthly metrics'}
        />
        <small id={`${inputId}-help`} className="scenario-error">
          {errors[path]}
        </small>
      </div>
    )
  }
  function renameRequest(index: number, value: string) {
    edit((n) => {
      const old = n.requests[index].id
      n.requests[index].id = value
      n.order = n.order.map((id) => (id === old ? value : id))
      n.actions.forEach((a) => {
        if (a.waitForRequest === old) a.waitForRequest = value
      })
      if (n.expected.afterRequest === old) n.expected.afterRequest = value
    })
  }
  function orderMove(index: number, offset: number) {
    edit((n) => {
      const [item] = n.order.splice(index, 1)
      n.order.splice(index + offset, 0, item)
    }, `order-response-${d.order[index]}`)
  }
  const lastReplay = session.projectReplay?.runs.at(-1)
  const startup =
    lastReplay?.status === 'error' &&
    /app|start|readiness|prepar|approval|port|command/i.test(lastReplay.error ?? '')
      ? lastReplay
      : undefined
  const approval = session.approval
  const busy = session.busy || saving
  const previous = analysis.input ?? session.projectReplay?.saved?.scenario
  const proposalChanges = proposal
    ? (
        [
          ['Scenario name', previous?.name, proposal.name],
          ['App setup', previous?.app, proposal.app],
          ['User actions', previous?.actions, proposal.actions],
          ['Controlled responses', previous?.requests, proposal.requests],
          ['Delivery order', previous?.order, proposal.order],
          ['Expected behavior', previous?.expected, proposal.expected],
          [
            'Checkpoint timing',
            [previous?.settleMs, previous?.timeoutMs],
            [proposal.settleMs, proposal.timeoutMs],
          ],
        ] as const
      ).filter(([, before, after]) => stableScenario(before) !== stableScenario(after))
    : []
  const review = (value: ScenarioDraft): ReactNode => (
    <dl className="scenario-review">
      <dt>App command</dt>
      <dd>
        <code>{value.app.command || 'Choose a start command'}</code>
        <br />
        Directory: {value.app.cwd}; origin: {value.app.origin}; page: {value.app.page}; ready:{' '}
        {value.app.readyPath}
        {value.app.prepare !== undefined && (
          <>
            <br />
            Preparation: <code>{value.app.prepare}</code>
          </>
        )}
      </dd>
      <dt>User actions</dt>
      <dd>
        <ol>
          {value.actions.map((a) => (
            <li key={a.key}>
              {actionSummary(a)} <code>{a.selector}</code>
              {a.waitForRequest &&
                ` · wait for ${value.requests.find((r) => r.id === a.waitForRequest)?.label ?? a.waitForRequest} to be sent`}
            </li>
          ))}
        </ol>
        {!value.actions.length && 'No actions added.'}
      </dd>
      <dt>Controlled responses</dt>
      <dd>
        <ul>
          {value.requests.map((r) => (
            <li key={r.key}>
              <strong>{r.label || r.id}</strong> · {r.method} <code>{r.url}</code> · HTTP {r.status}{' '}
              ·{' '}
              {r.postData === null
                ? 'any request body'
                : `exact body ${JSON.stringify(r.postData)}`}
              <details>
                <summary>Response fixture</summary>
                <pre>{r.fixture}</pre>
              </details>
            </li>
          ))}
        </ul>
        {!value.requests.length && 'No controlled requests added.'}
      </dd>
      <dt>Delivery order</dt>
      <dd>
        {value.order.map((r) => value.requests.find((q) => q.id === r)?.label ?? r).join(' → ') ||
          'Add requests to choose delivery order.'}
      </dd>
      <dt>DOM assertion</dt>
      <dd>
        {value.expected.description || 'Describe the expected behavior.'}
        <br />
        Read textContent from each visible element matching{' '}
        <code>{value.expected.selector || '(choose a selector)'}</code>, including whitespace and
        descendant text, in DOM order. Compare exactly with:
        <ol>
          {value.expected.texts.map((t, i) => (
            <li key={i}>
              <code>{JSON.stringify(t)}</code>
            </li>
          ))}
        </ol>
        {!value.expected.texts.length && '[] — expect no matching elements.'}
        <br />
        {value.expected.afterRequest === null
          ? 'Final checkpoint only.'
          : `Also check after ${value.requests.find((r) => r.id === value.expected.afterRequest)?.label ?? value.expected.afterRequest} and every later response.`}{' '}
        Wait two paint frames and {value.settleMs}ms after body consumption; timeout{' '}
        {value.timeoutMs}ms.
      </dd>
    </dl>
  )
  return (
    <div className="scenario-guided">
      {conflict && (
        <div role="alert" className="scenario-notice">
          <strong>A newer scenario revision is saved.</strong>
          <p>
            Your draft has been retained. Review it against the latest saved scenario before
            replacing that revision.
          </p>
          <button disabled={busy} onClick={onReset}>
            Load latest saved scenario
          </button>
          <button disabled={busy} onClick={onReviewLatest}>
            Keep my draft against latest revision
          </button>
          <details>
            <summary>Latest saved configuration</summary>
            {session.projectReplay?.saved &&
              review(draftFromInput(session.projectReplay.saved.scenario))}
          </details>
        </div>
      )}
      {reviewingProposal && proposal && (
        <section className="scenario-notice" aria-label="Agent proposal review">
          <h3>Review agent proposal</h3>
          <p>
            Changed sections:{' '}
            {proposalChanges.map(([label]) => label).join(', ') || 'No configuration changes.'}
          </p>
          <p>
            This proposal changes a draft only. Saving is separate; running still requests command
            approval. Correct any field after loading it.
          </p>
          {review(draftFromInput(proposal))}
          <button
            disabled={busy}
            onClick={() => {
              const form = draftFromInput(proposal)
              onChange({ ...doc, form, json: JSON.stringify(proposal, null, 2), mode: 'guided' })
              onCloseProposal()
              navigate(0)
            }}
          >
            Use proposal as draft
          </button>
          <button onClick={onCloseProposal}>Keep current draft</button>
          {
            <p>
              {
                'Loading replaces the current editor fields. Your saved scenario and evidence stay recorded until you save a new revision.'
              }
            </p>
          }
        </section>
      )}
      <div className="scenario-view-switch" role="tablist" aria-label="Scenario editor view">
        <button
          role="tab"
          aria-selected={doc.mode === 'guided'}
          onClick={() => view('guided')}
          disabled={busy}
        >
          Guided editor
        </button>
        <button
          role="tab"
          aria-selected={doc.mode === 'json'}
          onClick={() => view('json')}
          disabled={busy}
        >
          Advanced JSON
        </button>
      </div>
      {(startup ||
        (approval &&
          /^(Prepare this isolated|Start .* from its isolated)/.test(approval.detail))) && (
        <div className="scenario-notice" role="status">
          <strong>{startup ? 'App setup needs attention' : 'App command approval pending'}</strong>
          {startup && <p>{startup.error}</p>}
          <button
            onClick={() => {
              view('guided')
              navigate(0)
            }}
          >
            Open app setup
          </button>
        </div>
      )}
      {doc.mode === 'json' ? (
        <div className="scenario-json">
          <p>
            Advanced editor uses the same scenario. Exact body strings, optional fields, fixtures,
            IDs, and timing values are preserved. Fix malformed JSON before returning to guided
            fields.
          </p>
          <label htmlFor="scenario-json">Replay scenario JSON</label>
          <textarea
            id="scenario-json"
            aria-label="Replay scenario JSON"
            value={doc.json}
            disabled={busy}
            spellCheck={false}
            aria-invalid={Boolean(errors.json)}
            onChange={(e) => {
              const json = e.target.value
              let form = doc.form
              try {
                form = draftFromInput(JSON.parse(json))
              } catch {
                /* Keep raw text and last structured draft until repaired. */
              }
              onChange({ ...doc, json, form, mode: 'json' })
              setFeedback('')
            }}
          />
          {Object.keys(errors).length > 0 && (
            <ul className="scenario-error" aria-label="JSON scenario errors">
              {Object.entries(errors).map(([path, msg]) => (
                <li key={path}>
                  {path}: {msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <nav className="scenario-step-nav" aria-label="Scenario steps">
            {steps.map((label, i) => (
              <button
                key={label}
                aria-current={step === i ? 'step' : undefined}
                onClick={() => navigate(i)}
              >
                {i + 1}. {label}
              </button>
            ))}
          </nav>
          <section hidden={step !== 0} aria-label="App setup">
            <h3 id="scenario-step-0" tabIndex={-1}>
              1. App setup
            </h3>
            <p>
              Commands run in isolated worktrees after approval. {'{PORT}'} allocates a local port;
              pass it to your app and use it in the origin.
            </p>
            {suggestions.length > 0 && (
              <details className="scenario-suggestions">
                <summary>Detected setup suggestions ({suggestions.length})</summary>
                {suggestions.map((s, i) => (
                  <div key={i}>
                    <strong>{s.label}</strong>
                    <p>{s.reason}</p>
                    <code>{formatCommand(s.app.executable, s.app.args)}</code>
                    <button
                      disabled={busy}
                      onClick={() =>
                        edit((n) => {
                          n.app = {
                            ...n.app,
                            ...Object.fromEntries(
                              Object.entries(s.app).filter(
                                ([k]) => !['executable', 'args', 'prepare'].includes(k),
                              ),
                            ),
                            command: formatCommand(s.app.executable, s.app.args),
                          }
                        }, id('app.command'))
                      }
                    >
                      Use suggestion {i + 1}
                    </button>
                  </div>
                ))}
              </details>
            )}
            {!suggestions.length && (
              <p>
                {suggestionsError ||
                  'No start command detected yet. Enter your project’s command below; no command has been executed.'}
              </p>
            )}
            {approval && (
              <div className="scenario-notice" role="status">
                Command approval pending:{' '}
                <code>{formatCommand(approval.executable, approval.args)}</code>
                <br />
                Working directory: {approval.cwd}
                <button
                  onClick={() => {
                    const target = document.getElementById('coding-command-approval')
                    target?.scrollIntoView({ block: 'center' })
                    target?.focus()
                  }}
                >
                  Review command approval
                </button>
              </div>
            )}
            {startup && (
              <div className="scenario-notice" role="status">
                <strong>Recorded app setup error</strong>
                <p>{startup.error}</p>
                <details>
                  <summary>Startup output</summary>
                  <pre>{startup.output || 'No command output recorded.'}</pre>
                </details>
                <p>
                  Correct the setup, save, then run Baseline again. The failed attempt remains in
                  evidence.
                </p>
              </div>
            )}
            <fieldset disabled={busy}>
              {field(
                'name',
                'Scenario name',
                d.name,
                (v) =>
                  edit((n) => {
                    n.name = v
                  }),
                { placeholder: 'Previous period overwrites active month' },
              )}
              {field(
                'app.command',
                'Start command',
                d.app.command,
                (v) =>
                  edit((n) => {
                    n.app.command = v
                  }),
                {
                  placeholder: 'npm run dev -- --port {PORT}',
                  hint: 'Executable and literal arguments. Quote arguments containing spaces. Pipes, shell variables, and shell operators are not evaluated.',
                },
              )}
              <div className="scenario-grid">
                {field(
                  'app.cwd',
                  'Working directory',
                  d.app.cwd,
                  (v) =>
                    edit((n) => {
                      n.app.cwd = v
                    }),
                  { hint: 'Relative to each worktree, for example . or web.' },
                )}
                {field(
                  'app.origin',
                  'Local origin',
                  d.app.origin,
                  (v) =>
                    edit((n) => {
                      n.app.origin = v
                    }),
                  { placeholder: 'http://127.0.0.1:{PORT}' },
                )}
                {field(
                  'app.page',
                  'Page path',
                  d.app.page,
                  (v) =>
                    edit((n) => {
                      n.app.page = v
                    }),
                  { hint: 'A path or URL on the same local origin.' },
                )}
              </div>
              <details>
                <summary>Startup options</summary>
                {field(
                  'app.readyPath',
                  'Readiness path',
                  d.app.readyPath,
                  (v) =>
                    edit((n) => {
                      n.app.readyPath = v
                    }),
                  { hint: 'The runner waits for this HTTP endpoint before opening Chromium.' },
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={d.app.prepare !== undefined}
                    onChange={(e) =>
                      edit((n) => {
                        if (e.target.checked) n.app.prepare = ''
                        else delete n.app.prepare
                      })
                    }
                  />{' '}
                  Run a preparation command before each app start
                </label>
                {d.app.prepare !== undefined &&
                  field(
                    'app.prepare',
                    'Preparation command',
                    d.app.prepare,
                    (v) =>
                      edit((n) => {
                        n.app.prepare = v
                      }),
                    {
                      placeholder: 'npm ci',
                      hint: 'Runs in the same working directory and requires its own approval.',
                    },
                  )}
              </details>
            </fieldset>
          </section>
          <section hidden={step !== 1} aria-label="User actions">
            <h3 id="scenario-step-1" tabIndex={-1}>
              2. User actions
            </h3>
            <p>
              Actions run from top to bottom before controlled responses are released. Use a
              selector from your project’s DOM.
            </p>
            <fieldset disabled={busy}>
              {!d.actions.length && (
                <p className="scenario-empty">
                  No actions yet. Add a click, fill, or select to describe what a user does.
                </p>
              )}
              {errors.actions && <p className="scenario-error">{errors.actions}</p>}
              {d.actions.map((a, i) => (
                <article key={a.key} className="scenario-row" aria-label={`Action ${i + 1}`}>
                  <div className="scenario-row-heading">
                    <strong>
                      {i + 1}. {actionSummary(a)}
                    </strong>
                    <div>
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => moveRow('actions', i, -1)}
                        aria-label={`Move action ${i + 1} earlier`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={i === d.actions.length - 1}
                        onClick={() => moveRow('actions', i, 1)}
                        aria-label={`Move action ${i + 1} later`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRow('actions', i)}
                        aria-label={`Remove action ${i + 1}`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {rowName('actions', i)}
                  <div className="scenario-grid">
                    {select(
                      `actions.${i}.kind`,
                      'Action type',
                      a.kind,
                      (v) =>
                        edit((n) => {
                          n.actions[i].kind = v
                        }),
                      ['click', 'fill', 'select'].map((value) => ({
                        value,
                        label: value[0].toUpperCase() + value.slice(1),
                      })),
                    )}
                    {field(
                      `actions.${i}.selector`,
                      'Element selector',
                      a.selector,
                      (v) =>
                        edit((n) => {
                          n.actions[i].selector = v
                        }),
                      {
                        placeholder: '[data-period="month"]',
                        hint: 'CSS or Playwright-supported selector; verified when the real browser runs.',
                      },
                    )}
                  </div>
                  {a.kind !== 'click' && (
                    <>
                      {field(
                        `actions.${i}.value`,
                        a.kind === 'select' ? 'Option value' : 'Fill value',
                        a.value ?? '',
                        (v) =>
                          edit((n) => {
                            n.actions[i].value = v
                          }),
                        {
                          area: true,
                          rows: 2,
                          hint:
                            a.kind === 'select'
                              ? 'The option value attribute, not its displayed label.'
                              : 'Exact text to enter.',
                        },
                      )}
                      <label>
                        <input
                          type="checkbox"
                          checked={a.value === ''}
                          onChange={(e) =>
                            edit((n) => {
                              n.actions[i].value = e.target.checked ? '' : undefined
                            })
                          }
                        />{' '}
                        Use an empty value
                      </label>
                    </>
                  )}
                  {select(
                    `actions.${i}.waitForRequest`,
                    'Wait for request',
                    a.waitForRequest ?? '',
                    (v) =>
                      edit((n) => {
                        if (v) n.actions[i].waitForRequest = v
                        else delete n.actions[i].waitForRequest
                      }),
                    gates,
                    'Wait until this request is sent, not delivered. Configure requests in step 3.',
                  )}
                  <details>
                    <summary>Action identifier and retained options</summary>
                    {field(`actions.${i}.id`, 'Action ID', a.id, (v) =>
                      edit((n) => {
                        n.actions[i].id = v
                      }),
                    )}
                    {a.kind === 'click' &&
                      a.value !== undefined &&
                      field(
                        `actions.${i}.value`,
                        'Retained click value',
                        a.value,
                        (v) =>
                          edit((n) => {
                            n.actions[i].value = v
                          }),
                        {
                          area: true,
                          rows: 2,
                          hint: 'Preserved from JSON; click does not consume this value.',
                        },
                      )}
                  </details>
                </article>
              ))}
              <button
                id="add-actions"
                disabled={d.actions.length >= 20}
                onClick={() => {
                  const key = crypto.randomUUID()
                  edit(
                    (n) =>
                      n.actions.push({
                        key,
                        id: newId(
                          'action',
                          n.actions.map((a) => a.id),
                        ),
                        label: '',
                        kind: 'click',
                        selector: '',
                      }),
                    `row-${key}-name`,
                  )
                }}
              >
                Add action
              </button>
            </fieldset>
          </section>
          <section hidden={step !== 2} aria-label="Controlled requests">
            <h3 id="scenario-step-2" tabIndex={-1}>
              3. Controlled requests
            </h3>
            <p>
              Match each fetch/XHR exactly once. Query parameter order is normalized; paths and
              values must match exactly. Wildcards and regular expressions are not supported. Extra
              or repeated requests are reported during replay.
            </p>
            <fieldset disabled={busy}>
              {!d.requests.length && (
                <p className="scenario-empty">
                  No controlled requests yet. Add each response that must wait at a gate.
                </p>
              )}
              {errors.requests && <p className="scenario-error">{errors.requests}</p>}
              {d.requests.map((r, i) => (
                <article
                  key={r.key}
                  className="scenario-row"
                  aria-label={`Controlled request ${i + 1}`}
                >
                  <div className="scenario-row-heading">
                    <strong>{r.label || `Response ${i + 1}`}</strong>
                    <button
                      onClick={() => removeRow('requests', i)}
                      aria-label={`Remove request ${i + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                  {rowName('requests', i)}
                  <div className="scenario-grid">
                    {select(
                      `requests.${i}.method`,
                      'HTTP method',
                      r.method.toUpperCase(),
                      (v) =>
                        edit((n) => {
                          n.requests[i].method = v
                        }),
                      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
                        value,
                        label: value,
                      })),
                    )}
                    {field(
                      `requests.${i}.url`,
                      'Exact request URL',
                      r.url,
                      (v) =>
                        edit((n) => {
                          n.requests[i].url = v
                        }),
                      {
                        placeholder: '/metrics/snapshot?period=month',
                        hint: 'Relative to the local origin, or an exact local HTTP URL.',
                      },
                    )}
                  </div>
                  {field(
                    `requests.${i}.fixture`,
                    'JSON response fixture',
                    r.fixture,
                    (v) =>
                      edit((n) => {
                        n.requests[i].fixture = v
                      }),
                    {
                      area: true,
                      placeholder: '{"rows":["Monthly revenue $45,000"]}',
                      hint: 'The same JSON body is used for every version and response order.',
                    },
                  )}
                  <details>
                    <summary>Request matching options</summary>
                    {select(
                      `requests.${i}.body`,
                      'Request body matching',
                      r.postData === null ? 'any' : 'exact',
                      (v) =>
                        edit((n) => {
                          n.requests[i].postData = v === 'any' ? null : ''
                        }),
                      [
                        { value: 'any', label: 'Any body' },
                        { value: 'exact', label: 'Exact body text' },
                      ],
                      'Body matching is exact text, including whitespace; JSON bodies are not compared structurally.',
                    )}
                    {r.postData !== null &&
                      field(
                        `requests.${i}.postData`,
                        'Exact request body',
                        r.postData,
                        (v) =>
                          edit((n) => {
                            n.requests[i].postData = v
                          }),
                        { area: true, hint: 'An empty exact body is distinct from Any body.' },
                      )}
                    {field(
                      `requests.${i}.status`,
                      'Response HTTP status',
                      r.status,
                      (v) =>
                        edit((n) => {
                          n.requests[i].status = v
                        }),
                      { type: 'number' },
                    )}
                    {field(`requests.${i}.id`, 'Request ID', r.id, (v) => renameRequest(i, v), {
                      hint: 'Used by gates and order. Renaming updates those references.',
                    })}
                  </details>
                </article>
              ))}
              <button
                id="add-requests"
                disabled={d.requests.length >= 6}
                onClick={() => {
                  const key = crypto.randomUUID()
                  edit((n) => {
                    const requestId = newId('request', [
                      ...n.requests.map((r) => r.id),
                      ...n.actions.flatMap((a) => (a.waitForRequest ? [a.waitForRequest] : [])),
                      ...(n.expected.afterRequest ? [n.expected.afterRequest] : []),
                    ])
                    n.requests.push({
                      key,
                      id: requestId,
                      label: '',
                      method: 'GET',
                      url: '',
                      postData: null,
                      status: '200',
                      fixture: '{}',
                    })
                    n.order.push(requestId)
                  }, `row-${key}-name`)
                }}
              >
                Add controlled request
              </button>
            </fieldset>
          </section>
          <section hidden={step !== 3} aria-label="Expected behavior">
            <h3 id="scenario-step-3" tabIndex={-1}>
              4. Expected behavior
            </h3>
            <p>
              Check textContent of each visible matching element, including whitespace and
              descendant text. Compare one expected value per element, in DOM order.
            </p>
            <fieldset disabled={busy}>
              {field(
                'expected.description',
                'Expected behavior',
                d.expected.description,
                (v) =>
                  edit((n) => {
                    n.expected.description = v
                  }),
                { placeholder: 'Active monthly metrics survive the older weekly response.' },
              )}
              {field(
                'expected.selector',
                'Observed element selector',
                d.expected.selector,
                (v) =>
                  edit((n) => {
                    n.expected.selector = v
                  }),
                { placeholder: '#metric-list li' },
              )}
              {d.expected.texts.map((t, i) => (
                <div className="scenario-text-row" key={i}>
                  {field(
                    `expected.texts.${i}`,
                    `Expected text ${i + 1}`,
                    t,
                    (v) =>
                      edit((n) => {
                        n.expected.texts[i] = v
                      }),
                    {
                      area: true,
                      rows: 2,
                      hint: 'Compared exactly, including whitespace and line breaks.',
                    },
                  )}
                  <button
                    onClick={() =>
                      edit(
                        (n) => {
                          n.expected.texts.splice(i, 1)
                        },
                        d.expected.texts.length > 1
                          ? id(`expected.texts.${Math.max(0, i - 1)}`)
                          : 'add-expected-text',
                      )
                    }
                    aria-label={`Remove expected text ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {!d.expected.texts.length && (
                <p>
                  Expect no matching elements ([]). Add expected text for each element you expect to
                  see.
                </p>
              )}
              <button
                id="add-expected-text"
                onClick={() =>
                  edit(
                    (n) => {
                      n.expected.texts.push('')
                    },
                    id(`expected.texts.${d.expected.texts.length}`),
                  )
                }
              >
                Add expected text
              </button>
              {select(
                'expected.afterRequest',
                'Start checking after response',
                d.expected.afterRequest ?? '',
                (v) =>
                  edit((n) => {
                    n.expected.afterRequest = v || null
                  }),
                [{ value: '', label: 'Final checkpoint only' }, ...gates.slice(1)],
                'When set, the assertion is checked after this response and every later response, plus the final checkpoint.',
              )}
              <details>
                <summary>Checkpoint timing</summary>
                {field(
                  'settleMs',
                  'UI settle time (ms)',
                  d.settleMs,
                  (v) =>
                    edit((n) => {
                      n.settleMs = v
                    }),
                  { type: 'number', hint: '0–2000ms after body consumption and two paint frames.' },
                )}
                {field(
                  'timeoutMs',
                  'Replay timeout (ms)',
                  d.timeoutMs,
                  (v) =>
                    edit((n) => {
                      n.timeoutMs = v
                    }),
                  {
                    type: 'number',
                    hint: '500–15000ms. Missing gates and selectors become execution errors.',
                  },
                )}
              </details>
            </fieldset>
          </section>
          <section hidden={step !== 4} aria-label="Review and run">
            <h3 id="scenario-step-4" tabIndex={-1}>
              5. Review and run
            </h3>
            <p>
              Review the saved experiment before running commands. Saving creates a scenario
              revision; replay separately requests app command approval.
            </p>
            {review(d)}
            <fieldset disabled={busy}>
              <h4>Response delivery order</h4>
              {d.order.map((r, i) => (
                <div key={`${r}-${i}`} className="scenario-order-row">
                  <span id={`order-response-${r}`} tabIndex={-1}>
                    {i + 1}. {d.requests.find((q) => q.id === r)?.label || r}
                  </span>
                  <button
                    disabled={i === 0}
                    onClick={() => orderMove(i, -1)}
                    aria-label={`Deliver response ${r} earlier`}
                  >
                    ↑
                  </button>
                  <button
                    disabled={i === d.order.length - 1}
                    onClick={() => orderMove(i, 1)}
                    aria-label={`Deliver response ${r} later`}
                  >
                    ↓
                  </button>
                </div>
              ))}
              {errors.order && <p className="scenario-error">{errors.order}</p>}
            </fieldset>
          </section>
          <div className="scenario-step-footer">
            <button disabled={step === 0} onClick={() => navigate(step - 1)}>
              Previous step
            </button>
            {step < 4 && (
              <button onClick={() => navigate(step + 1)}>Next: {steps[step + 1]}</button>
            )}
            <span>Step {step + 1} of 5</span>
          </div>
        </>
      )}
      {doc.mode === 'guided' && errors.json && (
        <p className="scenario-error" role="alert">
          {errors.json}
        </p>
      )}
      {feedback && (
        <p role="alert" className="scenario-error">
          {feedback}
        </p>
      )}
      {saveError && (
        <p role="alert" className="scenario-error">
          {saveError} Your entered values are retained.
        </p>
      )}
      {draftStorageError && <p role="status">{draftStorageError}</p>}
      <div className="scenario-save">
        <button
          className="cut-primary"
          disabled={busy || conflict}
          onClick={() => void save(false)}
        >
          {saving ? 'Saving…' : 'Save scenario'}
        </button>
        <button disabled={busy || conflict} onClick={() => void save(true)}>
          Save and replay Baseline
        </button>
        <button disabled={busy} onClick={onReset}>
          {session.projectReplay?.saved ? 'Discard draft and restore saved' : 'Reset draft'}
        </button>
        <span>Draft retained on this device. Saved scenarios stay with the session.</span>
      </div>
    </div>
  )
}
