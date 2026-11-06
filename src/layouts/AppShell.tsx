import { useState, type ReactNode } from 'react'
import {
  Activity,
  ArrowUpRight,
  Boxes,
  ChevronDown,
  ChevronRight,
  Command,
  Compass,
  FileCheck2,
  FolderGit2,
  GitBranch,
  History,
  LayoutDashboard,
  ListChecks,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { Badge, IconButton, Logo } from '../components/ui'
import { CommandPalette } from '../components/CommandPalette'
import { ActivityPanel } from './ActivityPanel'
import { FutureInspector } from '../features/explorer/FutureInspector'
import type { Experiment, Screen } from '../types/experiment'

const navigation = [
  { screen: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { screen: 'explorer', label: 'Future Explorer', icon: GitBranch },
  { screen: 'contracts', label: 'Behavioral Contracts', icon: FileCheck2 },
  { screen: 'mission', label: 'Mission Control', icon: Compass },
  { screen: 'timeline', label: 'Development Timeline', icon: History },
  { screen: 'evidence', label: 'Evidence Inspector', icon: ListChecks },
] satisfies { screen: Screen; label: string; icon: typeof LayoutDashboard }[]

export function AppShell({
  children,
  experiment,
}: {
  children: ReactNode
  experiment: Experiment
}) {
  const {
    screen,
    navigate,
    sidebarCollapsed,
    toggleSidebar,
    inspectorOpen,
    toggleInspector,
    activityOpen,
    toggleActivity,
    setCommandOpen,
  } = useAppStore()
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="app-topbar">
        <div className="brand">
          <Logo />
          <span>
            PARALLAX<span className="brand-ai">AI</span>
          </span>
          <span className="brand-version">PREVIEW</span>
        </div>
        <div className="topbar-divider" />
        <div className="workspace-label">
          <FolderGit2 size={14} />
          <span>{experiment.workspace}</span>
          <ChevronRight size={12} />
          <span className="muted">Development workspace</span>
        </div>
        <button
          className="global-search"
          aria-label="Search anything"
          onClick={() => setCommandOpen(true)}
        >
          <Search size={14} />
          <span>Search anything...</span>
          <kbd>Ctrl K</kbd>
        </button>
        <span className="topbar-local">
          <span className="live-dot" />
          Local workspace
        </span>
        <div className="avatar" title="Local developer">
          P
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar" aria-label="Main navigation">
          <div className="sidebar-workspace">
            <button
              onClick={() => setWorkspaceOpen(!workspaceOpen)}
              aria-expanded={workspaceOpen}
              title="Workspace information"
              aria-label="Workspace information"
            >
              <span className="workspace-avatar">
                <Boxes size={18} />
              </span>
              <span className="workspace-text">
                <strong>Personal workspace</strong>
                <small>Local environment</small>
              </span>
              <ChevronDown size={13} />
            </button>
            {workspaceOpen && (
              <div className="workspace-popover">
                <strong>Personal workspace</strong>
                <p>
                  One local demo project. Filesystem connections and project switching are planned
                  for a future phase.
                </p>
                <Badge tone="violet">PHASE 1</Badge>
              </div>
            )}
          </div>
          <div className="nav-label">WORKSPACE</div>
          <nav>
            {navigation.map(({ screen: target, label, icon: Icon }) => (
              <button
                key={target}
                className={`nav-item ${screen === target ? 'active' : ''}`}
                onClick={() => navigate(target)}
                title={label}
                aria-label={label}
                aria-current={screen === target ? 'page' : undefined}
              >
                <Icon size={18} />
                <span>{label}</span>
                {target === 'explorer' && <span className="nav-count">3</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-project">
            <div className="nav-label">ACTIVE EXPERIMENT</div>
            <button
              className="active-experiment"
              onClick={() => navigate('explorer')}
              title="Authentication experiment"
            >
              <span className="mini-dot" />
              <span>
                Authentication revamp<small>{experiment.id} · 3 futures</small>
              </span>
            </button>
          </div>
          <div className="sidebar-bottom">
            <div className="phase-card">
              <span>
                <Sparkles size={16} />A new dimension of building
              </span>
              <p>
                Explore possibilities.
                <br />
                Build with intention.
              </p>
              <div>
                <span>FOUNDATION RELEASE</span>
                <ArrowUpRight size={13} />
              </div>
            </div>
            <button
              className={`nav-item ${screen === 'settings' ? 'active' : ''}`}
              onClick={() => navigate('settings')}
              title="Settings"
              aria-label="Settings"
            >
              <Settings2 size={18} />
              <span>Settings</span>
            </button>
            <div className="sidebar-collapse">
              <span className="mono">v0.1.0-alpha</span>
              <IconButton
                label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={toggleSidebar}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </IconButton>
            </div>
          </div>
        </aside>
        <div className="workspace-main">
          <div className="workspace-breadcrumb">
            <div>
              <span className="breadcrumb-symbol">⌘</span>
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>
                {screen === 'settings'
                  ? 'Settings'
                  : navigation.find((item) => item.screen === screen)?.label}
              </strong>
            </div>
            <div>
              <Badge tone="violet">
                <FlaskIcon />
                MOCK DATA
              </Badge>
              <IconButton
                label={activityOpen ? 'Hide activity panel' : 'Show activity panel'}
                aria-pressed={activityOpen}
                onClick={toggleActivity}
              >
                <PanelBottom size={16} />
              </IconButton>
              <IconButton
                label={inspectorOpen ? 'Hide future inspector' : 'Show future inspector'}
                aria-pressed={inspectorOpen}
                onClick={toggleInspector}
              >
                <PanelRight size={16} />
              </IconButton>
            </div>
          </div>
          <div className="workspace-content">
            <main id="main-content">{children}</main>
            {inspectorOpen && <FutureInspector experiment={experiment} />}
          </div>
          <ActivityPanel experiment={experiment} />
        </div>
      </div>
      <footer className="statusbar">
        <div>
          <span className="status-brand">
            <Logo small />
            PARALLAX
          </span>
          <span>
            <GitBranch size={12} />
            local / demo
          </span>
          <span className="status-demo">Hand-authored sample data</span>
        </div>
        <div>
          <span>
            <Activity size={12} />
            Agent disconnected
          </span>
          <button onClick={() => setCommandOpen(true)}>
            <Command size={12} />
            Command palette
          </button>
          <span className="status-phase">PHASE 01</span>
        </div>
      </footer>
      <CommandPalette experiment={experiment} />
    </div>
  )
}

function FlaskIcon() {
  return <span className="badge-dot" />
}
