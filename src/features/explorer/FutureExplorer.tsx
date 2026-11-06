import { useMemo } from 'react'
import { useReducedMotion } from 'motion/react'
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  ArrowRight,
  Check,
  CircleDashed,
  Crosshair,
  GitBranch,
  Layers2,
  LockKeyhole,
  Maximize,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'
import { Badge, Button, FutureGlyph, IconButton, MockNotice } from '../../components/ui'
import type { Experiment, Future } from '../../types/experiment'

type ObjectiveNode = Node<{ objective: string }, 'objective'>
type FutureNode = Node<{ future: Future; active: boolean; preferred: boolean }, 'future'>
type MultiverseNode = ObjectiveNode | FutureNode

function ObjectiveCard({ data }: NodeProps<ObjectiveNode>) {
  return (
    <div className="objective-node">
      <div className="objective-node-top">
        <span className="objective-icon">
          <Crosshair size={21} />
        </span>
        <span className="eyebrow">THE OBJECTIVE</span>
        <Badge>01</Badge>
      </div>
      <h3>{data.objective}</h3>
      <div className="objective-node-footer">
        <GitBranch size={13} />
        <span>One intent. Multiple possibilities.</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function FutureCard({ data }: NodeProps<FutureNode>) {
  const { future, active, preferred } = data
  const passed = future.tests.filter((test) => test.status === 'passed').length
  return (
    <div className={`future-node accent-${future.accent} ${active ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="future-node-top">
        <FutureGlyph accent={future.accent} letter={future.letter} />
        <span className="eyebrow">FUTURE {future.letter}</span>
        {preferred ? (
          <span className="node-selected">
            <Check size={12} />
            Preferred
          </span>
        ) : (
          <span className="node-kind">PROPOSAL</span>
        )}
      </div>
      <h3>{future.title}</h3>
      <p>{future.subtitle}</p>
      <div className="node-architecture">
        {future.id === 'jwt' ? (
          <LockKeyhole size={14} />
        ) : future.id === 'sessions' ? (
          <Layers2 size={14} />
        ) : (
          <ShieldCheck size={14} />
        )}
        <span>{future.architecture}</span>
      </div>
      <div className="future-node-footer">
        <span>
          <span className="mini-dot" />
          {passed}/{future.tests.length} sample checks
        </span>
        <span>
          {future.files.length} files <ArrowRight size={13} />
        </span>
      </div>
    </div>
  )
}

function BranchEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath({ ...props, borderRadius: 24, offset: 42 })
  return (
    <>
      <BaseEdge path={path} style={props.style} />
      <circle r="3" fill={props.style?.stroke?.toString() ?? '#a695ff'}>
        <animateMotion dur="7s" repeatCount="indefinite" path={path} />
      </circle>
    </>
  )
}

const nodeTypes = { objective: ObjectiveCard, future: FutureCard }
const edgeTypes = { branch: BranchEdge }

function ExplorerCanvas({ experiment }: { experiment: Experiment }) {
  const { selectedFuture, preferredFuture, selectFuture, showGrid, navigate, reduceMotion } =
    useAppStore()
  const flow = useReactFlow<MultiverseNode>()
  const prefersReducedMotion = useReducedMotion()
  const motionDisabled = reduceMotion || prefersReducedMotion
  const nodes = useMemo<MultiverseNode[]>(
    () => [
      {
        id: 'objective',
        ariaLabel: `Development objective: ${experiment.objective}`,
        type: 'objective',
        position: { x: 35, y: 180 },
        data: { objective: experiment.objective },
        selectable: false,
        draggable: false,
      },
      ...experiment.futures.map((future, index): FutureNode => ({
        id: future.id,
        ariaLabel: `Future ${future.letter}: ${future.title}. Press Enter or Space to inspect.`,
        type: 'future',
        position: { x: 410, y: index * 208 },
        selected: selectedFuture === future.id,
        data: {
          future,
          active: selectedFuture === future.id,
          preferred: preferredFuture === future.id,
        },
      })),
    ],
    [experiment, selectedFuture, preferredFuture],
  )
  const edges = useMemo<Edge[]>(
    () =>
      experiment.futures.map((future) => ({
        id: `to-${future.id}`,
        source: 'objective',
        target: future.id,
        type: motionDisabled ? 'smoothstep' : 'branch',
        style: {
          stroke: future.id === selectedFuture ? `var(--${future.accent})` : '#34364f',
          strokeWidth: future.id === selectedFuture ? 1.8 : 1.2,
        },
      })),
    [experiment, selectedFuture, motionDisabled],
  )
  return (
    <div className="explorer-canvas">
      <div className="canvas-topline">
        <span>
          <span className="live-dot" />
          DEVELOPMENT MULTIVERSE
        </span>
        <span>3 ALTERNATIVE PATHS</span>
      </div>
      <ReactFlow<MultiverseNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          if (node.type === 'future') selectFuture(node.data.future.id)
        }}
        onKeyDown={(event) => {
          const element = (event.target as HTMLElement).closest('.react-flow__node')
          const future = experiment.futures.find(
            (item) => item.id === element?.getAttribute('data-id'),
          )
          if ((event.key === 'Enter' || event.key === ' ') && future) {
            event.preventDefault()
            selectFuture(future.id)
          }
        }}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.35}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        attributionPosition="top-right"
        colorMode="dark"
        aria-label="Development multiverse: one objective branches into three selectable authentication strategies"
      >
        {showGrid && (
          <Background variant={BackgroundVariant.Dots} color="#33364c" gap={22} size={1} />
        )}
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          nodeColor={(node) =>
            node.id === 'objective'
              ? '#55566a'
              : node.id === 'jwt'
                ? '#9b87ee'
                : node.id === 'sessions'
                  ? '#5dc8c4'
                  : '#6b9be8'
          }
          maskColor="#0b0d17bf"
          pannable
          zoomable
          ariaLabel="Multiverse minimap"
        />
      </ReactFlow>
      <div className="canvas-fit">
        <IconButton
          label="Fit all futures in view"
          onClick={() => {
            void flow.fitView({ duration: motionDisabled ? 0 : 400, padding: 0.12 })
          }}
        >
          <Maximize size={15} />
        </IconButton>
      </div>
      <div className="canvas-hint">
        <ScanLine size={13} />
        <span>
          Scroll to pan <b>·</b> Pinch to zoom <b>·</b> Select a future to inspect
        </span>
      </div>
      <div className="canvas-legend">
        <span className="legend-line" />
        Possible implementation <CircleDashed size={12} /> Sample evidence
      </div>
      <button className="canvas-compare" onClick={() => navigate('evidence')}>
        Compare all three <ArrowRight size={14} />
      </button>
    </div>
  )
}

export function FutureExplorer({ experiment }: { experiment: Experiment }) {
  const navigate = useAppStore((state) => state.navigate)
  return (
    <div className="explorer-screen">
      <div className="explorer-heading">
        <div>
          <div className="eyebrow">EXPLORE THE POSSIBILITIES</div>
          <h1>
            Future Explorer<span className="title-period">.</span>
          </h1>
          <p>One objective. Three paths forward. Your decision.</p>
        </div>
        <Button onClick={() => navigate('evidence')}>
          <Layers2 size={15} />
          Compare futures
          <ArrowRight size={14} />
        </Button>
      </div>
      <div className="experiment-toolbar">
        <div className="experiment-name">
          <GitBranch size={16} />
          <span>{experiment.name}</span>
          <Badge>{experiment.id}</Badge>
        </div>
        <MockNotice compact />
      </div>
      <ReactFlowProvider>
        <ExplorerCanvas experiment={experiment} />
      </ReactFlowProvider>
      <div className="explorer-footer">
        <Sparkles size={14} />
        <span>Better decisions begin with more than one possibility.</span>
        <span className="mono">PHASE 01 / FOUNDATION</span>
      </div>
    </div>
  )
}
