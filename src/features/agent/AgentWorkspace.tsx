import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clapperboard,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  Layers2,
  Loader2,
  MessageSquare,
  Network,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  X,
  XCircle,
} from 'lucide-react'
import { Logo } from '../../components/ui'
import {
  SAMPLE_TASK,
  type Investigation,
  type ReplayResult,
  type RunnerConfig,
  type Schedule,
  type ToolEvent,
  type TraceEvent,
  type VersionId,
} from '../../../shared/investigation'
import { useInvestigation } from './useInvestigation'
import { Timeline } from './Timeline'
import './studio.css'

const names: Record<VersionId, string> = {
  baseline: 'Baseline',
  a: 'Candidate A',
  b: 'Candidate B',
}
const eventIcons = {
  user: MessageSquare,
  agent: Activity,
  read: FileCode2,
  command: Terminal,
  worktree: GitBranch,
  patch: Code2,
  check: ShieldCheck,
  error: XCircle,
}
function StatePill({ run }: { run?: ReplayResult }) {
  return (
    <span className={`cut-result ${run?.status ?? 'pending'}`}>
      {run?.status === 'passed' ? (
        <Check size={11} />
      ) : run?.status === 'failed' ? (
        <XCircle size={11} />
      ) : run?.status === 'error' ? (
        <X size={11} />
      ) : (
        <Circle size={10} />
      )}{' '}
      {run
        ? run.status === 'passed'
          ? 'PASS'
          : run.status === 'failed'
            ? 'FAIL'
            : 'ERROR'
        : 'NOT RUN'}
    </span>
  )
}
function ToolLine({ event }: { event: ToolEvent }) {
  const Icon = eventIcons[event.kind]
  return (
    <div className={`cut-tool-line cut-tool-${event.kind}`}>
      <span className="cut-tool-icon">
        <Icon size={13} />
      </span>
      <div>
        {event.kind === 'user' ? (
          <p>{event.title}</p>
        ) : (
          <details>
            <summary>
              {event.title}
              <ChevronDown size={11} />
            </summary>
            {event.detail && <pre>{event.detail}</pre>}
          </details>
        )}
        <small>
          {new Date(event.at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}{' '}
          <b>·</b> {event.kind === 'user' ? 'YOU' : event.kind.toUpperCase()}
        </small>
        {event.kind === 'user' && event.detail && (
          <span className="cut-user-note">{event.detail}</span>
        )}
      </div>
    </div>
  )
}

function Composer({
  config,
  docked,
  onSubmit,
  busy,
}: {
  config: RunnerConfig | null
  docked?: boolean
  onSubmit: (task: string, mode: 'sample' | 'live') => Promise<unknown>
  busy?: boolean
}) {
  const [task, setTask] = useState('')
  const [mode, setMode] = useState<'sample' | 'live'>('sample')
  const [sending, setSending] = useState(false)
  async function submit() {
    if (!task.trim() || sending) return
    setSending(true)
    try {
      const result = await onSubmit(task, mode)
      if (result && docked) setTask('')
    } finally {
      setSending(false)
    }
  }
  return (
    <form
      className={`cut-composer ${docked ? 'docked' : ''}`}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <textarea
        aria-label={docked ? 'Steer this investigation' : 'Coding task'}
        value={task}
        onChange={(event) => setTask(event.target.value)}
        placeholder={
          docked ? 'Steer this investigation…' : 'What should we investigate in your repository?'
        }
        rows={docked ? 3 : 4}
        maxLength={docked ? 4000 : 8000}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      {!docked && (
        <div className="cut-composer-repo">
          <FolderGit2 size={14} />
          <select aria-label="Repository" value="current" onChange={() => {}}>
            <option value="current">{config?.repo.name ?? 'Connecting to repository…'}</option>
          </select>
          <ChevronDown size={12} />
          <span className="cut-repo-dirty">
            {config ? (config.repo.dirty ? 'working copy' : 'clean checkout') : 'connecting'}
          </span>
        </div>
      )}
      <div className="cut-composer-actions">
        {docked ? (
          <span>
            <span className="cut-live-dot" />
            {busy ? 'Notes join the active session' : 'Review, steer, or change the order'}
          </span>
        ) : (
          <label>
            <span className="cut-mode-dot" />
            <select
              aria-label="Agent mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as 'sample' | 'live')}
            >
              <option value="sample">Bundled sample · real execution</option>
              <option value="live" disabled={!config?.live.configured}>
                Live agent · {config?.live.configured ? config.live.model : 'not configured'}
              </option>
            </select>
            <ChevronDown size={11} />
          </label>
        )}
        <button type="submit" className="cut-primary" disabled={!task.trim() || !config || sending}>
          {sending ? (
            <Loader2 size={14} className="cut-spin" />
          ) : docked ? (
            <Send size={13} />
          ) : (
            <Play size={13} />
          )}
          <span>{docked ? 'Send' : 'Start investigation'}</span>
        </button>
      </div>
      {!docked && (
        <div className="cut-composer-caption">
          <ShieldCheck size={11} />
          Candidates run in detached Git worktrees. Your checkout stays in place.
        </div>
      )}
      {!docked && (
        <button
          type="button"
          className="cut-use-sample"
          onClick={() => {
            setTask(SAMPLE_TASK)
            setMode('sample')
          }}
        >
          <span>TRY A RUNNABLE TASK</span>Fix the pickup-search race
          <ArrowRight size={13} />
        </button>
      )}
    </form>
  )
}

function EventInspector({ event, run }: { event?: TraceEvent; run: ReplayResult }) {
  const response =
    event?.kind === 'response' ? event : run.events.find((item) => item.id === event?.causedBy)
  const state =
    event?.kind === 'state' ? event : run.events.find((item) => item.causedBy === event?.id)
  return (
    <aside className="cut-event-inspector" aria-label="Selected event evidence">
      <div className="cut-inspector-label">
        <span className="cut-eyebrow">EVENT EVIDENCE</span>
        <span>{event?.atMs ?? 0} ms</span>
      </div>
      <h3>{event?.label ?? 'Select an event'}</h3>
      <dl>
        <dt>REQUEST</dt>
        <dd>
          <code>GET /api/places?q={response?.query ?? event?.query}</code>
        </dd>
        <dt>RESPONSE PAYLOAD</dt>
        <dd>
          {response?.payload ? (
            <pre>{JSON.stringify({ items: response.payload }, null, 2)}</pre>
          ) : (
            <p className="cut-muted">User action. No response delivered at this event.</p>
          )}
        </dd>
        <dt>OBSERVED UI</dt>
        <dd>
          {state ? (
            <>
              <span className="cut-observed">
                <i />
                {state.changed ? 'DOM changed after delivery' : 'DOM retained after delivery'}
              </span>
              <ul>
                {state.items?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="cut-evidence-note">
                Active input: “{state.query}” · observed after the response JSON was handled and
                React had two animation frames to commit.
              </p>
            </>
          ) : (
            <p className="cut-muted">The input changed; both responses were still gated.</p>
          )}
        </dd>
      </dl>
      {state && (
        <div className="cut-causal-note">
          <Network size={12} />
          Observed after response {state.requestId}; not inferred by a model.
        </div>
      )}
    </aside>
  )
}

function DiffDrawer({
  session,
  version,
  onClose,
  onChoose,
}: {
  session: Investigation
  version: VersionId
  onClose: () => void
  onChoose: (version: VersionId) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  const candidate = session.candidates.find((item) => item.id === version)
  return (
    <dialog
      className="cut-diff-dialog"
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      aria-label="Candidate patch drawer"
    >
      <header>
        <div>
          <span className="cut-eyebrow">PATCH REVIEW</span>
          <h2>Choose an implementation.</h2>
        </div>
        <button aria-label="Close patch drawer" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <div className="cut-diff-version">
        {session.candidates
          .filter((item) => item.id !== 'baseline')
          .map((item) => (
            <button
              key={item.id}
              onClick={() => onChoose(item.id)}
              className={version === item.id ? 'selected' : ''}
            >
              {item.name}
              <small>{item.strategy}</small>
            </button>
          ))}
      </div>
      <div className="cut-diff-provenance">
        <GitBranch size={13} />
        <span>
          {candidate?.patchOrigin === 'prewritten'
            ? 'Prewritten patch · executed and verified by the runner'
            : 'Model proposal · review recorded checks'}
        </span>
      </div>
      <div className="cut-diff-file">
        <FileCode2 size={13} />
        <code>fixtures/pickup-search/src/useAddressSearch.ts</code>
      </div>
      <pre className="cut-diff-code">
        {candidate?.patch
          ? candidate.patch.split('\n').map((line, index) => (
              <span
                key={index}
                className={
                  line.startsWith('+')
                    ? 'added'
                    : line.startsWith('-')
                      ? 'removed'
                      : line.startsWith('@@')
                        ? 'hunk'
                        : ''
                }
              >
                {line || ' '}
                {'\n'}
              </span>
            ))
          : 'The candidate patch is not available yet.'}
      </pre>
      <footer>
        <span>
          <ShieldCheck size={13} />
          Compared against the captured working copy. No files applied.
        </span>
        {candidate?.patch && (
          <a href={`/api/sessions/${session.id}/patch/${version}`} download className="cut-primary">
            <Download size={13} />
            Export this patch
          </a>
        )}
      </footer>
    </dialog>
  )
}

export default function AgentWorkspace() {
  const api = useInvestigation()
  const [version, setVersion] = useState<VersionId>('baseline')
  const [order, setOrder] = useState<Schedule>(() =>
    localStorage.getItem('parallax-order') === 'A,B' ? ['A', 'B'] : ['B', 'A'],
  )
  function setDeliveryOrder(next: Schedule) {
    localStorage.setItem('parallax-order', next.join(','))
    setOrder(next)
  }
  const [selected, setSelected] = useState('state-A')
  const [diff, setDiff] = useState(false)
  const [configuration, setConfiguration] = useState(false)
  const [copied, setCopied] = useState(false)
  const logEnd = useRef<HTMLDivElement>(null)
  const session = api.session
  const run = session?.runs
    .filter((item) => item.version === version && item.schedule.join() === order.join())
    .at(-1)
  const lastRun = session?.runs.filter((item) => item.version === version).at(-1)
  const displayed = run ?? lastRun
  const selectedEvent =
    displayed?.events.find((event) => event.id === selected) ?? displayed?.events.at(-1)
  const image =
    selectedEvent?.screenshot ??
    displayed?.events.find((event) => event.id === selectedEvent?.causedBy)?.screenshot ??
    displayed?.events.find((event) => event.causedBy === selectedEvent?.id)?.screenshot ??
    displayed?.events.at(-1)?.screenshot
  const select = useCallback((id: string) => setSelected(id), [])
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [session?.events.length])
  const currentRuns =
    session?.candidates.map((candidate) =>
      session.runs
        .filter((item) => item.version === candidate.id && item.schedule.join() === order.join())
        .at(-1),
    ) ?? []
  const readyToReplay =
    Boolean(session?.candidates.every((candidate) => candidate.ready)) && !session?.busy
  const scheduleChanged = Boolean(session && order.join() !== session.selectedSchedule.join())
  async function copyOrder() {
    await navigator.clipboard.writeText(JSON.stringify(order))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  async function start(task: string, mode: 'sample' | 'live') {
    const state = await api.start(task, mode)
    if (state) {
      setDeliveryOrder(['B', 'A'])
      setVersion('baseline')
      setSelected('state-A')
    }
    return state
  }
  return (
    <div className="studio">
      <header className="cut-topbar">
        <a className="cut-brand" href="/" aria-label="PARALLAX agent workspace">
          <Logo small />
          <strong>
            PARALLAX<span>AI</span>
          </strong>
        </a>
        <span className="cut-topbar-separator" />
        <div className="cut-project">
          <FolderGit2 size={13} />
          <span>{api.config?.repo.name ?? 'Local repository'}</span>
          <ChevronRight size={11} />
          <span>{session ? 'Investigation' : 'Agent workspace'}</span>
        </div>
        <div className="cut-topbar-right">
          <span className="cut-runner-state">
            <i className={api.config ? 'online' : ''} />
            {api.config
              ? 'Runner connected'
              : api.error
                ? 'Runner offline'
                : 'Connecting to runner'}
          </span>
          <button aria-label="Runner configuration" onClick={() => setConfiguration(true)}>
            <Settings2 size={15} />
          </button>
        </div>
      </header>
      <div className="cut-body">
        <nav className="cut-rail" aria-label="Workspace tools">
          <button
            aria-label="New investigation"
            title="New investigation"
            disabled={session?.busy}
            onClick={api.newSession}
          >
            <Plus size={18} />
          </button>
          <button className="active" aria-label="Agent session">
            <MessageSquare size={17} />
          </button>
          <button
            aria-label="Review candidate patches"
            title="Review candidate patches"
            disabled={!session?.candidates.some((candidate) => candidate.patch)}
            onClick={() => {
              if (version === 'baseline') setVersion('a')
              setDiff(true)
            }}
          >
            <Code2 size={18} />
          </button>
          <div />
          <a href="/legacy" title="Phase 1 design archive" aria-label="Phase 1 design archive">
            <Layers2 size={16} />
          </a>
          <button aria-label="Provider configuration" onClick={() => setConfiguration(true)}>
            <Radio size={16} />
          </button>
        </nav>
        <main className={`cut-main ${session ? 'has-session' : ''}`}>
          {api.error && (
            <div className="cut-error" role="alert">
              <XCircle size={15} />
              <span>{api.error}</span>
              <button aria-label="Dismiss error" onClick={api.clearError}>
                <X size={13} />
              </button>
            </div>
          )}
          {!session ? (
            <div className="cut-welcome">
              <div className="cut-welcome-coordinate">
                PARALLAX / AGENT WORKSPACE <span>01</span>
              </div>
              <div className="cut-welcome-mark">
                <Clapperboard size={23} />
              </div>
              <span className="cut-eyebrow">REPRODUCE. REORDER. RESOLVE.</span>
              <h1>
                Find the frame
                <br />
                where it goes wrong<span>.</span>
              </h1>
              <p>
                A coding session with an editable timeline.
                <br />
                Give the agent a task. Keep the experiment in your hands.
              </p>
              <Composer config={api.config} onSubmit={start} />
              <div className="cut-welcome-foot">
                <span>
                  <GitBranch size={13} />
                  Isolated candidate worktrees
                </span>
                <i />
                <span>
                  <Play size={12} />
                  Real browser evidence
                </span>
                <i />
                <span>
                  <Code2 size={13} />
                  Reviewable patches
                </span>
              </div>
              <div className="cut-live-config">
                <span className="cut-mode-dot" />
                {api.config?.live.configured
                  ? `Live agent configured · ${api.config.live.model}`
                  : 'Sample runs without an API key. Live agent is not configured.'}
                <button onClick={() => setConfiguration(true)}>
                  Runner setup
                  <ExternalLink size={10} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <aside className="cut-conversation">
                <header>
                  <div>
                    <span className="cut-eyebrow">AGENT SESSION</span>
                    <h2>Pickup search investigation</h2>
                  </div>
                  <span className={`cut-session-indicator ${session.busy ? 'running' : ''}`} />
                </header>
                <div className="cut-session-mode">
                  <span>{session.mode === 'sample' ? 'BUNDLED RECIPE' : 'LIVE AGENT'}</span>
                  <p>
                    {session.mode === 'sample'
                      ? 'Prewritten fixes. Real worktrees, tests, and browser runs.'
                      : 'Model-generated changes. Runner-controlled checks.'}
                  </p>
                </div>
                <div className="cut-tool-stream" aria-label="Actual agent activity">
                  {session.events.map((event) => (
                    <ToolLine key={event.id} event={event} />
                  ))}
                  <div ref={logEnd} />
                </div>
                <div className="cut-agent-status" role="status">
                  {session.busy ? (
                    <Loader2 size={12} className="cut-spin" />
                  ) : session.status === 'error' ? (
                    <XCircle size={12} />
                  ) : (
                    <Check size={12} />
                  )}
                  <span>{api.connecting ? 'Reconnecting to runner…' : session.activity}</span>
                  {session.busy && (
                    <button onClick={() => void api.cancel()} aria-label="Cancel active run">
                      <Square size={9} />
                      Cancel
                    </button>
                  )}
                </div>
                <Composer
                  config={api.config}
                  docked
                  busy={session.busy}
                  onSubmit={(message) => api.steer(message)}
                />
              </aside>
              <section className="cut-editor">
                <div className="cut-editor-heading">
                  <div>
                    <span className="cut-eyebrow">THE EXPERIMENT</span>
                    <h1>
                      Out-of-order, in plain sight<span>.</span>
                    </h1>
                  </div>
                  <div className="cut-editor-heading-actions">
                    <span className="cut-evidence-tag">
                      <i />
                      REAL EXECUTION
                    </span>
                    <button
                      disabled={!session.candidates.some((candidate) => candidate.patch)}
                      onClick={() => {
                        if (version === 'baseline') setVersion('a')
                        setDiff(true)
                      }}
                    >
                      <Code2 size={13} />
                      Review patch
                    </button>
                  </div>
                </div>
                <div className="cut-version-bar" role="tablist" aria-label="Implementation version">
                  {session.candidates.map((candidate, index) => (
                    <button
                      role="tab"
                      key={candidate.id}
                      aria-selected={version === candidate.id}
                      className={version === candidate.id ? 'active' : ''}
                      onClick={() => setVersion(candidate.id)}
                    >
                      <span className="cut-version-letter">
                        {candidate.id === 'baseline' ? (
                          <GitBranch size={12} />
                        ) : (
                          candidate.id.toUpperCase()
                        )}
                      </span>
                      <span>
                        {candidate.name}
                        <small>{candidate.strategy}</small>
                      </span>
                      <StatePill run={currentRuns[index]} />
                    </button>
                  ))}
                </div>
                <div className="cut-browser">
                  <div className="cut-browser-toolbar">
                    <span className="cut-browser-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      <ShieldCheck size={11} />
                      pickup-search <b>/</b> recorded Chromium frame
                    </span>
                    <span className="cut-browser-resolution">900 × 610</span>
                    {image && (
                      <a
                        href={image}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open full browser capture"
                        title="Open full browser capture"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                  <div className="cut-browser-stage">
                    {displayed && image ? (
                      <img
                        src={image}
                        alt={`Actual browser capture: ${selectedEvent?.label ?? 'final suggestions'}`}
                        draggable={false}
                      />
                    ) : (
                      <div className="cut-no-frame">
                        <Clapperboard size={32} />
                        <h3>
                          {session.status === 'error'
                            ? 'The run needs attention'
                            : 'Waiting for the first browser capture'}
                        </h3>
                        <p>
                          {session.status === 'error'
                            ? session.error
                            : 'The runner is preparing the baseline worktree and executable checks.'}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="cut-browser-caption">
                    <span>
                      <span className="cut-frame-dot" />
                      {displayed
                        ? `${names[displayed.version]} · ${selectedEvent?.label ?? 'Recorded frame'} · ${selectedEvent?.atMs ?? 0} ms`
                        : 'No simulated preview. Frames appear after real browser execution.'}
                    </span>
                    {displayed && <StatePill run={displayed} />}
                  </div>
                </div>
                <div className="cut-replay-actions">
                  <div>
                    <span className="cut-eyebrow">DELIVERY ORDER</span>
                    <span className="cut-order-pill">
                      {order[0]}
                      <ArrowRight size={11} />
                      {order[1]}
                    </span>
                    <button
                      className="cut-order-swap"
                      aria-label="Swap response order"
                      disabled={!readyToReplay}
                      onClick={() => setDeliveryOrder([order[1], order[0]])}
                    >
                      <RotateCcw size={12} />
                    </button>
                    <span className="cut-schedule-note">
                      {scheduleChanged
                        ? 'Edited · replay to save'
                        : session.busy
                          ? 'Runner executing shared checks'
                          : 'Saved schedule · actions & payloads fixed'}
                    </span>
                  </div>
                  <div>
                    <button aria-label="Copy response order" onClick={() => void copyOrder()}>
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    <button
                      className="cut-primary"
                      disabled={!readyToReplay}
                      onClick={() => void api.replay(order)}
                    >
                      {session.busy ? (
                        <Loader2 size={13} className="cut-spin" />
                      ) : (
                        <Play size={12} />
                      )}
                      Replay all versions
                    </button>
                  </div>
                </div>
                {displayed ? (
                  <div className="cut-evidence-workbench">
                    <div className="cut-timeline-column">
                      <Timeline
                        run={displayed}
                        order={order}
                        selected={selectedEvent?.id ?? selected}
                        onSelect={select}
                        onReorder={setDeliveryOrder}
                        busy={!readyToReplay}
                      />
                      <div className={`cut-assertion ${displayed.status}`}>
                        <span className="cut-assertion-icon">
                          {displayed.status === 'passed' ? (
                            <Check size={15} />
                          ) : (
                            <XCircle size={15} />
                          )}
                        </span>
                        <div>
                          <strong>
                            {displayed.status === 'passed'
                              ? 'Latest query preserved'
                              : displayed.status === 'failed'
                                ? 'Stale response overwrote the latest query'
                                : 'Schedule execution error'}
                          </strong>
                          <p>
                            {displayed.status === 'error'
                              ? displayed.error
                              : 'After both responses are handled, the visible suggestions must belong to “Colombo”.'}
                          </p>
                        </div>
                        <details>
                          <summary>
                            Actual output
                            <ChevronDown size={11} />
                          </summary>
                          <pre>{displayed.output}</pre>
                        </details>
                      </div>
                    </div>
                    <EventInspector event={selectedEvent} run={displayed} />
                  </div>
                ) : (
                  <div className="cut-timeline-pending">
                    <div>
                      <MousePointer2Icon />
                      User actions
                    </div>
                    <div>
                      <Network size={14} />
                      Network responses
                    </div>
                    <div>
                      <Activity size={14} />
                      UI state
                    </div>
                    <span>{session.activity}</span>
                  </div>
                )}
                <footer className="cut-editor-footer">
                  <span>
                    <GitBranch size={12} />
                    {session.revision
                      ? `${session.revision.slice(0, 8)} + snapshot ${session.snapshot.slice(0, 8)}`
                      : 'Capturing revision…'}
                    {session.dirty && <b>includes uncommitted work</b>}
                  </span>
                  <a
                    className={!readyToReplay ? 'disabled' : ''}
                    aria-disabled={!readyToReplay}
                    href={
                      readyToReplay
                        ? `/api/sessions/${session.id}/regression?order=${order.join(',')}`
                        : undefined
                    }
                    download
                  >
                    <Download size={12} />
                    Save regression test
                  </a>
                </footer>
              </section>
            </>
          )}
        </main>
      </div>
      <footer className="cut-statusbar">
        <span>
          <span className="cut-live-dot" />
          LOCAL EXECUTION <b>/</b>
          {session
            ? `${session.runs.length} browser runs · ${session.checks.length} executable checks`
            : 'Ready for an investigation'}
        </span>
        <span>
          {session
            ? 'Active checkout preserved'
            : api.config
              ? `HEAD ${api.config.repo.revision.slice(0, 8)} · ${api.config.repo.dirty ? 'uncommitted changes will be snapshotted' : 'clean checkout'}`
              : 'Connecting to local runner'}
          <span className="cut-status-coordinate">PARALLAX / 02</span>
        </span>
      </footer>
      {session && diff && (
        <DiffDrawer
          session={session}
          version={version === 'baseline' ? 'a' : version}
          onChoose={setVersion}
          onClose={() => setDiff(false)}
        />
      )}{' '}
      {configuration && (
        <div className="cut-config-backdrop">
          <section
            className="cut-config-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Runner configuration"
          >
            <button
              className="cut-config-close"
              aria-label="Close configuration"
              onClick={() => setConfiguration(false)}
            >
              <X size={18} />
            </button>
            <Radio size={24} />
            <span className="cut-eyebrow">LOCAL RUNNER</span>
            <h2>
              One workflow.
              <br />
              Two ways to investigate.
            </h2>
            <div>
              <strong>Bundled sample · available</strong>
              <p>
                Two clearly labeled prewritten fixes. Detached Git worktrees, Playwright release
                gates, test output, patches, and browser captures execute for real.
              </p>
            </div>
            <div>
              <strong>
                Live agent · {api.config?.live.configured ? 'configured' : 'not configured'}
              </strong>
              <p>
                Set these variables in the runner’s environment or ignored <code>.env</code> file,
                then restart <code>npm run dev</code>. The model can inspect source, update each
                candidate hook, invoke shared checks, and review its diff.
              </p>
              <pre>OPENAI_API_KEY=…{'\n'}PARALLAX_MODEL=your-model-id</pre>
              <p>
                Credentials stay in the runner. This first slice supports the pickup-search fixture;
                arbitrary application harnesses are not yet supported.
              </p>
            </div>
            <button className="cut-primary" onClick={() => setConfiguration(false)}>
              Back to workspace
              <ArrowRight size={13} />
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

function MousePointer2Icon() {
  return <Send size={14} />
}
