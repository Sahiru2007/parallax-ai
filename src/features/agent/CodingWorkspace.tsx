import { useState, type CSSProperties } from 'react'
import {
  ArrowUpRight,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  GitBranch,
  FolderGit2,
  SlidersHorizontal,
  Terminal,
  MessageSquare,
} from 'lucide-react'
import { DeskDivider } from './DeskLayout'
import { CommandOutput } from './CommandOutput'
import { useDeskPreference } from './desk-preferences'
import { useCoding } from './useCoding'
import { ProjectReplayPanel } from './ProjectReplayPanel'
import { ProviderSettingsPanel } from './ProviderSettingsPanel'
import { CandidateRecovery } from './CandidateRecovery'
import { providerName, type ProviderId } from '../../../shared/providers'
import './studio.css'
import './coding.css'
import './desk.css'
import './desktop-layout.css'

export default function CodingWorkspace() {
  const api = useCoding()
  const [railOpen, setRailOpen] = useDeskPreference<boolean>('rail', true)
  const [conversationOpen, setConversationOpen] = useDeskPreference<boolean>('conversation', true)
  const [conversationWidth, setConversationWidth] = useDeskPreference<number>(
    'conversation-width',
    380,
  )
  const [codeWidth, setCodeWidth] = useDeskPreference<number>('code-width', 520)
  const [views, setViews] = useState<Record<string, 'code' | 'replay'>>(() => {
    try {
      return JSON.parse(localStorage.getItem('parallax-workspace-views') ?? '{}') ?? {}
    } catch {
      return {}
    }
  })
  const [reviewTab, setReviewTab] = useState<'changes' | 'commands'>('changes')
  const [path, setPath] = useState<string | null>(localStorage.getItem('parallax-repo-path'))
  const [task, setTask] = useState(() => localStorage.getItem('parallax-task-draft') ?? '')
  const [followups, setFollowups] = useState<Record<string, string>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('parallax-followup-drafts') ?? '{}')
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch {
      return {}
    }
  })
  const [compare, setCompare] = useState(false)
  const [sequential, setSequential] = useState(false)
  const [investigate, setInvestigate] = useState(false)
  const [showReplay, setShowReplay] = useState(false)
  const [activityTab, setActivityTab] = useState<'activity' | 'commands'>('activity')
  const [providerChoice, setProvider] = useState<'live' | 'test' | null>(null)
  const [manage, setManage] = useState<ProviderId | null>(null)
  const [modelError, setModelError] = useState('')
  const settings = api.config?.providers
  const selection = settings?.selection
  const provider =
    providerChoice ??
    (api.config?.testProvider && !selection && !api.config.live.configured ? 'test' : 'live')
  const [candidateId, setCandidate] = useState('a')
  const [replayDraftSession, setReplayDraftSession] = useState('')
  const [file, setFile] = useState('')
  const [targetChoice, setTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [openingRepo, setOpeningRepo] = useState(false)
  const session = api.session
  const workspaceMode =
    session && ['code', 'replay'].includes(views[session.id])
      ? views[session.id]
      : session?.investigation || session?.projectReplay
        ? 'replay'
        : 'code'
  const activeWidth = workspaceMode === 'code' ? codeWidth : conversationWidth
  const setActiveWidth = workspaceMode === 'code' ? setCodeWidth : setConversationWidth
  function selectWorkspaceMode(mode: 'code' | 'replay') {
    if (!session) return
    if (mode === 'replay') setShowReplay(true)
    const next = { ...views, [session.id]: mode }
    setViews(next)
    try {
      localStorage.setItem('parallax-workspace-views', JSON.stringify(next))
    } catch {
      /* The current view still works. */
    }
  }
  const followup = session && typeof followups[session.id] === 'string' ? followups[session.id] : ''
  function setFollowup(value: string, onlyIf?: string) {
    if (!session) return
    const id = session.id
    setFollowups((current) => {
      if (onlyIf !== undefined && current[id] !== onlyIf) return current
      const next = { ...current, [id]: value }
      try {
        localStorage.setItem('parallax-followup-drafts', JSON.stringify(next))
      } catch {
        /* Keep the entered instruction in memory. */
      }
      return next
    })
  }
  const originalTask = session?.messages[0]?.content ?? 'Coding session'
  const taskWords = originalTask.trim().split(/\s+/)
  const shortTask = taskWords.slice(0, 9).join(' ') + (taskWords.length > 9 ? '…' : '')
  const candidate = session?.candidates.find((c) => c.id === candidateId) ?? session?.candidates[0]
  const selectedRun = session?.providerRuns?.filter((r) => r.candidate === candidate?.id).at(-1)
  const recoveryNeeded = Boolean(
    (selectedRun && selectedRun.status !== 'completed' && selectedRun.status !== 'running') ||
    selectedRun?.recovery ||
    session?.generation?.queued.length,
  )
  const selectedFile =
    candidate?.files.find((change) => change.path === file) ?? candidate?.files[0]
  const target = targetChoice ?? api.repo?.path ?? ''
  const repoPath = path ?? api.repo?.path ?? ''
  async function start() {
    setSending(true)
    try {
      await api.start(task, provider, compare, investigate, sequential)
    } finally {
      setSending(false)
    }
  }
  async function continueSession() {
    setSending(true)
    try {
      if (await api.followup(followup)) {
        setFollowup('', followup)
      }
    } finally {
      setSending(false)
    }
  }
  return (
    <div
      className={`cut-workspace coding-workspace precision-desk ${session ? 'is-session' : ''} ${railOpen ? 'rail-open' : 'rail-closed'}`}
      style={{ '--conversation-width': `${activeWidth}px` } as CSSProperties}
    >
      <a className="desk-skip" href="#desk-main">
        Skip to workspace
      </a>
      <header className="cut-topbar coding-topbar">
        <button
          className="desk-icon"
          aria-label={railOpen ? 'Collapse session rail' : 'Expand session rail'}
          aria-expanded={railOpen}
          onClick={() => setRailOpen(!railOpen)}
        >
          {railOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
        <a href="/" className="coding-logo" aria-label="Parallax workspace">
          <span className="desk-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <strong>
            PARALLAX<span>AI</span>
          </strong>
        </a>
        <span className="desk-top-context">
          <GitBranch size={13} /> {session?.repo.name ?? api.repo?.name ?? 'No repository'}{' '}
          <span>/ {session?.repo.branch ?? api.repo?.branch ?? 'local'}</span>
        </span>
        <span role="status" className={`coding-connection ${api.connecting ? 'offline' : ''}`}>
          {api.connecting
            ? 'Reconnecting to runner…'
            : api.config
              ? 'Runner connected'
              : 'Runner unavailable'}
        </span>
        <button
          className="desk-settings"
          disabled={!api.config || api.connecting}
          onClick={() => setManage(selection?.provider ?? 'gemini')}
        >
          <SlidersHorizontal size={14} /> Manage providers
        </button>
      </header>
      {api.error && (
        <div className="cut-error" role="alert">
          {api.error}
        </div>
      )}
      <div className="desk-shell">
        <nav className="desk-session-rail" aria-label="Session rail" hidden={!railOpen}>
          <div className="desk-rail-heading">
            <span className="desk-kicker">WORKSPACE</span>
            <span className="desk-edition">01 / LOCAL</span>
          </div>
          <button
            className="desk-new"
            aria-label="New coding session"
            disabled={session?.busy}
            onClick={api.newSession}
          >
            <Plus size={15} /> New session
          </button>
          <div className="desk-rail-project">
            <FolderGit2 size={16} />
            <strong>{session?.repo.name ?? api.repo?.name ?? 'Choose a repository'}</strong>
            <span title={session?.repo.path ?? api.repo?.path}>
              <GitBranch size={12} />
              {session?.repo.branch ?? api.repo?.branch ?? 'local checkout'}
            </span>
            <code title={session?.baseline.revision ?? api.repo?.revision}>
              {(session?.baseline.revision ?? api.repo?.revision)?.slice(0, 12) ??
                'No baseline yet'}
            </code>
          </div>
          <div className="desk-rail-heading">
            <span className="desk-kicker">RECENT SESSIONS</span>
            <span>{api.history.length.toString().padStart(2, '0')}</span>
          </div>
          <div className="desk-session-list">
            {api.history.map((item) => (
              <button
                key={item.id}
                disabled={session?.busy}
                aria-current={session?.id === item.id ? 'page' : undefined}
                onClick={() => void api.open(item.id)}
                title={item.messages[0]?.content}
              >
                <span className="desk-session-repo">
                  <FolderGit2 size={13} />
                  {item.repo.name}
                </span>
                <strong>{item.messages[0]?.content || 'Untitled task'}</strong>
                <span
                  className={`desk-session-state state-${item.id === session?.id ? session.status : item.status}`}
                >
                  {item.id === session?.id ? session.status : item.status}
                  {item.investigation ? ' · investigation' : ' · coding'}
                </span>
              </button>
            ))}
            {!api.history.length && (
              <p className="desk-rail-empty">
                Your work starts here.
                <br />
                Sessions stay on this machine, ready to reopen.
              </p>
            )}
          </div>
          <label className="desk-session-select">
            Reopen session
            <select
              aria-label="Saved coding sessions"
              value={session?.id ?? ''}
              onChange={(e) => {
                if (e.target.value) void api.open(e.target.value)
              }}
              disabled={session?.busy}
            >
              <option value="">Choose a saved session…</option>
              {api.history.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.repo.name} · {item.messages[0]?.content.slice(0, 65)} · {item.status}
                </option>
              ))}
            </select>
          </label>
          <div className="desk-rail-footer">
            <button
              disabled={!api.config || api.connecting}
              onClick={() => setManage(selection?.provider ?? 'gemini')}
            >
              <SlidersHorizontal size={14} /> Provider settings
            </button>
            <a href="/pickup">
              Pickup investigation <ArrowUpRight size={13} />
            </a>
            <a href="/legacy">
              Design archive <ArrowUpRight size={13} />
            </a>
            <span>LOCAL WORKTREES / REVIEWABLE EVIDENCE</span>
          </div>
        </nav>
        <div className="desk-work-area" id="desk-main" tabIndex={-1}>
          {!session ? (
            <main className="coding-entry">
              <div className="desk-entry-index">
                <span className="desk-kicker">YOUR LOCAL CODING DESK</span>
                <span>EDIT / VERIFY / REPLAY</span>
              </div>
              <h1>Start a coding session</h1>
              <p>A task in your words. Changes you can inspect. Evidence you can trust.</p>
              {!selection && (
                <div className="provider-welcome" aria-label="Connect a provider">
                  <button
                    disabled={!api.config || api.connecting}
                    onClick={() => setManage('gemini')}
                  >
                    Connect Gemini
                  </button>
                  <button
                    disabled={!api.config || api.connecting}
                    onClick={() => setManage('openai')}
                  >
                    Connect OpenAI
                  </button>
                  <button
                    disabled={!api.config || api.connecting}
                    onClick={() => setManage('ollama')}
                  >
                    Connect Ollama
                  </button>
                  <button onClick={() => window.location.assign('/pickup')}>
                    Try the demo · no model
                  </button>
                </div>
              )}
              <form
                className="coding-repo-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  setTarget(null)
                  setOpeningRepo(true)
                  void api.openRepo(repoPath).finally(() => setOpeningRepo(false))
                }}
              >
                <input
                  aria-label="Local repository path"
                  value={repoPath}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="E:\projects\your-repository"
                />
                <button type="submit" disabled={openingRepo || api.connecting}>
                  Open repository
                </button>
              </form>
              {api.repo && (
                <div className="coding-baseline">
                  <strong>{api.repo.name}</strong>
                  <span>{api.repo.path}</span>
                  <span>Branch: {api.repo.branch}</span>
                  <code>Baseline: {api.repo.revision}</code>
                  <span>
                    {api.repo.dirty
                      ? 'Local source edits will be included in the baseline.'
                      : 'Clean checkout'}
                  </span>
                </div>
              )}
              <form
                className="cut-composer coding-composer"
                onSubmit={(e) => {
                  e.preventDefault()
                  void start()
                }}
              >
                <textarea
                  aria-label="Coding task"
                  value={task}
                  onChange={(e) => {
                    setTask(e.target.value)
                    localStorage.setItem('parallax-task-draft', e.target.value)
                  }}
                  placeholder="Describe a feature, fix, or refactor…"
                />
                <div className="cut-composer-actions">
                  <label>
                    <input
                      type="checkbox"
                      checked={compare}
                      onChange={(e) => setCompare(e.target.checked)}
                    />{' '}
                    Compare approaches
                  </label>
                  {compare && (
                    <label>
                      <input
                        type="checkbox"
                        checked={sequential}
                        onChange={(e) => setSequential(e.target.checked)}
                      />{' '}
                      Generate A, then B manually
                    </label>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={investigate}
                      onChange={(e) => setInvestigate(e.target.checked)}
                    />{' '}
                    Investigate browser behavior
                  </label>
                  <select
                    aria-label="Coding provider"
                    disabled={!api.config || api.connecting || sending}
                    value={
                      provider === 'test'
                        ? 'test'
                        : selection
                          ? `${selection.provider}:${selection.model}`
                          : 'live'
                    }
                    onChange={(e) => {
                      const value = e.target.value
                      if (value === 'manage') {
                        setManage(selection?.provider ?? 'gemini')
                        return
                      }
                      if (value === 'test' || value === 'live') {
                        setProvider(value)
                        return
                      }
                      const index = value.indexOf(':')
                      setSending(true)
                      setModelError('')
                      void api
                        .configureProvider({
                          action: 'select',
                          provider: value.slice(0, index),
                          model: value.slice(index + 1),
                        })
                        .then(() => setProvider('live'))
                        .catch((error: unknown) =>
                          setModelError(
                            error instanceof Error ? error.message : 'Model selection failed.',
                          ),
                        )
                        .finally(() => setSending(false))
                    }}
                  >
                    {!selection && <option value="live">Choose a provider and model…</option>}
                    {(['gemini', 'openai', 'ollama'] as const).flatMap((id) => {
                      const models = [...(settings?.[id].models ?? [])]
                      if (selection?.provider === id && !models.includes(selection.model))
                        models.unshift(selection.model)
                      return models.map((model) => (
                        <option key={`${id}:${model}`} value={`${id}:${model}`}>
                          {providerName(id)} · {model}
                        </option>
                      ))
                    })}
                    {api.config?.testProvider && (
                      <option value="test">Scripted test provider · no model</option>
                    )}
                    <option value="manage">Manage providers…</option>
                  </select>
                  <button
                    className="cut-primary"
                    type="submit"
                    disabled={!api.repo || !task.trim() || sending || openingRepo || api.connecting}
                  >
                    {investigate ? 'Start investigation' : 'Start coding'}
                  </button>
                </div>
              </form>
              {modelError && <p role="alert">{modelError}</p>}
              {selection && !settings?.[selection.provider].checks[selection.model]?.ok && (
                <p>
                  Selected: {providerName(selection.provider)} · {selection.model}. The coding-agent
                  tool check has not passed in this runner instance. Open Manage providers to check
                  it; environment-configured development models remain supported.
                </p>
              )}
              <p>
                Agent limit: {settings?.maxToolRounds ?? 12} rounds per candidate. Change it in
                Manage providers.
              </p>
              {settings?.testTransport && (
                <p className="provider-test-label">PROTOCOL TEST DOUBLE — NO LIVE MODEL</p>
              )}
              {!selection && (
                <p>
                  Connect a provider in Manage providers to start coding.{' '}
                  {api.config?.testProvider
                    ? 'The test provider runs a disclosed script with real tools; it does not interpret arbitrary tasks.'
                    : 'The pickup investigation runs without a key.'}
                </p>
              )}
              <button className="cut-use-sample" onClick={() => window.location.assign('/pickup')}>
                <span>EXPLORE THE WORKFLOW</span>Fix the pickup-search race{' '}
                <ArrowUpRight size={15} />
              </button>
            </main>
          ) : (
            <main
              className={`coding-session mode-${workspaceMode} ${session.projectReplay?.runs.length ? 'has-project-replay' : ''} ${conversationOpen || session.approval ? '' : 'conversation-collapsed'}`}
            >
              <div className="desk-session-toolbar">
                <div className="desk-session-title">
                  <span className="desk-kicker">
                    {session.repo.name} / {session.repo.branch}
                  </span>
                  <h1 title={originalTask}>{shortTask}</h1>
                  <details className="desk-full-task">
                    <summary>Full task</summary>
                    <div tabIndex={0}>{originalTask}</div>
                  </details>
                </div>
                <div className="desk-mode-switch" role="tablist" aria-label="Workspace view">
                  <button
                    role="tab"
                    aria-selected={workspaceMode === 'code'}
                    onClick={() => selectWorkspaceMode('code')}
                  >
                    Code
                  </button>
                  <button
                    role="tab"
                    aria-selected={workspaceMode === 'replay'}
                    onClick={() => selectWorkspaceMode('replay')}
                  >
                    Replay
                  </button>
                </div>
                {session.projectReplay?.runs.length ? (
                  <button
                    className="desk-focus-replay"
                    onClick={() => {
                      setConversationOpen(false)
                      setRailOpen(false)
                    }}
                  >
                    Focus replay
                  </button>
                ) : null}
                <button
                  aria-expanded={conversationOpen}
                  onClick={() => setConversationOpen(!conversationOpen)}
                >
                  <MessageSquare size={13} />
                  {conversationOpen ? 'Collapse activity' : 'Show activity'}
                </button>
              </div>
              <aside
                className="coding-conversation"
                hidden={!conversationOpen && !session.approval}
              >
                <div className="desk-pane-label">
                  <span>
                    <Terminal size={13} /> Conversation & activity
                  </span>
                  <span>TURN {String(session.turn).padStart(2, '0')}</span>
                </div>
                <div className="coding-session-header">
                  <h2>Agent activity</h2>
                  <span>
                    {session.provider === 'test'
                      ? 'SCRIPTED TEST PROVIDER · NO MODEL'
                      : session.modelSelection
                        ? `${providerName(session.modelSelection.provider)} · ${session.modelSelection.model}`
                        : 'LIVE PROVIDER · legacy session'}
                  </span>
                  {(settings?.testTransport || session.modelSelection?.testDouble) && (
                    <small>PROTOCOL TEST DOUBLE · NO LIVE MODEL</small>
                  )}
                  <details className="desk-model-history">
                    <summary>Model turns, limits & token usage</summary>
                    {session.providerRuns?.map((run) => (
                      <div key={run.id} className="provider-model-label" data-testid="provider-run">
                        <small>
                          Turn {run.turn} · {run.candidate} · {run.provider} /{' '}
                          {run.actualModel ?? run.model} · {run.status}
                        </small>
                        <small>
                          Requested: {run.model} · Agent rounds: {run.rounds ?? 0}/
                          {run.maxToolRounds ?? 12} · Tools: {run.toolCalls ?? 0}
                        </small>
                        <small>
                          {run.usage && Object.keys(run.usage).length
                            ? `Tokens (sum of requests): ${Object.entries(run.usage)
                                .map(([key, value]) => `${key.replace('Tokens', '')} ${value}`)
                                .join(' · ')}`
                            : 'Token usage not reported yet.'}
                        </small>
                      </div>
                    ))}
                  </details>
                  <details className="desk-source-history">
                    <summary>
                      {session.repo.branch} · Turn {session.turn} ·{' '}
                      {session.baseline.revision.slice(0, 12)}
                    </summary>
                    <p>{session.repo.path}</p>
                    <code title={`Snapshot ${session.baseline.digest}`}>
                      {session.baseline.revision}
                    </code>
                    <small>
                      {session.baseline.dirty ? 'Baseline includes local edits' : 'Clean baseline'}
                    </small>
                  </details>
                </div>
                <div
                  className="desk-activity-tabs"
                  role="tablist"
                  aria-label="Agent activity views"
                >
                  <button
                    role="tab"
                    aria-selected={activityTab === 'activity'}
                    onClick={() => setActivityTab('activity')}
                  >
                    Activity
                  </button>
                  <button
                    role="tab"
                    aria-selected={activityTab === 'commands'}
                    onClick={() => setActivityTab('commands')}
                  >
                    Command output <span>{session.checks.length}</span>
                  </button>
                </div>
                <div
                  className="coding-transcript"
                  aria-label="Conversation and tool activity"
                  hidden={activityTab !== 'activity'}
                >
                  {session.events.map((event) => (
                    <details key={event.id} open={event.kind === 'user'} className="cut-tool-line">
                      <summary>
                        <span className={`desk-event-kind event-${event.kind}`}>
                          {event.kind.toUpperCase()}
                        </span>
                        <time dateTime={event.at}>{event.at.slice(11, 19)}</time>
                        <span className="desk-event-title">{event.title}</span>
                      </summary>
                      {event.detail && <pre>{event.detail}</pre>}
                    </details>
                  ))}
                  {session.messages
                    .filter((m) => m.role === 'assistant')
                    .map((message, index) => (
                      <p className="coding-message" key={index}>
                        Turn {message.turn}: {message.content}
                      </p>
                    ))}
                </div>
                <CommandOutput session={session} hidden={activityTab !== 'commands'} />
                {session.approval && (
                  <section
                    id="coding-command-approval"
                    tabIndex={-1}
                    className="coding-approval"
                    aria-label="Command approval"
                    data-request-id={session.approval.id}
                  >
                    <span className="desk-kicker">WAITING FOR YOUR APPROVAL</span>
                    <strong>Approve project command</strong>
                    <pre>
                      {session.approval.executable}{' '}
                      {session.approval.args.map((a) => JSON.stringify(a)).join(' ')}
                      {`\nWorking directory: ${session.approval.cwd}\n${session.approval.detail}`}
                    </pre>
                    <button onClick={() => void api.approve(true)}>Approve command</button>
                    <button onClick={() => void api.approve(false)}>Skip command</button>
                  </section>
                )}
                <div className="cut-agent-status" role="status">
                  <span>{api.connecting ? 'Reconnecting to runner…' : session.activity}</span>
                  {session.busy && <button onClick={() => void api.cancel()}>Cancel turn</button>}
                </div>
                {session.error && <p role="alert">{session.error}</p>}
                <form
                  className="cut-composer"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void continueSession()
                  }}
                >
                  <textarea
                    aria-label="Follow-up instruction"
                    value={followup}
                    onChange={(e) => {
                      setFollowup(e.target.value)
                    }}
                    placeholder="Continue from these changes…"
                  />
                  <div className="desk-followup-model">
                    <select
                      aria-label="Session provider and model"
                      disabled
                      title="This session keeps its original provider and model. Use provider settings to change the default for new sessions."
                    >
                      <option>
                        {session.provider === 'test'
                          ? 'Scripted provider · no model'
                          : session.modelSelection
                            ? `${providerName(session.modelSelection.provider)} · ${session.modelSelection.model}`
                            : 'Live provider · legacy session'}
                      </option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setManage(
                          session.modelSelection?.provider ?? selection?.provider ?? 'gemini',
                        )
                      }
                    >
                      Models…
                    </button>
                  </div>
                  <button
                    type="submit"
                    className="cut-primary"
                    disabled={session.busy || !followup.trim() || sending}
                  >
                    Continue session
                  </button>
                </form>
              </aside>
              {(conversationOpen || session.approval) && (
                <DeskDivider
                  label="Resize conversation pane"
                  value={activeWidth}
                  min={280}
                  max={640}
                  onChange={setActiveWidth}
                />
              )}
              <section className="coding-review" aria-label="Changes and checks">
                <details className="desk-recovery-panel" open={recoveryNeeded}>
                  <summary>
                    AI turn:{' '}
                    {selectedRun?.status ??
                      (session.provider === 'test' ? 'scripted provider' : 'not recorded')}{' '}
                    <span>· Recovery & retained verification</span>
                  </summary>
                  <div className="desk-recovery-content">
                    <button
                      type="button"
                      onClick={(event) => {
                        const details = event.currentTarget.closest('details')
                        if (details) {
                          details.open = false
                          details.querySelector('summary')?.focus()
                        }
                      }}
                    >
                      Close recovery details
                    </button>
                    <CandidateRecovery
                      session={session}
                      candidateId={candidateId}
                      api={api}
                      replayDraftDirty={replayDraftSession === session.id}
                    />
                  </div>
                </details>
                <div className="desk-replay-view" hidden={workspaceMode !== 'replay'}>
                  {showReplay || session.investigation || session.projectReplay ? (
                    <ProjectReplayPanel
                      key={session.id}
                      session={session}
                      api={api}
                      onDraftChange={(dirty) => setReplayDraftSession(dirty ? session.id : '')}
                      onVersion={(version) => {
                        if (version !== 'baseline') setCandidate(version)
                      }}
                    />
                  ) : (
                    <button
                      className="project-add-replay"
                      disabled={session.busy}
                      onClick={() => {
                        setShowReplay(true)
                        selectWorkspaceMode('replay')
                      }}
                    >
                      Add browser replay
                    </button>
                  )}
                </div>
                <div className="desk-code-view" hidden={workspaceMode !== 'code'}>
                  <div className="desk-review-tabs" role="tablist" aria-label="Review panels">
                    <button
                      role="tab"
                      aria-selected={reviewTab === 'changes'}
                      onClick={() => setReviewTab('changes')}
                    >
                      Files & checks
                    </button>
                    <button
                      role="tab"
                      aria-selected={reviewTab === 'commands'}
                      onClick={() => setReviewTab('commands')}
                    >
                      Check output · {session.checks.length}
                    </button>
                  </div>
                  <CommandOutput
                    session={session}
                    label="Project command output"
                    hidden={reviewTab !== 'commands'}
                  />
                  <details className="project-code-review" open hidden={reviewTab !== 'changes'}>
                    <summary>File changes, project checks, and apply</summary>
                    <div className="coding-review-header">
                      <h2>Review implementation</h2>
                      <button disabled={session.busy} onClick={() => void api.review()}>
                        Refresh review
                      </button>
                    </div>
                    <div
                      className="coding-candidates"
                      role="tablist"
                      aria-label="Coding implementations"
                    >
                      {session.candidates.map((item) => (
                        <button
                          key={item.id}
                          role="tab"
                          aria-selected={candidate?.id === item.id}
                          onClick={() => setCandidate(item.id)}
                        >
                          {item.name} · {item.files.length} files
                        </button>
                      ))}
                    </div>
                    <div
                      className={`coding-file-review ${candidate?.files.length ? '' : 'no-changes'}`}
                    >
                      <nav aria-label="Changed files">
                        {candidate?.files.map((change) => (
                          <button
                            aria-pressed={selectedFile?.path === change.path}
                            key={change.path}
                            onClick={() => setFile(change.path)}
                          >
                            {change.status} · {change.path}
                          </button>
                        ))}
                        {!candidate?.files.length && <p>No recorded changes yet.</p>}
                      </nav>
                      <div>
                        <h3>{selectedFile?.path ?? 'File diff'}</h3>
                        <pre className="coding-diff" aria-label="Selected file diff">
                          {selectedFile?.patch ??
                            'Actual changes appear as the agent edits its worktree.'}
                        </pre>
                      </div>
                    </div>
                    <section className="coding-checks" aria-label="Project checks">
                      <h2>Build and test evidence</h2>
                      {session.checks
                        .filter((check) => check.candidate === candidate?.id)
                        .map((check) => (
                          <details
                            key={check.id}
                            data-testid="coding-check"
                            data-status={check.status}
                            data-stale={check.digest !== candidate?.digest}
                          >
                            <summary>
                              <strong>
                                {check.digest !== candidate?.digest ? 'STALE · ' : ''}
                                {check.status.toUpperCase()}
                              </strong>{' '}
                              · Turn {check.turn} · {check.command}
                            </summary>
                            <pre>
                              {check.cwd}
                              {'\n'}
                              {check.output}
                            </pre>
                          </details>
                        ))}
                      {!session.checks.length && <p>No project checks have executed.</p>}
                    </section>
                    <div className="coding-apply">
                      <a
                        className="cut-primary"
                        href={
                          candidate?.patch && !session.busy
                            ? `/api/coding/sessions/${session.id}/patch/${candidate.id}`
                            : undefined
                        }
                        aria-disabled={!candidate?.patch || session.busy}
                        download
                      >
                        Export patch
                      </a>
                      <label>
                        Apply target checkout
                        <input
                          aria-label="Apply target checkout"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        />
                      </label>
                      <button
                        className="cut-primary"
                        disabled={session.busy || !candidate?.patch}
                        onClick={() => candidate && void api.apply(candidate.id, target)}
                      >
                        Apply to checkout
                      </button>
                      <p>
                        Checks use this candidate’s source digest. Applying checks HEAD and touched
                        files for conflicts and preserves the target index.
                      </p>
                      {session.applied && (
                        <p role="status">
                          Applied to {session.applied.path} · {session.applied.digest.slice(0, 12)}
                          {session.applied.digest !== candidate?.digest
                            ? ' · candidate has changed since apply'
                            : ''}
                        </p>
                      )}
                    </div>
                  </details>
                </div>
              </section>
            </main>
          )}
        </div>
      </div>
      {manage && (
        <ProviderSettingsPanel
          key={manage}
          settings={settings}
          initial={manage}
          update={async (data) => {
            const result = await api.configureProvider(data)
            if (data.action === 'select') setProvider('live')
            return result
          }}
          onClose={() => setManage(null)}
        />
      )}
    </div>
  )
}
