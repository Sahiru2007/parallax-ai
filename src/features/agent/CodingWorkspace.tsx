import { useState } from 'react'
import { Logo } from '../../components/ui'
import { useCoding } from './useCoding'
import './studio.css'
import './coding.css'

export default function CodingWorkspace() {
  const api = useCoding()
  const [path, setPath] = useState<string | null>(localStorage.getItem('parallax-repo-path'))
  const [task, setTask] = useState('')
  const [followup, setFollowup] = useState('')
  const [compare, setCompare] = useState(false)
  const [providerChoice, setProvider] = useState<'live' | 'test' | null>(null)
  const provider =
    providerChoice ?? (api.config?.testProvider && !api.config.live.configured ? 'test' : 'live')
  const [candidateId, setCandidate] = useState('a')
  const [file, setFile] = useState('')
  const [targetChoice, setTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const session = api.session
  const candidate = session?.candidates.find((c) => c.id === candidateId) ?? session?.candidates[0]
  const selectedFile =
    candidate?.files.find((change) => change.path === file) ?? candidate?.files[0]
  const target = targetChoice ?? api.repo?.path ?? ''
  const repoPath = path ?? api.repo?.path ?? ''
  async function start() {
    setSending(true)
    try {
      await api.start(task, provider, compare)
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
          <form
            className="coding-repo-form"
            onSubmit={(e) => {
              e.preventDefault()
              setTarget(null)
              void api.openRepo(repoPath)
            }}
          >
            <input
              aria-label="Local repository path"
              value={repoPath}
              onChange={(e) => setPath(e.target.value)}
              placeholder="E:\projects\your-repository"
            />
            <button type="submit">Open repository</button>
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
              <select
                aria-label="Coding provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'live' | 'test')}
              >
                <option value="live">
                  Live provider ·{' '}
                  {api.config?.live.configured ? api.config.live.model : 'not configured'}
                </option>
                {api.config?.testProvider && (
                  <option value="test">Scripted test provider · no model</option>
                )}
              </select>
              <button
                className="cut-primary"
                type="submit"
                disabled={!api.repo || !task.trim() || sending}
              >
                Start coding
              </button>
            </div>
          </form>
          {!api.config?.live.configured && (
            <p>
              Live coding needs OPENAI_API_KEY and PARALLAX_MODEL on the runner.{' '}
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
        <main className="coding-session">
          <aside className="coding-conversation">
            <div className="coding-session-header">
              <h1>{session.messages[0]?.content}</h1>
              <span>
                {session.provider === 'test'
                  ? 'SCRIPTED TEST PROVIDER · NO MODEL'
                  : 'LIVE PROVIDER'}
              </span>
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
              <section className="coding-approval" aria-label="Command approval">
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
                  {selectedFile?.patch ?? 'Actual changes appear as the agent edits its worktree.'}
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
          </section>
        </main>
      )}
    </div>
  )
}
