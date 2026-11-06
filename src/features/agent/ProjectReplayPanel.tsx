import { useRef, useState } from 'react'
import type { CodingSession } from '../../../shared/coding'
import {
  newScenario,
  type ProjectReplayRun,
  type ReplayEvent,
} from '../../../shared/project-replay'
import type { useCoding } from './useCoding'
import './project-replay.css'

type Actions = ReturnType<typeof useCoding>
export function ProjectReplayPanel({
  session,
  api,
  onVersion,
}: {
  session: CodingSession
  api: Actions
  onVersion: (version: string) => void
}) {
  const replay = session.projectReplay,
    saved = replay?.saved
  const [draft, setDraft] = useState(() =>
    JSON.stringify(saved?.scenario ?? replay?.proposal ?? newScenario, null, 2),
  )
  const [editorError, setEditorError] = useState('')
  const [version, setVersion] = useState('baseline')
  const [selected, setSelected] = useState('final')
  const [orderDraft, setOrderDraft] = useState<string[] | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(`parallax-replay-order-${session.id}`) ?? 'null')
      return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null
    } catch {
      return null
    }
  })
  const editor = useRef<HTMLDetailsElement>(null)
  const ids = saved?.scenario.requests.map((r) => r.id) ?? []
  const order =
    orderDraft && orderDraft.length === ids.length && ids.every((id) => orderDraft.includes(id))
      ? orderDraft
      : (replay?.order ?? [])
  let parsed: unknown
  try {
    parsed = JSON.parse(draft)
  } catch {
    parsed = null
  }
  const unsaved = Boolean(saved && JSON.stringify(parsed) !== JSON.stringify(saved.scenario))
  const changedOrder = Boolean(saved && order.join() !== replay?.order.join())
  const candidates = [
    { id: 'baseline', name: 'Baseline', digest: session.baseline.digest },
    ...session.candidates,
  ]
  const latest = (id: string) =>
    replay?.runs.filter((r) => r.version === id && r.order.join() === order.join()).at(-1) ??
    replay?.runs.filter((r) => r.version === id).at(-1)
  const stale = (run: ProjectReplayRun | undefined) =>
    Boolean(
      run &&
      (!saved ||
        unsaved ||
        changedOrder ||
        run.scenarioDigest !== saved.digest ||
        run.order.join() !== order.join() ||
        run.orderRevision !== replay?.orderRevision ||
        run.sourceDigest !== candidates.find((c) => c.id === run.version)?.digest),
    )
  const run = latest(version),
    isStale = stale(run)
  const recordedScenario =
    replay?.history?.find(
      (item) => item.revision === run?.scenarioRevision && item.digest === run?.scenarioDigest,
    )?.scenario ?? saved?.scenario
  const recordedExpected = recordedScenario?.expected ?? saved?.scenario.expected
  const event = run?.events.find((e) => e.key === selected) ?? run?.events.at(-1)
  const observed =
    event?.track === 'response' ? run?.events.find((e) => e.key === `ui:${event.requestId}`) : event
  const image =
    observed?.screenshot ??
    run?.events.filter((e) => e.screenshot && e.atMs <= (event?.atMs ?? Infinity)).at(-1)
      ?.screenshot
  const request = recordedScenario?.requests.find((r) => r.id === event?.requestId)
  const fixedA = latest('a'),
    fixedB = latest('b')
  let comparison = 'Replay both fixes against this saved scenario to compare evidence.'
  if (fixedA && fixedB && !stale(fixedA) && !stale(fixedB)) {
    if (fixedA.coverage.different || fixedB.coverage.different)
      comparison = 'Coverage differs — these outcomes are not equivalent.'
    else if (
      ['error', 'cancelled', 'running'].includes(fixedA.status) ||
      ['error', 'cancelled', 'running'].includes(fixedB.status)
    )
      comparison = 'Incomplete comparison — an execution did not complete.'
    else if (fixedA.status === fixedB.status)
      comparison = `Tie — both fixes ${fixedA.status === 'passed' ? 'satisfy' : 'fail'} this scenario.`
    else comparison = `Candidate A ${fixedA.status}; Candidate B ${fixedB.status}.`
  }
  function reorder(next: string[]) {
    setOrderDraft(next)
    localStorage.setItem(`parallax-replay-order-${session.id}`, JSON.stringify(next))
  }
  function move(id: string, target: number) {
    const next = [...order],
      from = next.indexOf(id)
    if (from < 0 || target < 0 || target >= next.length) return
    next.splice(from, 1)
    next.splice(target, 0, id)
    reorder(next)
  }
  async function save() {
    setEditorError('')
    try {
      const value = JSON.parse(draft)
      const result = await api.saveScenario(value)
      if (result?.projectReplay?.saved) {
        setDraft(JSON.stringify(result.projectReplay.saved.scenario, null, 2))
        setOrderDraft(null)
        localStorage.removeItem(`parallax-replay-order-${session.id}`)
      }
    } catch (problem) {
      setEditorError(problem instanceof Error ? problem.message : String(problem))
    }
  }
  const displayedOrder = run && !run.order.every((id) => order.includes(id)) ? run.order : order
  const columns = 2 + (recordedScenario?.actions.length ?? 0) + displayedOrder.length * 2
  function column(item: ReplayEvent) {
    if (item.key === 'navigate') return 1
    if (item.track === 'action')
      return 2 + (recordedScenario?.actions.findIndex((a) => `action:${a.id}` === item.key) ?? 0)
    if (item.key === 'final') return columns
    return (
      2 +
      (recordedScenario?.actions.length ?? 0) +
      displayedOrder.indexOf(item.requestId ?? '') * 2 +
      (item.track === 'ui' ? 1 : 0)
    )
  }
  function inspect(key: string) {
    setSelected(key)
  }
  return (
    <section className="project-replay" aria-label="Project browser replay">
      <div className="project-replay-heading">
        <div>
          <span className="cut-eyebrow">COMPARE & REPLAY</span>
          <h2>{saved?.scenario.name ?? 'Create a browser scenario'}</h2>
        </div>
        <button disabled={session.busy} onClick={() => void api.review()}>
          Refresh evidence
        </button>
      </div>
      <details className="replay-editor" open={!saved} ref={editor}>
        <summary>
          Replay scenario{' '}
          {saved
            ? `r${saved.revision} · ${saved.digest.slice(0, 10)}`
            : '· configure app, actions, requests, and expected UI'}
        </summary>
        <p>
          Use a local HTTP origin and {'{PORT}'} for an isolated app port. Match requests by exact
          URL, method, and optional body. Checkpoints read real DOM text after body consumption, two
          paint frames, and settleMs. Projects without worktree dependencies can add app.prepare
          (executable/args, for example npm ci); it requires approval before each app launch.
        </p>
        <button disabled={session.busy} onClick={() => void api.proposeReplay()}>
          Ask agent for scenario
        </button>
        {replay?.proposal && (
          <button
            disabled={session.busy}
            onClick={() => {
              setDraft(JSON.stringify(replay.proposal, null, 2))
              if (editor.current) editor.current.open = true
            }}
          >
            Review agent proposal
          </button>
        )}
        <textarea
          aria-label="Replay scenario JSON"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={session.busy}
          spellCheck={false}
        />
        <div>
          <button className="cut-primary" disabled={session.busy} onClick={() => void save()}>
            Save scenario
          </button>
          <span>
            {!saved
              ? 'Template — edit for your app before saving.'
              : unsaved
                ? 'Unsaved scenario changes — save before replay.'
                : 'Saved with this session.'}
          </span>
        </div>
        {editorError && <p role="alert">{editorError}</p>}
      </details>
      {saved && (
        <>
          <div className="project-version-tabs" role="tablist" aria-label="Replay versions">
            {candidates.map((candidate) => {
              const recorded = latest(candidate.id)
              return (
                <button
                  key={candidate.id}
                  role="tab"
                  aria-selected={version === candidate.id}
                  onClick={() => {
                    setVersion(candidate.id)
                    onVersion(candidate.id)
                  }}
                >
                  <strong>
                    {candidate.id === 'a'
                      ? 'Candidate A'
                      : candidate.id === 'b'
                        ? 'Candidate B'
                        : 'Baseline'}
                  </strong>
                  <span
                    className={`replay-outcome ${stale(recorded) ? 'stale' : (recorded?.status ?? 'pending')}`}
                  >
                    {stale(recorded)
                      ? 'STALE'
                      : recorded?.status === 'failed'
                        ? 'PRODUCT BUG'
                        : recorded?.status === 'error'
                          ? 'EXECUTION ERROR'
                          : (recorded?.status.toUpperCase() ?? 'NOT RUN')}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="project-replay-controls">
            <div>
              <strong>Delivery order</strong>
              <span data-testid="project-order">{order.join(' → ')}</span>
            </div>
            <button
              disabled={session.busy || unsaved}
              onClick={() => void api.replayProject(order, version)}
            >
              Replay{' '}
              {version === 'baseline'
                ? 'Baseline'
                : version === 'a'
                  ? 'Candidate A'
                  : 'Candidate B'}
            </button>
            <button
              className="cut-primary"
              disabled={session.busy || unsaved}
              onClick={() => void api.replayProject(order, 'all')}
            >
              Replay all
            </button>
            <button
              disabled={
                session.busy ||
                unsaved ||
                !replay?.runs.some(
                  (r) =>
                    r.version === 'baseline' && (r.status === 'passed' || r.status === 'failed'),
                )
              }
              onClick={() => void api.generateFixes()}
            >
              Generate two fixes
            </button>
            {session.busy && <button onClick={() => void api.cancel()}>Cancel replay</button>}
          </div>
          {(changedOrder || unsaved) && (
            <p className="replay-feedback" role="status">
              {unsaved
                ? 'Scenario edited — saved evidence is stale until saved and rerun.'
                : 'Order edited — recorded outcomes are stale. Press Replay to verify.'}
            </p>
          )}
          <p className="replay-comparison" aria-label="Comparison conclusion">
            {comparison}
          </p>
          <div className="project-browser">
            <div>
              <span>
                Recorded Chromium state ·{' '}
                {version === 'baseline' ? 'Baseline' : `Candidate ${version.toUpperCase()}`}
              </span>
              {image && (
                <a href={image} target="_blank" rel="noreferrer">
                  Open full browser frame
                </a>
              )}
            </div>
            <div className="project-browser-frame">
              {image ? (
                <img src={image} alt={`Captured browser: ${event?.label ?? 'checkpoint'}`} />
              ) : (
                <p>
                  {session.busy
                    ? session.activity
                    : 'Run the saved scenario to capture real browser state.'}
                </p>
              )}
            </div>
            <div>
              <span>
                {event?.label ?? 'No captured checkpoint'}
                {event && ` · ${event.atMs} ms`}
              </span>
              <strong>
                {isStale
                  ? 'STALE EVIDENCE'
                  : run?.status === 'failed'
                    ? 'PRODUCT BUG'
                    : run?.status === 'error'
                      ? 'EXECUTION ERROR'
                      : (run?.status.toUpperCase() ?? 'NOT RUN')}
              </strong>
            </div>
          </div>
          <div className="project-replay-workbench">
            <div className="project-timeline" aria-label="Aligned replay timeline">
              <div className="project-timeline-heading">
                <h3>Execution timeline</h3>
                <span>Corresponding checkpoints stay aligned across versions.</span>
                <button
                  disabled={!run?.firstUnexpected}
                  onClick={() => run?.firstUnexpected && inspect(run.firstUnexpected)}
                >
                  First unexpected state
                </button>
              </div>
              {run ? (
                <>
                  <label className="project-scrubber">
                    Shared playhead
                    <input
                      aria-label="Replay playhead"
                      type="range"
                      min={0}
                      max={Math.max(0, run.events.length - 1)}
                      value={Math.max(
                        0,
                        run.events.findIndex((e) => e.key === event?.key),
                      )}
                      onChange={(e) => inspect(run.events[Number(e.target.value)].key)}
                    />
                  </label>
                  <div className="project-tracks">
                    <div className="project-track-surface">
                      {event && (
                        <div
                          className="project-shared-playhead"
                          data-testid="shared-playhead"
                          aria-hidden="true"
                          style={{
                            left: `calc(${110 * (1 - (column(event) - 0.5) / columns)}px + ${(100 * (column(event) - 0.5)) / columns}%)`,
                          }}
                        />
                      )}
                      {(['action', 'response', 'ui'] as const).map((track) => (
                        <div key={track} className="project-track">
                          <strong>
                            {track === 'action'
                              ? 'User actions'
                              : track === 'response'
                                ? 'Network responses'
                                : 'Observed UI'}
                          </strong>
                          <div
                            className="project-track-clips"
                            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                          >
                            {run.events
                              .filter((item) => item.track === track)
                              .map((item) => (
                                <div
                                  key={item.key}
                                  className={`project-clip ${event?.key === item.key ? 'selected' : ''} ${item.unexpected ? 'unexpected' : ''} ${event?.requestId && item.requestId === event.requestId ? 'related' : ''}`}
                                  style={{ gridColumn: column(item) }}
                                  draggable={track === 'response' && !session.busy}
                                  onDragStart={(e) =>
                                    e.dataTransfer.setData(
                                      'text/parallax-project-response',
                                      item.requestId!,
                                    )
                                  }
                                  onDragOver={(e) => {
                                    if (track === 'response') e.preventDefault()
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault()
                                    const moved = e.dataTransfer.getData(
                                      'text/parallax-project-response',
                                    )
                                    if (
                                      !session.busy &&
                                      track === 'response' &&
                                      order.includes(moved)
                                    )
                                      move(moved, order.indexOf(item.requestId!))
                                  }}
                                  data-testid={
                                    track === 'response'
                                      ? `project-response-${item.requestId}`
                                      : undefined
                                  }
                                >
                                  <button
                                    aria-label={`Inspect ${item.key}`}
                                    aria-pressed={event?.key === item.key}
                                    onClick={() => inspect(item.key)}
                                    title={`${item.label}${item.detail ? ` · ${item.detail}` : ''}`}
                                  >
                                    <span>{item.label}</span>
                                    <small>
                                      {item.unexpected
                                        ? 'UNEXPECTED'
                                        : item.delivery === 'cancelled'
                                          ? 'CANCELLED'
                                          : `${item.atMs} ms`}
                                    </small>
                                  </button>
                                  {track === 'response' && (
                                    <div className="project-reorder">
                                      <button
                                        aria-label={`Move response ${item.requestId} earlier`}
                                        disabled={
                                          session.busy ||
                                          !order.includes(item.requestId!) ||
                                          order[0] === item.requestId
                                        }
                                        onClick={() =>
                                          move(item.requestId!, order.indexOf(item.requestId!) - 1)
                                        }
                                      >
                                        ←
                                      </button>
                                      <button
                                        aria-label={`Move response ${item.requestId} later`}
                                        disabled={
                                          session.busy ||
                                          !order.includes(item.requestId!) ||
                                          order.at(-1) === item.requestId
                                        }
                                        onClick={() =>
                                          move(item.requestId!, order.indexOf(item.requestId!) + 1)
                                        }
                                      >
                                        →
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {event?.requestId && event.track !== 'action' && (
                    <p className="project-observed-link">
                      {observed?.delivery === 'cancelled'
                        ? `Request ${event.requestId} cancelled — fixture not consumed; UI observed at the checkpoint.`
                        : `Controlled response ${event.requestId} → observed UI checkpoint · body-consumption barrier + ${saved.scenario.settleMs} ms settle`}
                    </p>
                  )}
                </>
              ) : (
                <p>No simulated timeline. Checkpoints appear after actual execution.</p>
              )}
            </div>
            <aside className="project-event-inspector" aria-label="Replay checkpoint inspector">
              <h3>{event?.label ?? 'Select a checkpoint'}</h3>
              <p>
                {isStale ? 'This recording is stale. ' : ''}
                {observed?.checked
                  ? 'Assertion checked at this point.'
                  : 'Intermediate observation; final assertion still applies.'}
              </p>
              {request && (
                <>
                  <h4>Request</h4>
                  <code>
                    {request.method} {request.url}
                  </code>
                  <h4>Response fixture</h4>
                  <pre>{JSON.stringify(request.json, null, 2)}</pre>
                  <p>
                    {event?.track === 'action'
                      ? 'Request captured and held; no response has been delivered at this action checkpoint.'
                      : observed?.delivery === 'cancelled'
                        ? 'Request cancelled: fixture was not consumed.'
                        : 'Observed after controlled delivery.'}
                  </p>
                </>
              )}
              <h4>Expected behavior</h4>
              <p>{recordedExpected?.description}</p>
              <pre>{JSON.stringify(recordedExpected?.texts, null, 2)}</pre>
              <h4>Actual observed UI</h4>
              <pre>{JSON.stringify(observed?.texts ?? [], null, 2)}</pre>
            </aside>
          </div>
          {run && (
            <div className={`project-run-result ${isStale ? 'stale' : run.status}`} role="status">
              <strong>
                {isStale
                  ? 'Stale result — rerun this source and scenario'
                  : run.status === 'error'
                    ? 'Execution error — assertion not completed'
                    : run.status === 'failed'
                      ? 'Product bug — observed behavior violated the assertion'
                      : run.status === 'cancelled'
                        ? 'Replay cancelled — no completed verification'
                        : run.status === 'running'
                          ? 'Real browser execution in progress'
                          : 'Scenario passed'}
              </strong>
              <p>{run.error ?? saved.scenario.expected.description}</p>
              {run.coverage.different && (
                <p className="replay-coverage">
                  Coverage changed · cancelled: {run.coverage.cancelled.join(', ') || 'none'} ·
                  missing: {run.coverage.missing.join(', ') || 'none'} · unexpected:{' '}
                  {run.coverage.unexpected.join(', ') || 'none'}. This is not equivalent coverage.
                </p>
              )}
              <small>
                Scenario r{run.scenarioRevision} · {run.scenarioDigest.slice(0, 10)} · source{' '}
                {run.sourceDigest.slice(0, 10)} · baseline {run.baselineRevision.slice(0, 10)} ·{' '}
                {run.durationMs} ms
              </small>
              <details>
                <summary>Actual execution output</summary>
                <pre>{run.output}</pre>
              </details>
            </div>
          )}
          <div className="project-export">
            <a
              href={
                !session.busy && !unsaved
                  ? `/api/coding/sessions/${session.id}/replay/export?order=${order.join(',')}`
                  : undefined
              }
              aria-disabled={session.busy || unsaved}
              download
            >
              Export regression test
            </a>
            <span>
              Standalone test includes the fixtures, fixed actions, strict coverage check, and run
              instructions.
            </span>
          </div>
          <details className="project-relevant-diff">
            <summary>
              {version === 'baseline'
                ? 'Baseline has no candidate patch'
                : `Relevant diff · Candidate ${version.toUpperCase()}`}
            </summary>
            <pre>
              {session.candidates.find((c) => c.id === version)?.patch ??
                'Captured baseline source is unchanged.'}
            </pre>
            {version !== 'baseline' && (
              <a href={`/api/coding/sessions/${session.id}/patch/${version}`} download>
                Export chosen patch
              </a>
            )}
          </details>
        </>
      )}
    </section>
  )
}
