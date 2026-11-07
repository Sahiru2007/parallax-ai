import { useEffect, useState } from 'react'
import type { CodingSession } from '../../../shared/coding'
import type { useCoding } from './useCoding'
import './recovery.css'

export function CandidateRecovery({
  session,
  candidateId,
  api,
  replayDraftDirty = false,
}: {
  session: CodingSession
  candidateId: string
  api: ReturnType<typeof useCoding>
  replayDraftDirty?: boolean
}) {
  const candidate = session.candidates.find((c) => c.id === candidateId) ?? session.candidates[0]
  const run = session.providerRuns?.filter((r) => r.candidate === candidate?.id).at(-1)
  const [additional, setAdditional] = useState(4),
    [extend, setExtend] = useState(false),
    [sending, setSending] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const limited = Boolean(
    run && (run.recovery?.kind === 'limit' || (run.rounds ?? 0) >= (run.maxToolRounds ?? 12)),
  )
  const canResume = run && run.status !== 'completed' && run.resumable !== false
  const until = run?.recovery?.retryAt,
    delay = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
  const checks = session.checks.filter((c) => c.candidate === candidate?.id)
  const currentChecks = checks.filter((c) => c.digest === candidate?.digest)
  const replay = session.projectReplay?.runs.filter((r) => r.version === candidate?.id).at(-1)
  const staleReplay =
    replay &&
    (replayDraftDirty ||
      replay.sourceDigest !== candidate?.digest ||
      replay.scenarioDigest !== session.projectReplay?.saved?.digest ||
      replay.orderRevision !== session.projectReplay?.orderRevision)
  const queued = session.generation?.queued ?? []
  async function perform(action: () => Promise<unknown>) {
    setSending(true)
    try {
      await action()
    } finally {
      setSending(false)
    }
  }
  return (
    <section className="candidate-recovery" aria-label="Candidate recovery">
      <div className="recovery-statuses">
        <div>
          <strong>{candidate?.name ?? 'Candidate'} · AI turn</strong>
          <p data-testid="ai-turn-status">
            {run?.recovery?.waiting
              ? 'AI waiting to retry'
              : queued.includes(candidate?.id)
                ? 'AI generation queued'
                : run?.status === 'completed'
                  ? 'AI turn completed'
                  : run?.status === 'running'
                    ? 'AI turn active'
                    : run
                      ? 'AI turn interrupted'
                      : session.busy
                        ? 'AI turn active'
                        : 'No recorded AI turn'}
          </p>
        </div>
        <div>
          <strong>Patch verification · independent evidence</strong>
          <p data-testid="patch-verification-status">
            {replay
              ? staleReplay
                ? 'Replay checks stale'
                : replay.status === 'passed'
                  ? 'Replay checks passed'
                  : replay.status === 'failed'
                    ? 'Replay assertion failed'
                    : `Replay ${replay.status} — no passing assertion`
              : 'Replay not run'}
            {' · '}
            {currentChecks.some((c) => c.status === 'failed')
              ? 'Project check failed'
              : currentChecks.some((c) => c.status === 'passed')
                ? 'Retained project checks passed at this source'
                : checks.length
                  ? 'Project checks stale or incomplete'
                  : 'Project checks not run'}
          </p>
        </div>
      </div>
      {run && (
        <>
          <p>
            {run.provider} / <code>{run.model}</code> · Rounds {run.rounds ?? 0}/
            {run.maxToolRounds ?? 12} · Continuations {run.continuations ?? 0} · Requests{' '}
            {run.requests ?? run.rounds ?? 0} · Automatic retries {run.autoRetries ?? 0} · Waited{' '}
            {Math.ceil((run.waitedMs ?? 0) / 1000)}s total
          </p>
          {run.recovery && (
            <p role="status">
              {run.recovery.message}{' '}
              {run.recovery.retryAfterMs !== undefined &&
                `Provider reported retry delay: ${Math.ceil(run.recovery.retryAfterMs / 1000)}s.`}{' '}
              {delay > 0 && `Retry available in ${delay}s.`}{' '}
              {run.recovery.waiting &&
                'At most 2 automatic retries and 60 seconds waiting per allowance. Cancel stops waiting.'}
            </p>
          )}
          {run.legacyRecovery && (
            <p>
              Legacy turn: exact provider messages were not recorded. Resume uses the inspected
              patch and retained checks; historical unknown outcomes cannot be reconstructed.
            </p>
          )}
          {run.recoveryHistory?.length ? (
            <details>
              <summary>Previous interruptions ({run.recoveryHistory.length})</summary>
              {run.recoveryHistory.map((item, index) => (
                <p key={index}>
                  {item.kind} · {item.message}
                </p>
              ))}
            </details>
          ) : null}
          {canResume && !session.busy && (
            <div className="recovery-actions">
              <label>
                <input
                  type="checkbox"
                  aria-label="Add bounded allowance"
                  checked={extend || limited}
                  disabled={limited}
                  onChange={(e) => setExtend(e.target.checked)}
                />{' '}
                Add an explicit bounded allowance
              </label>
              {(extend || limited) && (
                <label>
                  Additional agent rounds
                  <input
                    aria-label="Additional agent rounds"
                    type="number"
                    min={1}
                    max={24}
                    value={additional}
                    onChange={(e) => setAdditional(Number(e.target.value))}
                  />
                </label>
              )}
              <button
                disabled={sending || api.connecting || delay > 0}
                onClick={() =>
                  void perform(() => api.resume(run.id, extend || limited ? additional : undefined))
                }
              >
                {extend || limited
                  ? `Continue AI with ${additional} more rounds`
                  : 'Resume AI turn'}
              </button>
            </div>
          )}
          {run.calls?.length ? (
            <details>
              <summary>Retained tool receipts and approvals ({run.calls.length})</summary>
              {run.calls.map((call) => (
                <div key={call.id} className="recovery-receipt">
                  <strong>
                    {call.name} · {call.status}
                  </strong>
                  {call.approval && <p>Approval: {call.approval}</p>}
                  {call.approvalHistory?.map((a) => (
                    <p key={a.id}>
                      Retained approval: {a.decision} / {a.command} / {a.cwd}
                    </p>
                  ))}
                  {call.detail && <pre>{call.detail}</pre>}
                  {call.status === 'uncertain' && !session.busy && (
                    <>
                      <p>
                        Review the diff and inspection above. Skipping preserves the unknown result
                        as unverified. A rerun needs a new command approval.
                      </p>
                      <button
                        disabled={sending}
                        onClick={() => void perform(() => api.resolveTool(run.id, call.id, 'skip'))}
                      >
                        Acknowledge inspection and skip
                      </button>
                      <button
                        disabled={sending}
                        onClick={() =>
                          void perform(() => api.resolveTool(run.id, call.id, 'rerun'))
                        }
                      >
                        Request a fresh approved rerun
                      </button>
                    </>
                  )}
                </div>
              ))}
            </details>
          ) : null}
        </>
      )}
      {queued.map((id) => (
        <button
          key={id}
          disabled={session.busy || sending || api.connecting}
          onClick={() => void perform(() => api.generateNext(id))}
        >
          Generate Candidate {id.toUpperCase()} from same baseline
        </button>
      ))}
    </section>
  )
}
