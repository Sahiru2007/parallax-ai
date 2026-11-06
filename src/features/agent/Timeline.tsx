import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Circle,
  MousePointer2,
  Network,
  PanelTop,
  Play,
  SkipForward,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReplayResult, RequestId, Schedule, TraceEvent } from '../../../shared/investigation'

export function Timeline({
  run,
  order,
  selected,
  onSelect,
  onReorder,
  busy,
}: {
  run: ReplayResult
  order: Schedule
  selected: string
  onSelect: (id: string) => void
  onReorder: (order: Schedule) => void
  busy: boolean
}) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    const current = run.events.findIndex((event) => event.id === selected)
    const timeout = window.setTimeout(() => {
      if (current >= run.events.length - 1) setPlaying(false)
      else onSelect(run.events[current + 1].id)
    }, 600)
    return () => clearTimeout(timeout)
  }, [playing, selected, onSelect, run.events])
  const start = Math.max(0, (run.events[0]?.atMs ?? 0) - 100)
  const end = Math.max(start + 100, (run.events.at(-1)?.atMs ?? 1000) + 150)
  const position = (event?: TraceEvent) =>
    event ? 5 + ((event.atMs - start) / (end - start)) * 83 : 5
  const current = run.events.find((event) => event.id === selected)
  const swap = () => onReorder([order[1], order[0]])
  function drop(event: React.DragEvent, requestId: RequestId) {
    event.preventDefault()
    const moved = event.dataTransfer.getData('text/parallax-response')
    if (moved && moved !== requestId && !busy) swap()
  }
  const related =
    current?.kind === 'state'
      ? current.causedBy
      : current?.kind === 'response'
        ? current.id
        : undefined
  return (
    <section className="cut-timeline" aria-label="Execution timeline">
      <div className="cut-timeline-toolbar">
        <div>
          <span className="cut-eyebrow">EXECUTION TIMELINE</span>
          <span className="cut-timeline-subtitle">One schedule. Three implementations.</span>
        </div>
        <div className="cut-transport">
          <button
            disabled={!run.events.length}
            aria-label={playing ? 'Pause recording' : 'Play recording'}
            onClick={() => {
              if (run.events.at(-1)?.id === selected) onSelect(run.events[0].id)
              setPlaying(!playing)
            }}
          >
            <Play size={12} />
          </button>
          <button
            disabled={!run.events.length}
            aria-label="Next recorded event"
            onClick={() => {
              const index = run.events.findIndex((event) => event.id === selected)
              onSelect(run.events[(index + 1) % run.events.length].id)
            }}
          >
            <SkipForward size={13} />
          </button>
          <span>
            {current?.atMs ?? 0}
            <small> ms</small>
          </span>
        </div>
      </div>
      <div className="cut-timeline-body">
        <div className="cut-track-labels">
          <div className="cut-ruler-label">TRACK</div>
          <div>
            <MousePointer2 size={14} />
            <span>
              User actions<small>Fixed input</small>
            </span>
          </div>
          <div>
            <Network size={14} />
            <span>
              Network responses<small>Drag to reorder</small>
            </span>
          </div>
          <div>
            <PanelTop size={14} />
            <span>
              UI state<small>Observed in browser</small>
            </span>
          </div>
        </div>
        <div className="cut-tracks">
          <div className="cut-ruler">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index} style={{ left: `${5 + index * 14}%` }}>
                {Math.round(start + ((end - start) * index) / 6)}
                <small>ms</small>
              </span>
            ))}
          </div>
          <div className="cut-playhead" style={{ left: `${position(current)}%` }}>
            <span />
          </div>
          {(['action', 'response', 'state'] as const).map((kind) => (
            <div className={`cut-track cut-track-${kind}`} key={kind}>
              {run.events
                .filter((event) => event.kind === kind)
                .map((event) => {
                  const linked = related && (event.id === related || event.causedBy === related)
                  const failure =
                    kind === 'state' &&
                    event.id === run.events.at(-1)?.id &&
                    run.status === 'failed'
                  return (
                    <div
                      key={event.id}
                      className={`cut-clip ${selected === event.id ? 'selected' : ''} ${linked ? 'linked' : ''} ${failure ? 'failure' : ''}`}
                      style={{ left: `${position(event)}%` }}
                      draggable={kind === 'response' && !busy}
                      onDragStart={(drag) =>
                        drag.dataTransfer.setData('text/parallax-response', event.requestId)
                      }
                      onDragOver={(drag) => {
                        if (kind === 'response') drag.preventDefault()
                      }}
                      onDrop={(drag) => drop(drag, event.requestId)}
                      data-testid={`${kind}-${event.requestId}`}
                    >
                      <button
                        className="cut-clip-select"
                        onClick={() => {
                          setPlaying(false)
                          onSelect(event.id)
                        }}
                        aria-label={`Inspect ${event.kind} ${event.requestId}: ${event.label}`}
                        aria-pressed={selected === event.id}
                      >
                        <span>
                          {kind === 'response' ? (
                            <Network size={11} />
                          ) : kind === 'action' ? (
                            <MousePointer2 size={11} />
                          ) : (
                            <Circle size={10} />
                          )}
                          <strong>
                            {kind === 'action'
                              ? `Type ${event.query}`
                              : kind === 'response'
                                ? `Response ${event.requestId}`
                                : event.changed
                                  ? 'State updated'
                                  : 'State retained'}
                          </strong>
                          {kind === 'response' && <ArrowUpDown size={10} />}
                        </span>
                        <small>
                          {failure
                            ? 'FAIL · stale overwrite'
                            : kind === 'response'
                              ? `“${event.query}” · 200 OK`
                              : kind === 'state'
                                ? `${event.items?.length ?? 0} suggestions`
                                : event.requestId === 'A'
                                  ? 'Request A begins'
                                  : 'Request B begins'}
                        </small>
                      </button>
                      {kind === 'response' && (
                        <div className="cut-clip-reorder">
                          <button
                            aria-label={`Move response ${event.requestId} earlier`}
                            disabled={busy || order[0] === event.requestId}
                            onClick={swap}
                          >
                            <ArrowUp size={10} />
                          </button>
                          <button
                            aria-label={`Move response ${event.requestId} later`}
                            disabled={busy || order[1] === event.requestId}
                            onClick={swap}
                          >
                            <ArrowDown size={10} />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          ))}
          {related && (
            <svg
              className="cut-causality"
              viewBox="0 0 100 210"
              preserveAspectRatio="none"
              aria-label="Observed response-to-state link"
            >
              <path
                d={`M ${position(run.events.find((event) => event.id === related))} 100 C ${position(run.events.find((event) => event.id === related))} 150, ${position(run.events.find((event) => event.causedBy === related))} 125, ${position(run.events.find((event) => event.causedBy === related))} 180`}
              />
            </svg>
          )}
        </div>
      </div>
      <div className="cut-timeline-foot">
        <span>
          <i />
          Shared playhead <b>·</b> Select an event to inspect its evidence
        </span>
        <span>
          <span className="cut-causal-key" />
          Observed response → UI commit
        </span>
      </div>
    </section>
  )
}
