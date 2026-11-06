import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CheckCheck,
  Crosshair,
  FileCheck2,
  GitBranch,
  Layers2,
  Orbit,
} from 'lucide-react'
import {
  Badge,
  Button,
  FutureGlyph,
  MockNotice,
  SectionHeading,
  TextLink,
} from '../../components/ui'
import { useAppStore } from '../../stores/useAppStore'
import type { Experiment } from '../../types/experiment'

export function Dashboard({ experiment }: { experiment: Experiment }) {
  const { navigate, selectFuture, contracts, preferredFuture } = useAppStore()
  return (
    <div className="page-scroll">
      <SectionHeading
        eyebrow="YOUR DEVELOPMENT COMMAND CENTER"
        title="A wider perspective"
        description="Explore what could be. Decide what comes next."
      />
      <div className="dashboard-hero">
        <div className="hero-copy">
          <Badge tone="violet">
            <Orbit size={12} />
            DEVELOPMENT MULTIVERSE
          </Badge>
          <h2>
            One idea.
            <br />
            <span>Possible futures.</span>
          </h2>
          <p>
            Great software starts with a choice.
            <br />
            See the alternatives before you commit.
          </p>
          <Button variant="primary" onClick={() => navigate('explorer')}>
            Enter Future Explorer
            <ArrowRight size={16} />
          </Button>
        </div>
        <div className="orbital-art" aria-hidden="true">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <div className="orbit-ring ring-three" />
          <div className="orbit-core">
            <Boxes size={37} />
          </div>
          <span className="orbit-satellite satellite-a">A</span>
          <span className="orbit-satellite satellite-b">B</span>
          <span className="orbit-satellite satellite-c">C</span>
          <span className="orbit-caption">EXPLORE / COMPARE / DECIDE</span>
        </div>
      </div>
      <div className="metric-grid">
        <div className="metric-card">
          <span>
            <GitBranch size={16} />
            Possible futures
          </span>
          <strong>
            03<small>one objective</small>
          </strong>
          <div className="metric-track">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="metric-card">
          <span>
            <FileCheck2 size={16} />
            Active contracts
          </span>
          <strong>
            {String(contracts.filter((item) => item.enabled).length).padStart(2, '0')}
            <small>of {contracts.length} conditions</small>
          </strong>
          <div className="metric-track cyan">
            <i
              style={{
                width: `${(contracts.filter((item) => item.enabled).length / contracts.length) * 100}%`,
              }}
            />
          </div>
        </div>
        <div className="metric-card">
          <span>
            <CheckCheck size={16} />
            Your decision
          </span>
          <strong className="decision-metric">
            {preferredFuture
              ? `Future ${experiment.futures.find((item) => item.id === preferredFuture)?.letter}`
              : 'Open'}
            <small>{preferredFuture ? 'local preference saved' : 'review the possibilities'}</small>
          </strong>
          <div className="metric-track blue">
            <i style={{ width: preferredFuture ? '100%' : '20%' }} />
          </div>
        </div>
      </div>
      <div className="subsection-heading">
        <h2>Recent project</h2>
        <Badge>LOCAL DEMO</Badge>
      </div>
      <button className="project-card" onClick={() => navigate('explorer')}>
        <span className="project-icon">
          <Boxes size={24} />
        </span>
        <span>
          <strong>{experiment.workspace}</strong>
          <small>Authentication, reimagined · {experiment.id}</small>
        </span>
        <Badge tone="violet">3 futures</Badge>
        <ArrowUpRight size={19} />
      </button>
      <div className="subsection-heading">
        <h2>Continue exploring</h2>
        <TextLink onClick={() => navigate('evidence')}>Compare evidence</TextLink>
      </div>
      <div className="future-shortcuts">
        {experiment.futures.map((future) => (
          <button
            key={future.id}
            className={`shortcut-card accent-${future.accent}`}
            onClick={() => {
              selectFuture(future.id)
              navigate('explorer')
            }}
          >
            <FutureGlyph accent={future.accent} letter={future.letter} />
            <h3>{future.title}</h3>
            <p>{future.subtitle}</p>
            <span>
              Explore future <ArrowUpRight size={15} />
            </span>
          </button>
        ))}
      </div>
      <div className="quick-actions">
        <button onClick={() => navigate('contracts')}>
          <Crosshair size={19} />
          <span>
            <strong>Define success</strong>
            <small>Shape your behavioral contracts</small>
          </span>
          <ArrowRight size={16} />
        </button>
        <button onClick={() => navigate('mission')}>
          <Layers2 size={19} />
          <span>
            <strong>See the plan</strong>
            <small>Review the sample mission</small>
          </span>
          <ArrowRight size={16} />
        </button>
      </div>
      <MockNotice />
    </div>
  )
}
