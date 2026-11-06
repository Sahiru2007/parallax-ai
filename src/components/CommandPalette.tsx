import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Command, Search, X } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import type { Experiment, Screen } from '../types/experiment'
import { IconButton } from './ui'

const destinations: { label: string; screen: Screen; detail: string }[] = [
  { label: 'Dashboard', screen: 'dashboard', detail: 'Workspace overview' },
  {
    label: 'Future Explorer',
    screen: 'explorer',
    detail: 'Explore three possible implementations',
  },
  { label: 'Behavioral Contracts', screen: 'contracts', detail: 'Edit acceptance conditions' },
  { label: 'Mission Control', screen: 'mission', detail: 'Review the example plan' },
  {
    label: 'Development Timeline',
    screen: 'timeline',
    detail: 'Trace the hypothetical experiment',
  },
  {
    label: 'Evidence Inspector',
    screen: 'evidence',
    detail: 'Compare test fixtures and code excerpts',
  },
  { label: 'Settings', screen: 'settings', detail: 'Make this workspace yours' },
]

export function CommandPalette({ experiment }: { experiment: Experiment }) {
  const { commandOpen, setCommandOpen, navigate, selectFuture } = useAppStore()
  const [query, setQuery] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (commandOpen) {
      dialogRef.current?.showModal()
      inputRef.current?.focus()
    } else dialogRef.current?.close()
  }, [commandOpen])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(!useAppStore.getState().commandOpen)
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [setCommandOpen])
  const results = [
    ...destinations.map((item) => ({
      label: item.label,
      detail: item.detail,
      run: () => navigate(item.screen),
    })),
    ...experiment.futures.map((future) => ({
      label: `Future ${future.letter} · ${future.title}`,
      detail: 'Open in Future Explorer',
      run: () => {
        selectFuture(future.id)
        navigate('explorer')
      },
    })),
  ].filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <dialog
      ref={dialogRef}
      className="command-dialog"
      onCancel={() => setCommandOpen(false)}
      onClose={() => {
        setCommandOpen(false)
        setQuery('')
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) setCommandOpen(false)
      }}
      aria-label="Search PARALLAX"
    >
      <div className="command-input">
        <Search size={20} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Where do you want to go?"
          aria-label="Search screens and futures"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && results[0]) {
              results[0].run()
              setCommandOpen(false)
            }
          }}
        />
        <IconButton label="Close search" onClick={() => setCommandOpen(false)}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="command-results">
        {results.length ? (
          results.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.run()
                setCommandOpen(false)
              }}
            >
              <Command size={16} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))
        ) : (
          <p className="empty-state">No destinations match “{query}”.</p>
        )}
      </div>
      <div className="command-footer">
        <span>Navigate your development multiverse</span>
        <kbd>esc</kbd> to close
      </div>
    </dialog>
  )
}
