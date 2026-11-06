import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FlaskConical,
  GitCompareArrows,
  Package,
  ShieldAlert,
  X,
} from 'lucide-react'
import { Badge, Button, FutureGlyph, IconButton, Status } from '../../components/ui'
import { useAppStore } from '../../stores/useAppStore'
import type { Experiment } from '../../types/experiment'

export function FutureInspector({ experiment }: { experiment: Experiment }) {
  const {
    selectedFuture,
    preferredFuture,
    selectFuture,
    setPreferredFuture,
    navigate,
    toggleInspector,
  } = useAppStore()
  const [tab, setTab] = useState<'overview' | 'files' | 'tests'>('overview')
  const [expandedTest, setExpandedTest] = useState<string | null>(null)
  const index = Math.max(
    0,
    experiment.futures.findIndex((item) => item.id === selectedFuture),
  )
  const future = experiment.futures[index]
  const passed = future.tests.filter((test) => test.status === 'passed').length
  return (
    <aside className={`inspector accent-${future.accent}`} aria-label="Future inspector">
      <div className="inspector-top">
        <span>
          <ScanIcon />
          FUTURE INSPECTOR
        </span>
        <IconButton label="Close inspector" onClick={toggleInspector}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="inspector-scroll">
        <div className="inspector-identity">
          <div className="inspector-identity-top">
            <FutureGlyph accent={future.accent} letter={future.letter} large />
            <Badge tone={future.accent}>FUTURE {future.letter}</Badge>
          </div>
          <h2>{future.title}</h2>
          <p>{future.subtitle}</p>
          <div className="inspector-future-nav">
            <span>Alternative {index + 1} of 3</span>
            <IconButton
              label="Previous future"
              onClick={() => selectFuture(experiment.futures[(index + 2) % 3].id)}
            >
              <ArrowLeft size={14} />
            </IconButton>
            <IconButton
              label="Next future"
              onClick={() => selectFuture(experiment.futures[(index + 1) % 3].id)}
            >
              <ArrowRight size={14} />
            </IconButton>
          </div>
        </div>
        <div className="inspector-tabs" role="tablist" aria-label="Future details">
          {(['overview', 'files', 'tests'] as const).map((item) => (
            <button
              key={item}
              role="tab"
              id={`inspector-tab-${item}`}
              aria-selected={tab === item}
              aria-controls="inspector-detail"
              onClick={() => setTab(item)}
            >
              {item === 'overview'
                ? 'Overview'
                : item === 'files'
                  ? `Files (${future.files.length})`
                  : `Tests (${future.tests.length})`}
            </button>
          ))}
        </div>
        <div
          className="inspector-content"
          id="inspector-detail"
          role="tabpanel"
          aria-labelledby={`inspector-tab-${tab}`}
        >
          {tab === 'overview' && (
            <>
              <div className="detail-section">
                <h3>PROPOSED STRATEGY</h3>
                <p>{future.description}</p>
                <ol className="strategy-list">
                  {future.strategy.map((step, i) => (
                    <li key={step}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="tradeoff">
                <ShieldAlert size={15} />
                <div>
                  <strong>The tradeoff</strong>
                  <p>{future.tradeoff}</p>
                </div>
              </div>
              <div className="detail-section">
                <h3>
                  DEPENDENCIES <span>{future.dependencies.length} proposed</span>
                </h3>
                <div className="dependency-list">
                  {future.dependencies.map((dep) => (
                    <div key={dep.name}>
                      <Package size={14} />
                      <span>
                        <code>{dep.name}</code>
                        <small>{dep.purpose}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sample-summary">
                <FlaskConical size={16} />
                <span>
                  <strong>
                    {passed} / {future.tests.length} sample checks passed
                  </strong>
                  <small>Illustrative fixtures · never executed</small>
                </span>
                <ChevronRight size={15} />
                <button aria-label="View example tests" onClick={() => setTab('tests')} />
              </div>
            </>
          )}
          {tab === 'files' && (
            <>
              <div className="detail-section">
                <h3>ILLUSTRATIVE CHANGES</h3>
                <p>
                  Proposed file changes for this example. These files do not exist in your
                  workspace.
                </p>
              </div>
              <div className="inspector-files">
                {future.files.map((file) => (
                  <div key={file.path}>
                    <FileCode2 size={16} />
                    <div>
                      <code>{file.path}</code>
                      <small>{file.kind}</small>
                    </div>
                    <span>
                      <b>+{file.additions}</b>
                      <em>−{file.deletions}</em>
                    </span>
                  </div>
                ))}
              </div>
              <Button className="full-width" onClick={() => navigate('evidence')}>
                <GitCompareArrows size={15} />
                Inspect example diffs
              </Button>
              <div className="detail-section">
                <h3>DEPENDENCIES</h3>
                {future.dependencies.map((dependency) => (
                  <p key={dependency.name}>
                    <code>{dependency.name}</code> — {dependency.purpose}
                  </p>
                ))}
              </div>
            </>
          )}
          {tab === 'tests' && (
            <>
              <div className="detail-section">
                <h3>EXAMPLE TEST RESULTS</h3>
                <p>
                  Hand-authored fixtures, independent of your edited acceptance conditions. No test
                  runner has been invoked.
                </p>
              </div>
              <div className="example-tests">
                {future.tests.map((test) => (
                  <div className="example-test" key={test.id}>
                    <button
                      onClick={() => setExpandedTest(expandedTest === test.id ? null : test.id)}
                      aria-expanded={expandedTest === test.id}
                    >
                      <span>{test.name}</span>
                      <Status status={test.status} />
                      <ChevronDown size={13} />
                    </button>
                    {expandedTest === test.id && <p>{test.detail}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="inspector-bottom">
        <Button
          variant={preferredFuture === future.id ? 'secondary' : 'primary'}
          className="full-width"
          onClick={() => setPreferredFuture(future.id)}
        >
          {preferredFuture === future.id ? <Check size={15} /> : <GitCompareArrows size={15} />}{' '}
          {preferredFuture === future.id ? 'Preferred future' : 'Mark as preferred'}
        </Button>
        <span>Saved locally. No code is applied.</span>
      </div>
    </aside>
  )
}

function ScanIcon() {
  return <span className="scan-icon" />
}
