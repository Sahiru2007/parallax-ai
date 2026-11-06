import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  Crosshair,
  Eye,
  FlaskConical,
  GitBranch,
  ShieldCheck,
} from 'lucide-react'
import { Badge, Button, SectionHeading } from '../../components/ui'
import { useAppStore } from '../../stores/useAppStore'

const steps = [
  {
    title: 'Understand the objective',
    type: 'Planning',
    status: 'Illustrated',
    icon: Crosshair,
    description:
      'Identify the current account model, legacy password behavior, and the desired authentication guarantees.',
    result:
      'Sample output: preserve user IDs, password compatibility, roles, and account recovery.',
  },
  {
    title: 'Define behavioral contracts',
    type: 'Requirements',
    status: 'Editable',
    icon: ClipboardCheck,
    description: 'Write observable acceptance conditions before comparing implementations.',
    result: 'Five editable sample conditions are available in Behavioral Contracts.',
  },
  {
    title: 'Branch into possible futures',
    type: 'Architecture',
    status: 'Illustrated',
    icon: GitBranch,
    description:
      'Consider JWT, server-side sessions, and managed identity as independent implementation strategies.',
    result: 'Three hand-authored alternatives with proposed files, dependencies, and tradeoffs.',
  },
  {
    title: 'Verify each implementation',
    type: 'Verification',
    status: 'Not executed',
    icon: ShieldCheck,
    description:
      'In a future phase, isolated runners could evaluate implementations against shared contracts.',
    result: 'No runner exists in Phase 1. The Evidence Inspector contains example fixtures only.',
  },
  {
    title: 'Review evidence and decide',
    type: 'Human review',
    status: 'Your move',
    icon: Eye,
    description: 'Compare the sample evidence and record which future you prefer.',
    result:
      'A preferred future is a local annotation. It does not apply code or accept an implementation.',
  },
]

export function MissionControl() {
  const [active, setActive] = useState(2)
  const navigate = useAppStore((state) => state.navigate)
  const selected = steps[active]
  return (
    <div className="page-scroll">
      <SectionHeading
        eyebrow="MISSION CONTROL"
        title="Intent into action"
        description="A transparent plan, with the developer in command."
      />
      <div className="mission-banner">
        <div>
          <span className="eyebrow">MISSION / AUTHENTICATION REVAMP</span>
          <h2>
            Preserve trust.
            <br />
            Explore a stronger foundation.
          </h2>
        </div>
        <Badge tone="amber">
          <CircleDashed size={12} />
          PROTOTYPE PLAN
        </Badge>
      </div>
      <div className="info-banner">
        <FlaskConical size={17} />
        <p>
          This is a sample execution plan. Selecting a step reveals its description; it never starts
          an agent or runs code.
        </p>
      </div>
      <div className="subsection-heading">
        <h2>Mission sequence</h2>
        <span className="muted mono">05 STEPS</span>
      </div>
      <div className="mission-steps">
        {steps.map((step, index) => (
          <button
            key={step.title}
            className={`mission-step ${active === index ? 'selected' : ''}`}
            onClick={() => setActive(index)}
            aria-pressed={active === index}
          >
            <span className={`mission-step-number ${index < 3 ? 'illustrated' : ''}`}>
              {index < 2 ? <Check size={15} /> : String(index + 1).padStart(2, '0')}
            </span>
            <step.icon size={19} />
            <span>
              <strong>{step.title}</strong>
              <small>{step.type}</small>
            </span>
            <Badge
              tone={
                step.status === 'Not executed' ? 'amber' : active === index ? 'violet' : 'muted'
              }
            >
              {step.status}
            </Badge>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
      <div className="mission-detail">
        <div className="eyebrow">STEP {String(active + 1).padStart(2, '0')} / CONTEXT</div>
        <h3>{selected.title}</h3>
        <p>{selected.description}</p>
        <div className="mission-result">
          <ClipboardCheck size={17} />
          <p>{selected.result}</p>
        </div>
        <Button
          onClick={() =>
            navigate(active === 1 ? 'contracts' : active === 2 ? 'explorer' : 'evidence')
          }
        >
          {active === 1
            ? 'Open contract studio'
            : active === 2
              ? 'Explore the futures'
              : 'Review example evidence'}
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  )
}
