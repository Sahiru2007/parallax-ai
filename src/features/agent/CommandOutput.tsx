import type { CodingSession } from '../../../shared/coding'
export function CommandOutput({
  session,
  hidden = false,
  label = 'Agent command output',
}: {
  session: CodingSession
  hidden?: boolean
  label?: string
}) {
  return (
    <div className="desk-command-output" aria-label={label} hidden={hidden}>
      {session.checks.map((check) => (
        <section key={check.id}>
          <div>
            <strong className={`desk-check-${check.status}`}>
              {check.digest !== session.candidates.find((c) => c.id === check.candidate)?.digest
                ? 'STALE · '
                : ''}
              {check.status.toUpperCase()}
            </strong>
            <span>
              {' '}
              {check.candidate.toUpperCase()} / TURN {check.turn}
            </span>
          </div>
          <code>{check.command}</code>
          <small>{check.cwd}</small>
          {check.fullOutput && (
            <a href={`/api/coding/sessions/${session.id}/checks/${check.id}/output`} download>
              Download complete output
              {check.outputChars ? ` (${check.outputChars.toLocaleString()} characters)` : ''}
            </a>
          )}
          <pre>
            {check.output ||
              (check.status === 'running'
                ? 'Waiting for command output…'
                : 'Command produced no output.')}
          </pre>
        </section>
      ))}
      {!session.checks.length && (
        <p>
          No commands have run yet. Project commands appear here with their actual output after
          approval.
        </p>
      )}
    </div>
  )
}
