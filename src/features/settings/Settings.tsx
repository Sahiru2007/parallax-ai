import { useState } from 'react'
import { Check, Database, FlaskConical, Monitor, RotateCcw, ShieldCheck } from 'lucide-react'
import { Badge, Button, SectionHeading } from '../../components/ui'
import { useAppStore } from '../../stores/useAppStore'

export function Settings() {
  const {
    showGrid,
    setShowGrid,
    reduceMotion,
    setReduceMotion,
    sidebarCollapsed,
    toggleSidebar,
    resetPreferences,
  } = useAppStore()
  const [reset, setReset] = useState(false)
  return (
    <div className="page-scroll settings-page">
      <SectionHeading
        eyebrow="WORKSPACE SETTINGS"
        title="Make space for focus"
        description="A few considered controls for your command center."
      />
      <section className="settings-section">
        <h2>
          <Monitor size={18} />
          Appearance & interaction
        </h2>
        <SettingRow
          title="Canvas grid"
          description="Show the subtle dot grid in Future Explorer."
          checked={showGrid}
          onChange={setShowGrid}
        />
        <SettingRow
          title="Reduce motion"
          description="Pause decorative motion and use immediate transitions."
          checked={reduceMotion}
          onChange={setReduceMotion}
        />
        <SettingRow
          title="Compact navigation"
          description="Collapse the sidebar to its icon rail."
          checked={sidebarCollapsed}
          onChange={toggleSidebar}
        />
      </section>
      <section className="settings-section">
        <h2>
          <Database size={18} />
          Local data
        </h2>
        <div className="settings-info">
          <strong>This is your browser's workspace</strong>
          <p>
            Contract edits, display preferences, and your preferred future are stored in local
            storage. They are not synced to an account or written to a backend.
          </p>
          <Button
            onClick={() => {
              resetPreferences()
              setReset(true)
            }}
          >
            {reset ? <Check size={14} /> : <RotateCcw size={14} />}{' '}
            {reset ? 'Sample defaults restored' : 'Restore sample defaults'}
          </Button>
          <span className="sr-only" role="status">
            {reset ? 'Preferences and contract conditions have been restored.' : ''}
          </span>
        </div>
      </section>
      <section className="settings-section">
        <h2>
          <ShieldCheck size={18} />
          Runtime & capabilities
        </h2>
        <div className="capability-row">
          <span>Data source</span>
          <Badge tone="violet">
            <FlaskConical size={12} />
            HAND-AUTHORED MOCKS
          </Badge>
        </div>
        <div className="capability-row">
          <span>AI integration</span>
          <span className="muted">Not connected</span>
        </div>
        <div className="capability-row">
          <span>Code execution & sandboxing</span>
          <span className="muted">Not implemented</span>
        </div>
        <div className="capability-row">
          <span>Native shell</span>
          <span className="muted">Tauri 2 · React · TypeScript</span>
        </div>
      </section>
      <div className="about-parallax">
        <span className="eyebrow">PARALLAX AI / PHASE 01</span>
        <p>More possibilities. Better decisions.</p>
        <span className="mono muted">v0.1.0-alpha · Foundation preview</span>
      </div>
    </div>
  )
}

function SettingRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={title}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}
