import { useState } from 'react'
import {
  Check,
  CheckCheck,
  ChevronDown,
  FileCheck2,
  Pencil,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react'
import { Badge, Button, SectionHeading } from '../../components/ui'
import { useAppStore } from '../../stores/useAppStore'
import { demoExperiment } from '../../mocks/experiment'
import type { Contract } from '../../types/experiment'

function ContractEditor({ contract, index }: { contract: Contract; index: number }) {
  const updateContract = useAppStore((state) => state.updateContract)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(contract.condition)
  return (
    <article className={`contract-card ${contract.enabled ? 'enabled' : ''}`}>
      <div className="contract-card-heading">
        <label className="contract-checkbox">
          <input
            type="checkbox"
            checked={contract.enabled}
            onChange={(event) => updateContract(contract.id, { enabled: event.target.checked })}
            aria-label={`Enable ${contract.title}`}
          />
          <span>
            <Check size={13} />
          </span>
        </label>
        <span className="contract-index mono">{String(index + 1).padStart(2, '0')}</span>
        <h3>{contract.title}</h3>
        <Badge
          tone={
            contract.category === 'Security'
              ? 'cyan'
              : contract.category === 'Compatibility'
                ? 'violet'
                : 'blue'
          }
        >
          {contract.category}
        </Badge>
      </div>
      <div className="contract-condition">
        <div className="eyebrow">ACCEPTANCE CONDITION</div>
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim()) {
                updateContract(contract.id, { condition: draft.trim() })
                setEditing(false)
              }
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={`Acceptance condition for ${contract.title}`}
              maxLength={1000}
              required
              autoFocus
            />
            <div className="editor-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft(contract.condition)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!draft.trim()}>
                <Save size={13} />
                Save condition
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p>{contract.condition}</p>
            <button
              className="edit-condition"
              onClick={() => {
                setDraft(contract.condition)
                setEditing(true)
              }}
            >
              <Pencil size={12} />
              Edit condition
            </button>
          </>
        )}
      </div>
    </article>
  )
}

export function ContractStudio() {
  const { contracts, updateContract } = useAppStore()
  const [filter, setFilter] = useState('All conditions')
  const enabled = contracts.filter((item) => item.enabled).length
  const filtered = contracts.filter(
    (item) =>
      filter === 'All conditions' ||
      (filter === 'Active only' ? item.enabled : item.category === filter),
  )
  return (
    <div className="page-scroll">
      <SectionHeading
        eyebrow="BEHAVIORAL CONTRACT STUDIO"
        title="Define what matters"
        description="Set the conditions every possible future should satisfy."
      />
      <div className="contract-summary">
        <div className="summary-icon">
          <ShieldCheck size={25} />
        </div>
        <div>
          <h2>Authentication compatibility</h2>
          <p>A shared definition of success across all three futures.</p>
        </div>
        <div className="contract-progress">
          <strong>
            {enabled}
            <span> / {contracts.length}</span>
          </strong>
          <small>conditions active</small>
        </div>
      </div>
      <div className="info-banner">
        <FileCheck2 size={17} />
        <p>
          Edits are saved in this browser. Sample test evidence remains fixed and is not
          re-evaluated when conditions change.
        </p>
      </div>
      <div className="list-toolbar">
        <span>
          <CheckCheck size={15} />
          {enabled} active conditions
        </span>
        <label className="select-wrap">
          <select
            aria-label="Filter contracts"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {['All conditions', 'Active only', 'Security', 'Compatibility', 'Experience'].map(
              (item) => (
                <option key={item}>{item}</option>
              ),
            )}
          </select>
          <ChevronDown size={13} />
        </label>
      </div>
      <div className="contract-list">
        {filtered.length ? (
          filtered.map((contract) => (
            <ContractEditor
              key={`${contract.id}:${contract.condition}`}
              contract={contract}
              index={contracts.indexOf(contract)}
            />
          ))
        ) : (
          <p className="empty-state">
            No active conditions. Enable a condition from “All conditions”.
          </p>
        )}
      </div>
      <div className="contract-footer">
        <span>
          <Check size={14} />
          Saved locally as you work
        </span>
        <Button
          variant="ghost"
          onClick={() =>
            demoExperiment.contracts.forEach((item) =>
              updateContract(item.id, { condition: item.condition, enabled: item.enabled }),
            )
          }
        >
          <RotateCcw size={13} />
          Restore sample conditions
        </Button>
      </div>
    </div>
  )
}
