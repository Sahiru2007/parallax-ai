import { useState } from 'react'
import { ChevronDown, ChevronUp, Circle, FlaskConical, Terminal } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { IconButton } from '../components/ui'
import type { Experiment } from '../types/experiment'

export function ActivityPanel({ experiment }: { experiment: Experiment }) {
  const { activityOpen, toggleActivity, selectedFuture, preferredFuture } = useAppStore()
  const [tab, setTab] = useState<'activity' | 'terminal'>('activity')
  const future =
    experiment.futures.find((item) => item.id === selectedFuture) ?? experiment.futures[0]
  return (
    <section
      className={`activity-panel ${activityOpen ? 'is-open' : ''}`}
      aria-label="Activity and terminal"
    >
      <div className="activity-header">
        <div className="activity-tabs">
          <button
            className={tab === 'activity' ? 'active' : ''}
            onClick={() => {
              setTab('activity')
              if (!activityOpen) toggleActivity()
            }}
          >
            <Circle size={11} />
            Activity<span>3</span>
          </button>
          <button
            className={tab === 'terminal' ? 'active' : ''}
            onClick={() => {
              setTab('terminal')
              if (!activityOpen) toggleActivity()
            }}
          >
            <Terminal size={13} />
            Terminal
          </button>
        </div>
        <div className="activity-header-right">
          <span>
            <FlaskConical size={12} />
            DEMO ONLY
          </span>
          <IconButton
            label={activityOpen ? 'Collapse activity panel' : 'Expand activity panel'}
            aria-expanded={activityOpen}
            onClick={toggleActivity}
          >
            {activityOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </IconButton>
        </div>
      </div>
      {activityOpen && (
        <div className="activity-content">
          {tab === 'activity' ? (
            <>
              <div className="activity-line">
                <span className="log-time">FIXTURE</span>
                <span className="log-tag">workspace</span>
                <span>
                  Sample experiment loaded <b>{experiment.id}</b>
                </span>
              </div>
              <div className="activity-line">
                <span className="log-time">LOCAL</span>
                <span className="log-tag violet">explorer</span>
                <span>
                  Inspecting <b>Future {future.letter}</b> · {future.title}
                </span>
                <span className="log-side">{future.files.length} proposed file changes</span>
              </div>
              <div className="activity-line">
                <span className="log-time">LOCAL</span>
                <span className="log-tag cyan">decision</span>
                <span>
                  {preferredFuture
                    ? `Future ${experiment.futures.find((item) => item.id === preferredFuture)?.letter} marked as preferred. No implementation was applied.`
                    : 'Awaiting your review. No future has been chosen.'}
                </span>
              </div>
            </>
          ) : (
            <div className="terminal-content">
              <div>
                <span>parallax</span> ~/auth-platform <b>›</b>
              </div>
              <p>Terminal integration is planned for a future phase.</p>
              <p className="muted">
                This preview does not run commands, agents, or application tests.
              </p>
              <span className="terminal-cursor" />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
