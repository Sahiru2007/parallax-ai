import { useState } from 'react'
import { Logo } from '../../components/ui'
import { useCoding } from './useCoding'
import { ProjectReplayPanel } from './ProjectReplayPanel'
import { ProviderSettingsPanel } from './ProviderSettingsPanel'
import { providerName, type ProviderId } from '../../../shared/providers'
import './studio.css'
import './coding.css'

export default function CodingWorkspace() {
  const api = useCoding()
  const [path, setPath] = useState<string | null>(localStorage.getItem('parallax-repo-path'))
  const [task, setTask] = useState('')
  const [followup, setFollowup] = useState('')
  const [compare, setCompare] = useState(false)
  const [investigate, setInvestigate] = useState(false)
  const [showReplay, setShowReplay] = useState(false)
  const [providerChoice, setProvider] = useState<'live' | 'test' | null>(null)
  const [manage, setManage] = useState<ProviderId | null>(null)
  const [modelError, setModelError] = useState('')
  const settings = api.config?.providers
  const selection = settings?.selection
  const provider =
    providerChoice ??
    (api.config?.testProvider && !selection && !api.config.live.configured ? 'test' : 'live')
  const [candidateId, setCandidate] = useState('a')
  const [file, setFile] = useState('')
  const [targetChoice, setTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [openingRepo, setOpeningRepo] = useState(false)
  const session = api.session
  const candidate = session?.candidates.find((c) => c.id === candidateId) ?? session?.candidates[0]
  const selectedFile =
    candidate?.files.find((change) => change.path === file) ?? candidate?.files[0]
  const target = targetChoice ?? api.repo?.path ?? ''
  const repoPath = path ?? api.repo?.path ?? ''
  async function start() {
    setSending(true)
    try {
      await api.start(task, provider, compare, investigate)
    } finally {
      setSending(false)
    }
  }
  async function continueSession() {
    setSending(true)
    try {
      if (await api.followup(followup)) setFollowup('')
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="cut-workspace coding-workspace">
      <header className="cut-topbar coding-topbar">
        <a href="/" className="coding-logo">
          <Logo /> <strong>PARALLAX AI</strong>
        </a>
        <span>
          {api.repo?.name ?? 'Open a repository'} {api.repo && ` / ${api.repo.branch}`}
        </span>
        <span role="status" className="coding-connection">
          {api.connecting
            ? 'Reconnecting to runner…'
            : api.config
              ? 'Runner connected'
              : 'Runner unavailable'}
        </span>
        <a href="/pickup">Pickup investigation</a>
        <a href="/legacy">Design archive</a>
        <button
          disabled={!api.config || api.connecting}
          onClick={() => setManage(selection?.provider ?? 'gemini')}
        >
          Manage providers
        </button>
      </header>
      {api.error && (
        <div className="cut-error" role="alert">
          {api.error}
        </div>
      )}
      <div className="coding-navigation">
        <button disabled={session?.busy} onClick={api.newSession}>
          New coding session
        </button>
        <select
          aria-label="Saved coding sessions"
          value={session?.id ?? ''}
          onChange={(e) => {
            if (e.target.value) void api.open(e.target.value)
          }}
          disabled={session?.busy}
        >
          <option value="">Reopen a session…</option>
          {api.history.map((item) => (
            <option key={item.id} value={item.id}>
              {item.repo.name} · {item.messages[0]?.content.slice(0, 65)} · {item.status}
            </option>
          ))}
        </select>
      </div>
      {!session ? (
        <main className="coding-entry">
          <h1>What should we build?</h1>
          <p>One task. An isolated implementation. Evidence you can review.</p>
          {!selection && (
            <div className="provider-welcome" aria-label="Connect a provider">
              <button disabled={!api.config || api.connecting} onClick={() => setManage('gemini')}>
                Connect Gemini
              </button>
              <button disabled={!api.config || api.connecting} onClick={() => setManage('openai')}>
                Connect OpenAI
              </button>
              <button disabled={!api.config || api.connecting} onClick={() => setManage('ollama')}>
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
              onChange={(e) => setTask(e.target.value)}
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
              tool check has not passed in this runner instance. Open Manage providers to check it;
              environment-configured development models remain supported.
            </p>
          )}
          <p>
            Agent limit: {settings?.maxToolRounds ?? 12} rounds per candidate. Change it in Manage
            providers.
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
            <span>TRY A RUNNABLE TASK</span>Fix the pickup-search race
          </button>
        </main>
      ) : (
        <main
          className={`coding-session ${session.projectReplay?.runs.length ? 'has-project-replay' : ''}`}
        >
          <aside className="coding-conversation">
            <div className="coding-session-header">
              <h1>{session.messages[0]?.content}</h1>
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
              <p>
                {session.repo.path} · {session.repo.branch}
              </p>
              <code title={`Snapshot ${session.baseline.digest}`}>{session.baseline.revision}</code>
              <small>
                {session.baseline.dirty ? 'Baseline includes local edits' : 'Clean baseline'} · Turn{' '}
                {session.turn}
              </small>
            </div>
            <div className="coding-transcript" aria-label="Conversation and tool activity">
              {session.events.map((event) => (
                <details key={event.id} open={event.kind === 'user'} className="cut-tool-line">
                  <summary>
                    {event.kind.toUpperCase()} · {event.title}
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
            {session.approval && (
              <section
                className="coding-approval"
                aria-label="Command approval"
                data-request-id={session.approval.id}
              >
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
                onChange={(e) => setFollowup(e.target.value)}
                placeholder="Continue from these changes…"
                disabled={session.busy}
              />
              <button
                type="submit"
                className="cut-primary"
                disabled={session.busy || !followup.trim() || sending}
              >
                Continue session
              </button>
            </form>
          </aside>
          <section className="coding-review" aria-label="Changes and checks">
            {showReplay || session.investigation || session.projectReplay ? (
              <ProjectReplayPanel
                key={session.id}
                session={session}
                api={api}
                onVersion={(version) => {
                  if (version !== 'baseline') setCandidate(version)
                }}
              />
            ) : (
              <button
                className="project-add-replay"
                disabled={session.busy}
                onClick={() => setShowReplay(true)}
              >
                Add browser replay
              </button>
            )}
            <details className="project-code-review" open={!session.projectReplay?.runs.length}>
              <summary>File changes, project checks, and apply</summary>
              <div className="coding-review-header">
                <h2>Review implementation</h2>
                <button disabled={session.busy} onClick={() => void api.review()}>
                  Refresh review
                </button>
              </div>
              <div className="coding-candidates" role="tablist" aria-label="Coding implementations">
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
              <div className="coding-file-review">
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
                    <details key={check.id} data-testid="coding-check">
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
                  Checks use this candidate’s source digest. Applying checks HEAD and touched files
                  for conflicts and preserves the target index.
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
          </section>
        </main>
      )}
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
