import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ArrowUpRight, FlaskConical } from 'lucide-react'
import { motion } from 'motion/react'
import type { Accent, TestStatus } from '../types/experiment'

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 25 : 31}
      height={small ? 25 : 31}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <path d="M18 3 32 11v14l-14 8L4 25V11L18 3Z" stroke="#a999ff" strokeWidth="1.6" />
      <path d="m18 9 9 5v9l-9 5-9-5v-9l9-5Z" stroke="#c9c0ff" strokeWidth="1.6" />
      <path d="m4 11 14 8 14-8M18 19v14M9 14l18 9M27 14 9 23" stroke="#8977dd" strokeWidth="1.2" />
      <path d="m18 9 9 5-9 5-9-5 9-5Z" fill="#b5a6ff" fillOpacity=".24" />
    </svg>
  )
}

export function Button({
  children,
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  children: ReactNode
}) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function IconButton({
  children,
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button className={`icon-button ${className}`} title={label} aria-label={label} {...props}>
      {children}
    </button>
  )
}

export function Badge({
  children,
  tone = 'muted',
}: {
  children: ReactNode
  tone?: Accent | 'muted' | 'green' | 'amber' | 'red'
}) {
  return <span className={`badge tone-${tone}`}>{children}</span>
}

export function MockNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`mock-notice ${compact ? 'compact' : ''}`}>
      <FlaskConical size={14} />
      <span>
        {compact
          ? 'SAMPLE EXPERIMENT'
          : 'Demo workspace · All strategies, code changes, and test results are hand-authored examples. No AI or code execution.'}
      </span>
    </div>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <motion.div
      className="section-heading"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>
          {title}
          <span className="title-period">.</span>
        </h1>
        <p>{description}</p>
      </div>
      {action}
    </motion.div>
  )
}

export function FutureGlyph({
  accent,
  letter,
  large = false,
}: {
  accent: Accent
  letter: string
  large?: boolean
}) {
  return <span className={`future-glyph tone-${accent} ${large ? 'large' : ''}`}>{letter}</span>
}

export function Status({ status }: { status: TestStatus }) {
  return (
    <span className={`test-status ${status}`}>
      <span />
      {status === 'pending' ? 'Pending' : status === 'passed' ? 'Passed' : 'Failed'}
    </span>
  )
}

export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} />
    </button>
  )
}
