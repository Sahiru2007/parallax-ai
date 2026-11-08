import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { DeskDivider } from './DeskLayout'
import { useDeskPreference, useCompactWindow } from './desk-preferences'
import type { CodingSession } from '../../../shared/coding'
import {
  type ReplayScenario,
  type ProjectReplayRun,
  type ReplayEvent,
} from '../../../shared/project-replay'
import type { useCoding } from './useCoding'
import './project-replay.css'
import { ScenarioEditor } from './ScenarioEditor'
import { nativeWindow, openFrame } from './native-desktop'
import {
  analyzeDocument,
  draftFromInput,
  draftInput,
  emptyDraft,
  stableScenario,
  type AppSuggestion,
  type ScenarioDocument,
} from '../../../shared/scenario-editor'

function initialDocument(session: CodingSession): ScenarioDocument {
  const saved = session.projectReplay?.saved,
    form = saved ? draftFromInput(saved.scenario) : emptyDraft()
  const fresh: ScenarioDocument = {
    form,
    json: JSON.stringify(draftInput(form), null, 2),
    mode: 'guided',
    baseDigest: saved?.digest ?? null,
  }
  try {
    const cached = JSON.parse(
      localStorage.getItem(`parallax-replay-draft-${session.id}`) ?? 'null',
    ) as ScenarioDocument | null
    if (
      cached &&
      ['guided', 'json'].includes(cached.mode) &&
      typeof cached.json === 'string' &&
      (cached.baseDigest === null || typeof cached.baseDigest === 'string')
    ) {
      analyzeDocument(cached)
      return cached
    }
  } catch {
    /* A malformed local draft cannot replace the saved session. */
  }
  return fresh
}

type Actions = ReturnType<typeof useCoding>
export function ProjectReplayPanel({
  session,
  api,
  onVersion,
  onDraftChange,
}: {
  session: CodingSession
  api: Actions
  onVersion: (version: string) => void
  onDraftChange: (dirty: boolean) => void
}) {
  const compact = useCompactWindow()
  const [wideInspector, setWideInspector] = useDeskPreference<boolean>('inspector', true)
  const [compactInspector, setCompactInspector] = useDeskPreference<boolean>(
    'compact-inspector',
    false,
  )
  const inspectorOpen = compact ? compactInspector : wideInspector
  const setInspectorOpen = compact ? setCompactInspector : setWideInspector
  const [inspectorWidth, setInspectorWidth] = useDeskPreference<number>('inspector-width', 300)
  const replay = session.projectReplay,
    saved = replay?.saved
  const [doc, setDoc] = useState(() => initialDocument(session))
  const [saving, setSaving] = useState(false),
    [saveFailure, setSaveFailure] = useState(''),
    [draftStorageError, setDraftStorageError] = useState('')
  const [suggestions, setSuggestions] = useState<AppSuggestion[]>([]),
    [suggestionsError, setSuggestionsError] = useState('')
  const [reviewingProposal, setReviewingProposal] = useState(false)
  const [browserShare, setBrowserShare] = useDeskPreference<number>('replay-browser-share', 55, {
    min: 30,
    max: 70,
  })
  const [version, setVersion] = useState('baseline')
  const [nativeFrame, setNativeFrame] = useState(false)
  const [frameError, setFrameError] = useState('')
  const [dragging, setDragging] = useState('')
  const tracks = useRef<HTMLDivElement>(null)
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
  const autoOpened = useRef(false)
  const ids = saved?.scenario.requests.map((r) => r.id) ?? []
  const order =
    orderDraft && orderDraft.length === ids.length && ids.every((id) => orderDraft.includes(id))
      ? orderDraft
      : (replay?.order ?? [])
  const analyzed = analyzeDocument(doc)
  const conflict = doc.baseDigest !== (saved?.digest ?? null)
  const unsaved =
    conflict ||
    !saved ||
    !analyzed.input ||
    stableScenario(analyzed.input) !== stableScenario(saved.scenario)
  const changedOrder = Boolean(saved && order.join() !== replay?.order.join())
  const [initiallyOpen] = useState(() => !saved || unsaved || conflict)
  useEffect(() => {
    onDraftChange(Boolean(saved && (unsaved || changedOrder)))
  }, [onDraftChange, saved, unsaved, changedOrder])
  function updateDocument(next: ScenarioDocument) {
    setDoc(next)
    try {
      localStorage.setItem(`parallax-replay-draft-${session.id}`, JSON.stringify(next))
      setDraftStorageError('')
    } catch {
      setDraftStorageError(
        'This draft could not be stored on this device. Keep this view open until you can save it to the session.',
      )
    }
  }
  useEffect(() => {
    const abort = new AbortController()
    void fetch(`/api/coding/sessions/${session.id}/replay/suggestions`, { signal: abort.signal })
      .then(async (r) => {
        if (!r.ok)
          throw new Error('Setup detection is unavailable; enter the app command manually.')
        return r.json()
      })
      .then((value) => {
        setSuggestions(value.suggestions ?? [])
        setSuggestionsError('')
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setSuggestionsError(e instanceof Error ? e.message : 'Setup detection failed.')
      })
    return () => abort.abort()
  }, [session.id])
  const lastReplay = replay?.runs.at(-1)
  const startupError =
    lastReplay?.status === 'error' &&
    /app|start|readiness|prepar|approval|port|command/i.test(lastReplay.error ?? '')
      ? lastReplay
      : undefined
  const appApproval =
    session.approval &&
    /^(Prepare this isolated|Start .* from its isolated)/.test(session.approval.detail)
  const hasStartupError = Boolean(startupError)
  useEffect(() => {
    const element = editor.current
    if (!element) return
    if (hasStartupError || conflict) {
      element.open = true
      autoOpened.current = false
    } else if (appApproval && !element.open) {
      element.open = true
      autoOpened.current = true
    } else if (!appApproval && autoOpened.current) {
      element.open = false
      autoOpened.current = false
    }
  }, [appApproval, session.approval?.id, hasStartupError, startupError?.id, conflict, session.busy])
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
  function resetDraft() {
    const form = saved ? draftFromInput(saved.scenario) : emptyDraft()
    updateDocument({
      form,
      json: JSON.stringify(draftInput(form), null, 2),
      mode: 'guided',
      baseDigest: saved?.digest ?? null,
    })
    setSaveFailure('')
  }
  async function save(value: ReplayScenario, run: boolean) {
    setSaveFailure('')
    setSaving(true)
    try {
      const result = await api.saveScenario(value, doc.baseDigest)
      if (result?.projectReplay?.saved) {
        const next = result.projectReplay.saved
        updateDocument({
          form: draftFromInput(next.scenario),
          json: JSON.stringify(next.scenario, null, 2),
          mode: doc.mode,
          baseDigest: next.digest,
        })
        setOrderDraft(null)
        localStorage.removeItem(`parallax-replay-order-${session.id}`)
        if (editor.current) {
          editor.current.open = false
          autoOpened.current = false
        }
        if (run) {
          setVersion('baseline')
          const execution = await api.replayProject(next.scenario.order, 'baseline')
          if (!execution) {
            setSaveFailure('Replay could not start.')
            if (editor.current) editor.current.open = true
            return
          }
        }
        if (editor.current) {
          requestAnimationFrame(() => {
            if (run) document.getElementById(`replay-run-${session.id}`)?.focus()
            else editor.current?.querySelector<HTMLElement>(':scope > summary')?.focus()
          })
        }
      } else setSaveFailure('The scenario was not saved.')
    } catch (problem) {
      setSaveFailure(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setSaving(false)
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
  useEffect(() => {
    const surface = tracks.current
    if (!surface) return
    function revealSelected() {
      if (!surface) return
      const clip = surface.querySelector<HTMLElement>('.project-clip.selected')
      if (!clip) return
      const bounds = surface.getBoundingClientRect(),
        selectedBounds = clip.getBoundingClientRect()
      if (selectedBounds.left < bounds.left + 110)
        surface.scrollLeft -= bounds.left + 110 - selectedBounds.left + 12
      else if (selectedBounds.right > bounds.right)
        surface.scrollLeft += selectedBounds.right - bounds.right + 12
    }
    revealSelected()
    const observer = new ResizeObserver(revealSelected)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [selected, version, run?.id])
  function inspect(key: string, details = false) {
    setSelected(key)
    if (details) setInspectorOpen(true)
  }
  return (
    <section
      className={`project-replay ${saved ? 'has-saved' : ''}`}
      aria-label="Project browser replay"
    >
      <div className="project-replay-heading">
        <div>
          <span className="cut-eyebrow">COMPARE & REPLAY</span>
          <h2 title={saved?.scenario.name}>
            {saved?.scenario.name ?? 'Create a browser scenario'}
          </h2>
          {saved && (
            <small>
              Shared baseline <code>{session.baseline.revision.slice(0, 12)}</code>
            </small>
          )}
        </div>
        {saved && (
          <button
            aria-expanded={inspectorOpen}
            aria-label={inspectorOpen ? 'Hide event detail' : 'Show event detail'}
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            Details
          </button>
        )}
        <button
          aria-label="Refresh evidence"
          disabled={session.busy}
          onClick={() => void api.review()}
        >
          Refresh
        </button>
      </div>
      <details className="replay-editor" open={initiallyOpen} ref={editor}>
        <summary>
          Replay scenario{' '}
          {saved
            ? `r${saved.revision} · ${saved.digest.slice(0, 10)}`
            : '· configure app, actions, requests, and expected UI'}
        </summary>
        <p>
          {!saved
            ? 'Build a replay in five steps. No app command runs until you request a replay and approve it.'
            : unsaved
              ? 'Unsaved scenario changes — evidence is stale until saved and rerun. Draft retained on this device.'
              : `Saved scenario r${saved.revision}. Replaying uses the timeline delivery order; saving a new draft uses its reviewed delivery order.`}
        </p>
        <div className="scenario-agent-actions">
          <button disabled={session.busy} onClick={() => void api.proposeReplay()}>
            Ask agent for scenario
          </button>
          {replay?.proposal && (
            <button
              disabled={session.busy}
              onClick={() => {
                setReviewingProposal(true)
                if (editor.current) editor.current.open = true
              }}
            >
              Review agent proposal
            </button>
          )}
        </div>
        <ScenarioEditor
          document={doc}
          onChange={(next) => {
            updateDocument(next)
            setSaveFailure('')
          }}
          session={session}
          suggestions={suggestions}
          suggestionsError={suggestionsError}
          proposal={replay?.proposal}
          reviewingProposal={reviewingProposal}
          onCloseProposal={() => setReviewingProposal(false)}
          onSave={save}
          onReset={resetDraft}
          conflict={conflict}
          onReviewLatest={() => updateDocument({ ...doc, baseDigest: saved?.digest ?? null })}
          saving={saving}
          saveError={saveFailure ? `${saveFailure} ${api.error}` : ''}
          draftStorageError={draftStorageError}
        />
      </details>
      {saved && (
        <>
          <div className="layout-replay-selector">
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
                        ? 'Approach A'
                        : candidate.id === 'b'
                          ? 'Approach B'
                          : 'Baseline'}
                    </strong>
                    {candidate.id !== 'baseline' && (
                      <small className="desk-version-ai">
                        {session.providerRuns?.filter((r) => r.candidate === candidate.id).at(-1)
                          ?.status === 'completed'
                          ? 'AI turn completed'
                          : session.providerRuns?.filter((r) => r.candidate === candidate.id).at(-1)
                                ?.status === 'running'
                            ? 'AI turn active'
                            : session.providerRuns?.some((r) => r.candidate === candidate.id)
                              ? 'AI turn interrupted'
                              : 'No AI turn recorded'}
                      </small>
                    )}
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
              <button
                id={`replay-run-${session.id}`}
                disabled={session.busy || unsaved}
                onClick={() => {
                  if (editor.current) editor.current.open = false
                  void api.replayProject(order, version)
                }}
              >
                Replay{' '}
                {version === 'baseline'
                  ? 'Baseline'
                  : version === 'a'
                    ? 'Approach A'
                    : 'Approach B'}
              </button>
              <button
                className="cut-primary"
                disabled={session.busy || unsaved}
                onClick={() => {
                  if (editor.current) editor.current.open = false
                  void api.replayProject(order, 'all')
                }}
              >
                Replay all
              </button>
              {session.busy && <button onClick={() => void api.cancel()}>Cancel replay</button>}
            </div>
          </div>
          <div className="layout-replay-feedback">
            {(changedOrder || unsaved) && (
              <p className="replay-feedback" role="status">
                {unsaved
                  ? 'Scenario edited — saved evidence is stale until saved and rerun.'
                  : 'Order edited — recorded outcomes are stale. Press Replay to verify.'}
              </p>
            )}
            {dragging && (
              <p className="desk-drag-feedback" role="status">
                Dragging {saved.scenario.requests.find((r) => r.id === dragging)?.label ?? dragging}
                . Drop on another response to change its delivery position.
              </p>
            )}
          </div>
          <div
            className={`project-evidence-desk ${inspectorOpen ? '' : 'inspector-collapsed'} ${compact ? 'compact-inspector' : ''}`}
            style={
              {
                '--inspector-width': `${inspectorWidth}px`,
                '--browser-weight': `${browserShare}fr`,
                '--timeline-weight': `${100 - browserShare}fr`,
              } as CSSProperties
            }
          >
            <div className="project-browser">
              <div>
                <span>
                  Recorded Chromium state ·{' '}
                  {version === 'baseline' ? 'Baseline' : `Approach ${version.toUpperCase()}`}
                </span>
                {image && (
                  <button aria-pressed={nativeFrame} onClick={() => setNativeFrame(!nativeFrame)}>
                    {nativeFrame ? 'Fit browser frame' : 'Browser at actual size'}
                  </button>
                )}
                {image && (
                  <a
                    href={image}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      if (nativeWindow()) {
                        event.preventDefault()
                        setFrameError('')
                        void openFrame(image).catch((error) =>
                          setFrameError(`Could not open the captured frame: ${String(error)}`),
                        )
                      }
                    }}
                  >
                    Open full frame
                  </a>
                )}
                {frameError && <span role="alert">{frameError}</span>}
              </div>
              <div className={`project-browser-frame ${nativeFrame ? 'frame-native' : ''}`}>
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
            <DeskDivider
              label="Resize browser and timeline"
              value={browserShare}
              min={30}
              max={70}
              orientation="horizontal"
              onChange={setBrowserShare}
            />
            <div className="project-replay-workbench">
              <div className="project-timeline" aria-label="Aligned replay timeline">
                <div className="project-timeline-heading">
                  <div>
                    <strong>Delivery order</strong>
                    <span data-testid="project-order">{order.join(' → ')}</span>
                  </div>
                  <h3>Execution timeline</h3>
                  <span>Corresponding checkpoints stay aligned across versions.</span>
                  <button
                    disabled={!run?.firstUnexpected}
                    onClick={() => {
                      if (run?.firstUnexpected) {
                        inspect(run.firstUnexpected)
                        setInspectorOpen(true)
                      }
                    }}
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
                    <div className="project-tracks" ref={tracks}>
                      <div
                        className="project-track-surface"
                        style={{ minWidth: 110 + columns * 90 }}
                      >
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
                          <div
                            key={track}
                            className="project-track"
                            style={{ minWidth: 110 + columns * 90 }}
                          >
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
                                    className={`project-clip ${event?.key === item.key ? 'selected' : ''} ${item.unexpected ? 'unexpected' : ''} ${dragging === item.requestId && track === 'response' ? 'dragging' : ''} ${event?.requestId && item.requestId === event.requestId ? 'related' : ''}`}
                                    style={{ gridColumn: column(item) }}
                                    draggable={track === 'response' && !session.busy}
                                    onDragStart={(e) => {
                                      setDragging(item.requestId ?? '')
                                      e.dataTransfer.setData(
                                        'text/parallax-project-response',
                                        item.requestId!,
                                      )
                                    }}
                                    onDragEnd={() => setDragging('')}
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
                                      onClick={() => inspect(item.key, true)}
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
                                            move(
                                              item.requestId!,
                                              order.indexOf(item.requestId!) - 1,
                                            )
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
                                            move(
                                              item.requestId!,
                                              order.indexOf(item.requestId!) + 1,
                                            )
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
              {inspectorOpen && (
                <DeskDivider
                  label="Resize event detail pane"
                  value={inspectorWidth}
                  min={240}
                  max={480}
                  reverse
                  onChange={setInspectorWidth}
                />
              )}
              <aside
                className="project-event-inspector"
                aria-label="Replay checkpoint inspector"
                hidden={!inspectorOpen}
              >
                <button className="inspector-close" onClick={() => setInspectorOpen(false)}>
                  Close event detail
                </button>
                <h3>{event?.label ?? 'Select a checkpoint'}</h3>
                <p className="replay-comparison" aria-label="Comparison conclusion">
                  {comparison}
                </p>
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
                <details className="project-relevant-diff">
                  <summary>
                    {version === 'baseline'
                      ? 'Baseline has no candidate patch'
                      : `Relevant diff · Approach ${version.toUpperCase()}`}
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
              </aside>
            </div>
          </div>
          <div className="layout-replay-footer">
            {run && (
              <details
                className={`project-run-result ${isStale ? 'stale' : run.status}`}
                role="status"
              >
                <summary title={run.error ?? saved.scenario.expected.description}>
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
                  {comparison.startsWith('Tie') && <span> · Fixes tied</span>}
                </summary>
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
              </details>
            )}
            <details
              className="layout-replay-tools"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button,a')) {
                  e.currentTarget.open = false
                  e.currentTarget.querySelector('summary')?.focus()
                }
              }}
            >
              <summary>Compare & export</summary>
              <div>
                <div className="project-compare-actions">
                  <h3>Compare approaches</h3>{' '}
                  <button
                    disabled={
                      session.busy ||
                      unsaved ||
                      !replay?.runs.some(
                        (r) =>
                          r.version === 'baseline' &&
                          (r.status === 'passed' || r.status === 'failed'),
                      )
                    }
                    onClick={() => void api.generateFixes()}
                  >
                    Generate two fixes
                  </button>
                  <button
                    disabled={session.busy || !saved || unsaved}
                    onClick={() => void api.generateFixes(true)}
                  >
                    Generate Candidate A first
                  </button>
                </div>
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
                    Standalone test includes the fixtures, fixed actions, strict coverage check, and
                    run instructions.
                  </span>
                </div>
              </div>
            </details>
          </div>
        </>
      )}
    </section>
  )
}
