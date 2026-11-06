import { useState } from 'react'
import {
  ArrowRight,
  Clock3,
  Crosshair,
  FileCheck2,
  GitBranch,
  GitCompareArrows,
  MousePointer2,
} from 'lucide-react'
import { Badge, Button, SectionHeading } from '../../components/ui'
import { useAppStore } from '../../stores/useAppStore'
import type { Experiment, TimelineEvent } from '../../types/experiment'

const icons = {
  objective: Crosshair,
  branch: GitBranch,
  contract: FileCheck2,
  evidence: GitCompareArrows,
  decision: MousePointer2,
}
export function DevelopmentTimeline({ experiment }: { experiment: Experiment }) {
  const [selected, setSelected] = useState(experiment.timeline[2].id)
  const [filter, setFilter] = useState<'all' | 'architecture' | 'review'>('all')
  const navigate = useAppStore((state) => state.navigate)
  const events = experiment.timeline.filter(
    (event) =>
      filter === 'all' ||
      (filter === 'architecture'
        ? ['objective', 'contract', 'branch'].includes(event.kind)
        : ['evidence', 'decision'].includes(event.kind)),
  )
  const selectedEvent = experiment.timeline.find((event) => event.id === selected)!
  function target(event: TimelineEvent) {
    return event.kind === 'contract'
      ? 'contracts'
      : ['evidence', 'decision'].includes(event.kind)
        ? 'evidence'
        : 'explorer'
  }
  return (
    <div className="page-scroll">
      <SectionHeading
        eyebrow="DEVELOPMENT TIMELINE"
        title="Every path has a story"
        description="Trace the decisions behind a hypothetical coding experiment."
      />
      <div className="timeline-summary">
        <span className="timeline-date">
          <Clock3 size={17} />
          EXAMPLE SESSION
        </span>
        <span className="mono">09:00 — 09:12</span>
        <Badge tone="violet">ILLUSTRATIVE HISTORY</Badge>
      </div>
      <div className="segmented-control" aria-label="Filter timeline">
        {(['all', 'architecture', 'review'] as const).map((item) => (
          <button
            key={item}
            className={filter === item ? 'active' : ''}
            aria-pressed={filter === item}
            onClick={() => {
              setFilter(item)
              const first = experiment.timeline.find(
                (event) =>
                  item === 'all' ||
                  (item === 'architecture'
                    ? ['objective', 'contract', 'branch'].includes(event.kind)
                    : ['evidence', 'decision'].includes(event.kind)),
              )
              if (first) setSelected(first.id)
            }}
          >
            {item === 'all'
              ? 'All events'
              : item === 'architecture'
                ? 'Architecture'
                : 'Review & decision'}
          </button>
        ))}
      </div>
      <div className="timeline-events">
        {events.map((event, index) => {
          const Icon = icons[event.kind]
          return (
            <button
              key={event.id}
              className={`timeline-event ${selected === event.id ? 'selected' : ''}`}
              aria-pressed={selected === event.id}
              onClick={() => setSelected(event.id)}
            >
              <span className="timeline-time">{event.time}</span>
              <span className="timeline-event-icon">
                <Icon size={18} />
              </span>
              <span className="timeline-event-body">
                <span className="eyebrow">
                  EVENT {String(index + 1).padStart(2, '0')} / {event.kind.toUpperCase()}
                </span>
                <strong>{event.title}</strong>
                <small>{event.description}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          )
        })}
      </div>
      <div className="timeline-detail">
        <div>
          <Badge tone="cyan">SELECTED EVENT</Badge>
          <h3>{selectedEvent.title}</h3>
          <p>{selectedEvent.description}</p>
        </div>
        <Button onClick={() => navigate(target(selectedEvent))}>
          Explore context
          <ArrowRight size={14} />
        </Button>
      </div>
      <p className="footnote">
        Times and events describe a hand-authored example, not activity performed by PARALLAX.
      </p>
    </div>
  )
}
