import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileCode2,
  FlaskConical,
  GitCompareArrows,
  Package,
  ShieldAlert,
} from 'lucide-react'
import { Badge, Button, FutureGlyph, SectionHeading, Status } from '../../components/ui'
import { useAppStore } from '../../stores/useAppStore'
import type { Experiment, FutureId } from '../../types/experiment'

export function EvidenceInspector({ experiment }: { experiment: Experiment }) {
  const { selectedFuture, selectFuture, preferredFuture, setPreferredFuture, navigate } =
    useAppStore()
  const [tab, setTab] = useState<'tests' | 'files' | 'dependencies'>('tests')
  const [fileIndex, setFileIndex] = useState(0)
  const [comparisonId, setComparisonId] = useState<FutureId>('sessions')
  const future =
    experiment.futures.find((item) => item.id === selectedFuture) ?? experiment.futures[0]
  const comparison =
    experiment.futures.find((item) => item.id === comparisonId && item.id !== future.id) ??
    experiment.futures.find((item) => item.id !== future.id)!
  const file = future.files[fileIndex] ?? future.files[0]
  const otherFile = comparison.files.find((item) => item.path === file.path)
  return (
    <div className="page-scroll evidence-page">
      <SectionHeading
        eyebrow="EVIDENCE INSPECTOR"
        title="See the tradeoffs"
        description="Compare the possibilities. Make the decision yours."
      />
      <div className="info-banner">
        <FlaskConical size={17} />
        <p>
          All evidence below is illustrative. Test outcomes and line counts are fixtures, and code
          excerpts are incomplete examples.
        </p>
      </div>
      <div className="evidence-futures">
        {experiment.futures.map((item) => (
          <button
            key={item.id}
            className={`evidence-future accent-${item.accent} ${selectedFuture === item.id ? 'selected' : ''}`}
            aria-pressed={selectedFuture === item.id}
            onClick={() => {
              selectFuture(item.id)
              setFileIndex(0)
            }}
          >
            <FutureGlyph accent={item.accent} letter={item.letter} />
            <span>
              <small>FUTURE {item.letter}</small>
              <strong>{item.title}</strong>
            </span>
            {preferredFuture === item.id && <Check size={14} />}
          </button>
        ))}
      </div>
      <div className="evidence-tabbar" role="tablist" aria-label="Evidence categories">
        {(
          [
            { id: 'tests', label: 'Test comparison', icon: FlaskConical },
            { id: 'files', label: 'Changed files', icon: FileCode2 },
            { id: 'dependencies', label: 'Dependencies', icon: Package },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            role="tab"
            id={`evidence-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="evidence-detail"
            key={id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="evidence-detail" aria-labelledby={`evidence-tab-${tab}`}>
        {tab === 'tests' && (
          <>
            <div className="comparison-table-wrap">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>EXAMPLE BEHAVIOR</th>
                    {experiment.futures.map((item) => (
                      <th key={item.id}>
                        <span className={`future-table-label tone-${item.accent}`}>
                          FUTURE {item.letter}
                        </span>
                        <small>
                          {item.id === 'jwt'
                            ? 'JWT'
                            : item.id === 'sessions'
                              ? 'Sessions'
                              : 'Managed'}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {experiment.futures[0].tests.map((test, index) => (
                    <tr key={test.id}>
                      <td>{test.name}</td>
                      {experiment.futures.map((item) => (
                        <td key={item.id}>
                          <Status status={item.tests[index].status} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="evidence-selected-detail">
              <h3>
                <ShieldAlert size={17} />
                Future {future.letter}: what to consider
              </h3>
              <p>{future.tradeoff}</p>
              <div className="fixture-detail-list">
                {future.tests
                  .filter((test) => test.status !== 'passed')
                  .map((test) => (
                    <div key={test.id}>
                      <Status status={test.status} />
                      <span>{test.detail}</span>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
        {tab === 'files' && (
          <>
            <div className="diff-toolbar">
              <label className="select-wrap">
                <FileCode2 size={14} />
                <select
                  aria-label="Select changed file"
                  value={fileIndex}
                  onChange={(event) => setFileIndex(Number(event.target.value))}
                >
                  {future.files.map((item, index) => (
                    <option key={item.path} value={index}>
                      {item.path}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
              <Badge tone="green">+{file.additions}</Badge>
              <Badge tone="red">−{file.deletions}</Badge>
            </div>
            <div className="code-diff">
              <div>
                <h4>
                  BEFORE <Badge>ILLUSTRATIVE</Badge>
                </h4>
                <pre>{file.before}</pre>
              </div>
              <div>
                <h4>
                  FUTURE {future.letter} <Badge tone={future.accent}>{file.kind}</Badge>
                </h4>
                <pre>{file.after}</pre>
              </div>
            </div>
            <div className="compare-file">
              <label>
                Compare with{' '}
                <select
                  aria-label="Compare file against another future"
                  value={comparison.id}
                  onChange={(event) => setComparisonId(event.target.value as FutureId)}
                >
                  {experiment.futures
                    .filter((item) => item.id !== future.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                </select>
              </label>
              <pre>
                {otherFile
                  ? otherFile.after
                  : `No proposed change to ${file.path} in Future ${comparison.letter}.`}
              </pre>
            </div>
          </>
        )}
        {tab === 'dependencies' && (
          <div className="dependency-comparison">
            {experiment.futures.map((item) => (
              <div className={`dependency-card accent-${item.accent}`} key={item.id}>
                <div>
                  <FutureGlyph accent={item.accent} letter={item.letter} />
                  <h3>{item.title}</h3>
                </div>
                {item.dependencies.map((dep) => (
                  <div className="dependency-entry" key={dep.name}>
                    <Package size={15} />
                    <span>
                      <code>{dep.name}</code>
                      <small>{dep.purpose}</small>
                    </span>
                  </div>
                ))}
                <p>
                  {item.dependencies.length} proposed{' '}
                  {item.dependencies.length === 1 ? 'dependency' : 'dependencies'} · not installed
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="evidence-actions">
        <Button onClick={() => navigate('explorer')}>
          <GitCompareArrows size={14} />
          Back to explorer
        </Button>
        <Button variant="primary" onClick={() => setPreferredFuture(future.id)}>
          {preferredFuture === future.id ? <Check size={14} /> : <ArrowRight size={14} />}{' '}
          {preferredFuture === future.id
            ? `Future ${future.letter} preferred`
            : `Prefer Future ${future.letter}`}
        </Button>
      </div>
      <p className="footnote">
        Preferences are stored locally. Selecting a future never modifies project files.
      </p>
    </div>
  )
}
