import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm, realpath, lstat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type {
  CodingSession,
  CodingCandidate,
  CodingCheck,
  CommandApproval,
} from '../shared/coding.ts'
import type { ToolEvent } from '../shared/investigation.ts'
import { command, git } from './process.ts'
import { createWorktree, safeRead } from './worktrees.ts'
import {
  inspectRepo,
  sourceSnapshot,
  saveTree,
  loadTree,
  diffSnapshot,
  writablePath,
  applyCandidate,
} from './coding-files.ts'
import { runCodingProvider } from './coding-provider.ts'
import { runProjectBatch, saveScenario, type ReplayHost } from './project-replay-engine.ts'
import { validateScenario, replayOrder } from '../shared/project-replay.ts'
import type { ModelSelection } from '../shared/providers.ts'
import type { ProviderSettingsStore } from './provider-settings.ts'
import type { ProviderRun } from '../shared/providers.ts'
import {
  RecoveryRequired,
  type AgentCheckpoint,
  type Continuation,
  type ToolReceipt,
} from './continuation.ts'
import { redactSecrets } from './provider-secrets.ts'

interface Runtime {
  state: CodingSession
  dir: string
  abort: AbortController
  persistence: Promise<void>
  task?: Promise<void>
  baseline: Map<string, Buffer>
  approval?: (allow: boolean) => void
  proposalOnly?: boolean
  checkpoint?: AgentCheckpoint
  checkpointRun?: ProviderRun
  checkpointWrites?: Promise<void>
  activeTool?: ToolReceipt
  executionTurn?: number
}
export class CodingEngine {
  base: string
  providers?: ProviderSettingsStore
  sessions = new Map<string, Runtime>()
  updates = new EventEmitter()
  constructor(base: string, providers?: ProviderSettingsStore) {
    this.base = base
    this.providers = providers
  }
  async restore() {
    await mkdir(this.base, { recursive: true })
    for (const id of await readdir(this.base)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue
      try {
        const dir = join(this.base, id)
        const state = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')) as CodingSession
        if (state.id !== id) continue
        if (state.busy) {
          state.busy = false
          state.status = 'interrupted'
          state.activity = 'Interrupted by runner restart'
          state.error =
            'This turn was interrupted. Your candidate edits and earlier evidence are retained. Use Resume to continue the AI turn after inspection.'
          state.approval = undefined
          for (const run of state.projectReplay?.runs ?? [])
            if (run.status === 'running') {
              run.status = 'cancelled'
              run.error = 'Replay interrupted by runner restart; no completed assertion.'
            }
          for (const run of state.providerRuns ?? [])
            if (run.status === 'running') {
              run.status = 'interrupted'
              run.resumable = true
              const previous = run.recovery
              run.recovery = {
                ...previous,
                kind: 'restart',
                waiting: false,
                message:
                  'AI turn interrupted by runner restart. Retained tools will be inspected on Resume.' +
                  (previous ? ` Previous provider status: ${previous.message}` : ''),
              }
            }
          for (const check of state.checks.filter((c) => c.status === 'running')) {
            check.status = 'skipped'
            check.output += '\nInterrupted by runner restart; not verified.'
          }
        }
        state.sequence++
        const runtime: Runtime = {
          state,
          dir,
          abort: new AbortController(),
          persistence: Promise.resolve(),
          baseline: await loadTree(join(dir, 'baseline')),
        }
        this.sessions.set(id, runtime)
        // Inspect actual retained source, including writes that preceded the last checkpoint.
        for (const candidate of state.candidates)
          await this.refresh(runtime, candidate).catch((error) => {
            state.error = `Candidate preparation was interrupted: ${error instanceof Error ? error.message : String(error)}`
          })
        await this.persist(runtime)
      } catch {
        /* A session is acknowledged only after its initial durable baseline exists. */
      }
    }
  }
  state(id: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Coding session not found.')
    return runtime.state
  }
  list() {
    return [...this.sessions.values()]
      .map((r) => r.state)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  active() {
    return [...this.sessions.values()].some((r) => r.state.busy)
  }
  changed(runtime: Runtime) {
    runtime.state.sequence++
    this.updates.emit(runtime.state.id, runtime.state)
    void this.persist(runtime).catch(() => {})
  }
  log(runtime: Runtime, kind: ToolEvent['kind'], title: string, detail = '') {
    runtime.state.events.push({
      id: runtime.state.events.length + 1,
      at: new Date().toISOString(),
      kind,
      title,
      detail,
    })
    this.changed(runtime)
  }
  async persist(runtime: Runtime) {
    const contents = JSON.stringify(runtime.state, null, 2)
    runtime.persistence = runtime.persistence
      .catch(() => {})
      .then(async () => {
        await mkdir(runtime.dir, { recursive: true })
        await writeFile(join(runtime.dir, 'session.tmp'), contents)
        await rename(join(runtime.dir, 'session.tmp'), join(runtime.dir, 'session.json'))
      })
    await runtime.persistence
  }
  async start(
    path: string,
    task: string,
    provider: 'live' | 'test',
    compare: boolean,
    investigation = false,
    modelSelection?: ModelSelection,
    sequential = false,
  ) {
    if (this.active()) throw new Error('Wait for the active coding turn to stop.')
    const repo = await inspectRepo(path)
    const snapshot = await sourceSnapshot(repo.path)
    // Snapshot capture is read-only; recheck the lock after asynchronous repository inspection.
    if (this.active()) throw new Error('A coding turn is already active.')
    const id = randomUUID(),
      dir = join(this.base, id)
    const state: CodingSession = {
      id,
      sequence: 0,
      repo,
      baseline: { revision: snapshot.revision, digest: snapshot.digest, dirty: snapshot.dirty },
      provider,
      modelSelection: modelSelection ? structuredClone(modelSelection) : undefined,
      providerRuns: [],
      compare,
      investigation,
      sequential,
      generation: compare && sequential ? { turn: 1, queued: ['b'] } : undefined,
      status: 'running',
      activity: 'Preparing isolated worktree',
      busy: true,
      turn: 1,
      createdAt: new Date().toISOString(),
      messages: [{ role: 'user', content: task, turn: 1 }],
      events: [],
      checks: [],
      candidates: [],
    }
    const runtime: Runtime = {
      state,
      dir,
      abort: new AbortController(),
      persistence: Promise.resolve(),
      baseline: snapshot.files,
    }
    this.sessions.set(id, runtime)
    try {
      await saveTree(join(dir, 'baseline'), snapshot.files)
      for (const candidateId of compare ? ['a', 'b'] : ['a']) {
        const candidate: CodingCandidate = {
          id: candidateId,
          name: compare ? `Approach ${candidateId.toUpperCase()}` : 'Implementation',
          worktree: join(dir, 'worktrees', candidateId),
          digest: snapshot.digest,
          patch: '',
          files: [],
        }
        state.candidates.push(candidate)
      }
      this.log(
        runtime,
        'command',
        'Captured baseline',
        `${repo.path}\nBranch ${repo.branch}\nRevision ${snapshot.revision}\nSHA256 ${snapshot.digest}\n${snapshot.dirty ? 'Includes local source edits' : 'Clean checkout'}`,
      )
      await this.persist(runtime)
      runtime.task = (async () => {
        for (const candidate of state.candidates) {
          this.log(runtime, 'worktree', `Creating ${candidate.name}`, candidate.worktree)
          await createWorktree(repo.path, candidate.worktree, snapshot, runtime.abort.signal, {
            linkDependencies: false,
          })
        }
        if (investigation) {
          state.busy = false
          state.status = 'ready'
          state.activity = 'Investigation ready — configure and save a replay scenario'
          this.changed(runtime)
          await this.persist(runtime)
        } else await this.turn(runtime, compare && sequential ? ['a'] : undefined)
      })().catch((error) => this.failed(runtime, error))
    } catch (error) {
      await this.failed(runtime, error)
    }
    return state
  }
  async refresh(runtime: Runtime, candidate: CodingCandidate, afterStop = false) {
    const current = await sourceSnapshot(
      candidate.worktree,
      afterStop ? undefined : runtime.abort.signal,
    )
    if (candidate.digest === current.digest) return current
    const diff = await diffSnapshot(
      runtime.baseline,
      current,
      join(runtime.dir, 'diffs', candidate.id, randomUUID()),
    )
    Object.assign(candidate, diff, { digest: current.digest })
    this.changed(runtime)
    return current
  }
  async instructions(runtime: Runtime, candidate: CodingCandidate) {
    const snapshot = await sourceSnapshot(candidate.worktree, runtime.abort.signal)
    const parts: string[] = []
    let ancestor = dirname(runtime.state.repo.path)
    while (true) {
      const file = join(ancestor, 'AGENTS.md')
      const text = await readFile(file, 'utf8').catch(() => '')
      if (text) parts.unshift(`${file}\n${text.slice(0, 50_000)}`)
      if (dirname(ancestor) === ancestor) break
      ancestor = dirname(ancestor)
    }
    for (const [path, data] of snapshot.files)
      if (/(^|\/)AGENTS\.md$/i.test(path)) parts.push(`${path}\n${data.toString('utf8')}`)
    if (snapshot.files.has('package.json'))
      parts.push(`package.json\n${snapshot.files.get('package.json')!.toString('utf8')}`)
    const text =
      parts.join('\n\n').slice(0, 150_000) ||
      'No AGENTS.md or package.json found. Inspect the repository for its build/test instructions.'
    this.log(runtime, 'read', `${candidate.name} · repository instructions`, text)
    return text
  }
  async turn(runtime: Runtime, candidateIds?: string[], resumeRun?: ProviderRun) {
    const state = runtime.state
    for (const candidate of state.candidates.filter(
      (c) => !candidateIds || candidateIds.includes(c.id),
    )) {
      runtime.abort.signal.throwIfAborted()
      await this.refresh(runtime, candidate)
      let instructions = await this.instructions(runtime, candidate)
      instructions += `\nExisting candidate patch (continue from these edits):\n${candidate.patch.slice(0, 40_000)}\nPrior executable evidence:\n${JSON.stringify(
        state.checks
          .filter((c) => c.candidate === candidate.id)
          .slice(-8)
          .map((c) => ({
            command: c.command,
            status: c.status,
            digest: c.digest,
            output: c.output.slice(-3000),
          })),
      )}`
      instructions +=
        '\nDependency directories are not linked to the original checkout. If needed, request approval to install dependencies into this worktree.'
      if (state.projectReplay?.saved)
        instructions += `\nSaved browser scenario (immutable fixtures/assertion): ${JSON.stringify(state.projectReplay.saved)}\nActual replay evidence: ${JSON.stringify(state.projectReplay.runs.slice(-9))}\nUse run_replay to test your current candidate against the saved scenario. Propose changes with propose_replay for user review; never weaken the assertion to claim a fix. Request cancellation or altered request counts produce coverage differences, not equivalent verification.`
      if (state.compare)
        instructions += `\nCompare approaches is enabled. Use a materially distinct approach for ${candidate.name}. ${candidate.id === 'b' ? `Approach A patch for reference:\n${state.candidates[0].patch}` : ''}`
      const selection = resumeRun ?? state.modelSelection
      if (!resumeRun && state.provider === 'live' && selection && this.providers)
        this.providers.assertReady(selection)
      const providerRun: ProviderRun | undefined =
        resumeRun ??
        (selection && state.provider === 'live'
          ? {
              ...selection,
              id: randomUUID(),
              turn: state.turn,
              candidate: candidate.id,
              startedAt: new Date().toISOString(),
              status: 'running' as const,
            }
          : undefined)
      if (providerRun && !resumeRun) {
        state.providerRuns ??= []
        state.providerRuns.push(providerRun)
      }
      const recorded = providerRun
      runtime.executionTurn = recorded?.turn ?? state.turn
      let continuation: Continuation | undefined
      if (recorded) {
        recorded.status = 'running'
        recorded.resumable = true
        continuation = await this.attachCheckpoint(
          runtime,
          candidate,
          recorded,
          instructions,
          Boolean(resumeRun),
        )
      }
      let streamEvent: ToolEvent | undefined
      const apiKey =
        selection && selection.provider !== 'ollama' && this.providers
          ? await this.providers.key(selection.provider)
          : undefined
      await runCodingProvider({
        selection,
        apiKey,
        baseURL: this.providers?.openaiBase,
        geminiBaseURL: this.providers?.geminiBase,
        continuation,
        onRound: (round, limit) => {
          streamEvent = undefined
          if (recorded) {
            recorded.rounds = round
            recorded.maxToolRounds = limit
          }
          state.activity = `${selection?.provider ?? 'Model'} · agent round ${round}/${limit}`
          this.changed(runtime)
        },
        onUsage: (usage) => {
          if (recorded) {
            recorded.usage ??= {}
            for (const key of Object.keys(usage) as (keyof typeof usage)[]) {
              const value = usage[key]
              if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
                recorded.usage[key] = (recorded.usage[key] ?? 0) + value
            }
            this.changed(runtime)
          }
        },
        onDelta: (text) => {
          if (!text) return
          if (!streamEvent) {
            this.log(runtime, 'agent', `${candidate.name} · streamed model response`, '')
            streamEvent = state.events.at(-1)!
          }
          streamEvent.detail = ((streamEvent.detail ?? '') + text).slice(-150000)
          this.changed(runtime)
        },
        onModel: (model) => {
          if (recorded) {
            recorded.actualModel = model
            this.changed(runtime)
          }
        },
        mode: state.provider,
        task:
          (resumeRun?.legacyRecovery
            ? 'Finish only the unfinished part of this retained candidate. Do not regenerate either candidate or repeat completed edits/checks. Original task: '
            : '') +
          state.messages
            .filter((m) => m.role === 'user' && m.turn === (recorded?.turn ?? state.turn))
            .at(-1)!.content,
        history: state.messages
          .filter((m) => m.turn < (recorded?.turn ?? state.turn))
          .map(({ role, content }) => ({ role, content })),
        turn: state.turn,
        candidate: candidate.name,
        candidateId: candidate.id,
        instructions,
        signal: runtime.abort.signal,
        onText: (text) => {
          state.messages.push({
            role: 'assistant',
            content: text,
            turn: recorded?.turn ?? state.turn,
          })
          this.log(
            runtime,
            'agent',
            `${candidate.name} · ${state.provider === 'test' ? 'test provider' : 'model'}`,
            text,
          )
        },
        execute: (name, args, key) => {
          if (recorded && (!key || !runtime.checkpoint?.ledger.some((call) => call.key === key))) {
            recorded.toolCalls = (recorded.toolCalls ?? 0) + 1
            this.changed(runtime)
          }
          return continuation && key
            ? this.durableTool(runtime, candidate, name, args, key)
            : this.tool(runtime, candidate, name, args)
        },
      }).then(
        () => {
          if (recorded) {
            recorded.status = 'completed'
            recorded.resumable = false
            recorded.recovery = undefined
          }
        },
        (error) => {
          if (recorded) {
            recorded.status = 'interrupted'
            recorded.recovery =
              error instanceof RecoveryRequired
                ? error.info
                : {
                    ...(runtime.abort.signal.aborted ? recorded.recovery : {}),
                    waiting: false,
                    kind: runtime.abort.signal.aborted ? 'cancelled' : 'provider',
                    message: error instanceof Error ? error.message : String(error),
                  }
            recorded.recoveryHistory ??= []
            recorded.recoveryHistory.push({
              ...recorded.recovery,
              waiting: false,
              at: new Date().toISOString(),
            })
          }
          throw error
        },
      )
      runtime.checkpoint = undefined
      runtime.checkpointRun = undefined
      runtime.activeTool = undefined
      await this.refresh(runtime, candidate)
      for (const kind of ['build', 'test'])
        if (
          !state.checks.some(
            (c) =>
              c.candidate === candidate.id &&
              c.turn === state.turn &&
              new RegExp(kind, 'i').test(c.command),
          )
        ) {
          state.checks.push({
            id: randomUUID(),
            candidate: candidate.id,
            turn: state.turn,
            command: `Project ${kind} (not run)`,
            cwd: candidate.worktree,
            digest: candidate.digest,
            status: 'skipped',
            output: `No project ${kind} command was executed in this turn. Inspect repository instructions for the applicable command.`,
          })
        }
    }
    runtime.abort.signal.throwIfAborted()
    state.busy = false
    state.status = 'ready'
    state.activity = 'Ready for review or a follow-up'
    this.changed(runtime)
    await this.persist(runtime)
  }
  async attachCheckpoint(
    runtime: Runtime,
    candidate: CodingCandidate,
    run: ProviderRun,
    instructions: string,
    resuming: boolean,
  ): Promise<Continuation> {
    let checkpoint: AgentCheckpoint | undefined
    const file = join(runtime.dir, `agent-${run.id}.json`)
    try {
      checkpoint = JSON.parse(await readFile(file, 'utf8')) as AgentCheckpoint
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new RecoveryRequired({
          kind: 'uncertain',
          message:
            'Agent checkpoint could not be read. Inspect the retained work before starting another instruction.',
        })
      if (run.checkpointed) {
        run.resumable = false
        throw new RecoveryRequired({
          kind: 'uncertain',
          message:
            'The acknowledged agent checkpoint is missing. Exact resume is unavailable; inspect the retained patch and checks.',
        })
      }
    }
    if (!checkpoint) {
      checkpoint = {
        version: 1,
        rounds: resuming ? (run.rounds ?? 0) : 0,
        allowance: run.maxToolRounds ?? 12,
        ledger: [],
        sourceDigest: candidate.digest,
        requests: run.requests ?? run.rounds ?? 0,
        proposalOnly: runtime.proposalOnly,
        retry: { attempts: 0, totalAttempts: 0, allowanceWaitMs: 0, totalWaitMs: 0 },
      }
      if (resuming) {
        run.legacyRecovery = true
        checkpoint.recoveryNote =
          instructions +
          '\nLegacy recovery: exact prior provider messages were not checkpointed. The current patch and completed checks above are retained evidence. Inspect the current files, do not repeat completed edits/checks, and finish only the unfinished work.'
        for (const check of runtime.state.checks.filter(
          (c) => c.candidate === candidate.id && c.turn === run.turn && c.exitCode !== undefined,
        )) {
          const split = check.command.indexOf(' '),
            executable = check.command.slice(0, split)
          try {
            const args = (check.command.slice(split + 1).match(/"(?:\\.|[^"\\])*"/g) ?? []).map(
              (part) => JSON.parse(part) as string,
            )
            if (`${executable} ${args.map((a) => JSON.stringify(a)).join(' ')}` !== check.command)
              continue
            checkpoint.ledger.push({
              key: `legacy-${check.id}`,
              name: 'run_command',
              args: {
                executable,
                args,
                cwd: relative(candidate.worktree, check.cwd).replaceAll('\\', '/') || '.',
              },
              status: 'completed',
              beforeDigest: check.digest,
              afterDigest: check.digest,
              result: check,
              checkId: check.id,
            })
          } catch {
            /* Unparseable old commands are shown as evidence, never reconstructed for execution. */
          }
        }
      }
    }
    if (checkpoint.version !== 1 || !Array.isArray(checkpoint.ledger))
      throw new Error('Unsupported agent checkpoint. Retained files remain available.')
    runtime.checkpoint = checkpoint
    runtime.checkpointRun = run
    runtime.proposalOnly = checkpoint.proposalOnly
    run.checkpointed = true
    const c: Continuation = {
      state: checkpoint,
      save: () => this.saveCheckpoint(runtime),
      onRecovery: (info) => {
        run.recovery = info
        runtime.state.activity = info.waiting
          ? `Waiting to retry ${run.provider}: attempt ${info.attempt}/${info.maxRetries}; cancel any time`
          : info.message
        this.changed(runtime)
      },
    }
    await c.save()
    return c
  }
  async saveCheckpoint(runtime: Runtime) {
    const checkpoint = runtime.checkpoint,
      run = runtime.checkpointRun
    if (!checkpoint || !run) return
    run.requests = checkpoint.requests
    run.autoRetries = checkpoint.retry.totalAttempts
    run.waitedMs = checkpoint.retry.totalWaitMs
    run.calls = checkpoint.ledger.map((call) => ({
      id: call.key,
      name: call.name,
      status: call.status,
      detail:
        call.inspected ??
        (call.reusedFrom
          ? `Reused durable receipt ${call.reusedFrom}; operation not executed again.`
          : undefined),
      approval: call.approval
        ? call.approval.decision === undefined
          ? 'Awaiting decision'
          : call.approval.decision
            ? 'Approved'
            : 'Denied'
        : undefined,
      approvalHistory: call.approvalHistory?.map((a) => ({
        id: a.id,
        command: `${a.executable} ${a.args.map((v) => JSON.stringify(v)).join(' ')}`,
        cwd: a.cwd,
        decision: a.decision === undefined ? 'awaiting' : a.decision ? 'approved' : 'denied',
      })),
    }))
    const content = redactSecrets(JSON.stringify(checkpoint))
    runtime.checkpointWrites = (runtime.checkpointWrites ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const file = join(runtime.dir, `agent-${run.id}.json`)
        await writeFile(file + '.tmp', content)
        await rename(file + '.tmp', file)
        await this.persist(runtime)
      })
    await runtime.checkpointWrites
    this.changed(runtime)
  }
  async durableTool(
    runtime: Runtime,
    candidate: CodingCandidate,
    name: string,
    args: Record<string, unknown>,
    key: string,
  ): Promise<unknown> {
    const cp = runtime.checkpoint!
    await this.refresh(runtime, candidate)
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    let call = cp.ledger.find((entry) => entry.key === key)
    if (call && (call.name !== name || !same(call.args, args)))
      throw new RecoveryRequired({
        kind: 'uncertain',
        message:
          'A retained tool identity does not match its arguments. Inspect the work before proceeding.',
      })
    if (call?.status === 'completed') {
      this.log(runtime, 'agent', `Reused completed ${name}`, `Tool ${key}; no operation repeated.`)
      return call.result
    }
    if (call && (call.status === 'running' || call.status === 'uncertain')) {
      const recovered = await this.inspectTool(runtime, candidate, call)
      if (recovered === 'uncertain')
        throw new RecoveryRequired({
          kind: 'uncertain',
          message:
            'A tool has an uncertain outcome. Review the inspection and choose skip or an explicitly approved rerun.',
        })
      if (recovered === 'completed') return call.result
    }
    if (!call) {
      // A model can request the same command again after a lost response. Reuse its receipt
      // only in this logical turn and at the same observed source revision.
      const cached = cp.ledger.find(
        (entry) =>
          entry.status === 'completed' &&
          entry.name === name &&
          same(entry.args, args) &&
          entry.afterDigest === candidate.digest,
      )
      if (cached && ['run_command', 'write_file', 'delete_file', 'run_replay'].includes(name)) {
        call = { ...cached, key, reusedFrom: cached.key }
        cp.ledger.push(call)
        await this.saveCheckpoint(runtime)
        this.log(
          runtime,
          'agent',
          `Reused completed ${name}`,
          'The matching operation already has a durable result at this source revision.',
        )
        return call.result
      }
      call = { key, name, args, status: 'prepared', beforeDigest: candidate.digest }
      cp.ledger.push(call)
      await this.saveCheckpoint(runtime)
    }
    if (
      call.beforeDigest !== candidate.digest &&
      ['write_file', 'delete_file', 'run_command', 'run_replay'].includes(name)
    ) {
      call.status = 'uncertain'
      call.inspected = `Source changed before this retained operation. Current SHA256 ${candidate.digest}. Inspect the file diff before deciding.`
      await this.saveCheckpoint(runtime)
      throw new RecoveryRequired({ kind: 'uncertain', message: call.inspected })
    }
    runtime.activeTool = call
    call.status = 'running'
    await this.saveCheckpoint(runtime)
    try {
      if (
        name === 'write_file' &&
        typeof args.path === 'string' &&
        typeof args.content === 'string'
      ) {
        const path = await writablePath(candidate.worktree, args.path)
        if ((await readFile(path, 'utf8').catch(() => null)) === args.content) {
          call.result = { path: args.path, digest: candidate.digest, unchanged: true }
        } else call.result = await this.tool(runtime, candidate, name, args)
      } else call.result = await this.tool(runtime, candidate, name, args)
      call.status = 'completed'
      call.afterDigest = candidate.digest
      cp.sourceDigest = candidate.digest
      await this.saveCheckpoint(runtime)
      return call.result
    } catch (error) {
      if (
        name === 'run_command' &&
        call.checkId &&
        runtime.state.checks.find((c) => c.id === call.checkId)?.exitCode === undefined
      ) {
        call.status = 'uncertain'
        await this.saveCheckpoint(runtime)
        throw new RecoveryRequired({
          kind: 'uncertain',
          message:
            'The command stopped without a durable exit result. Inspect its output and source before deciding whether to skip or explicitly rerun.',
        })
      }
      if (runtime.abort.signal.aborted || error instanceof RecoveryRequired) {
        if (call.status === 'running') call.status = 'uncertain'
        await this.saveCheckpoint(runtime)
        throw error
      }
      call.result = { error: error instanceof Error ? error.message : String(error) }
      call.status = 'completed'
      call.afterDigest = candidate.digest
      await this.saveCheckpoint(runtime)
      return call.result
    } finally {
      runtime.activeTool = undefined
    }
  }
  async inspectTool(runtime: Runtime, candidate: CodingCandidate, call: ToolReceipt) {
    await this.refresh(runtime, candidate)
    const safeReads = [
      'read_instructions',
      'list_files',
      'search_files',
      'read_file',
      'inspect_diff',
      'inspect_replay',
    ]
    if (safeReads.includes(call.name)) {
      call.status = 'prepared'
      call.beforeDigest = candidate.digest
      await this.saveCheckpoint(runtime)
      return 'prepared' as const
    }
    let result: unknown
    if (call.name === 'write_file' || call.name === 'delete_file') {
      const path = await writablePath(candidate.worktree, String(call.args.path))
      const content = await readFile(path, 'utf8').catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      if (
        (call.name === 'write_file' && content === call.args.content) ||
        (call.name === 'delete_file' && content === null)
      )
        result = { path: call.args.path, digest: candidate.digest, recoveredByInspection: true }
    }
    const check = runtime.state.checks.find((item) => item.id === call.checkId)
    if (
      call.name === 'run_command' &&
      check?.exitCode !== undefined &&
      ['passed', 'failed'].includes(check.status)
    )
      result = check
    if (result !== undefined) {
      call.status = 'completed'
      call.result = result
      call.afterDigest = candidate.digest
      call.inspected = `Recovered completed result by inspecting retained state at SHA256 ${candidate.digest}; no tool repeated.`
      await this.saveCheckpoint(runtime)
      return 'completed' as const
    }
    let alive = false
    if (call.processId) {
      try {
        process.kill(call.processId, 0)
        alive = true
      } catch {
        /* Process ended or cannot be observed. */
      }
    }
    call.status = 'uncertain'
    call.inspected = `Inspected source SHA256 ${candidate.digest}, ${candidate.files.length} changed files. ${check ? `Recorded check: ${check.status}; ${check.output.slice(-1500)}` : 'No durable completed check receipt.'} ${call.processId ? `Process ${call.processId}: ${alive ? 'may still be running; verify before rerunning' : 'not observed running'}.` : ''} Outcome is not verified. Review the actual diff and output.`
    await this.saveCheckpoint(runtime)
    return 'uncertain' as const
  }
  async resolveTool(id: string, runId: string, callKey: string, action: string) {
    const runtime = this.sessions.get(id)
    if (!runtime || this.active())
      throw new Error('Stop the current operation before resolving uncertain work.')
    const run = runtime.state.providerRuns?.find((r) => r.id === runId)
    if (!run) throw new Error('AI turn not found.')
    if (runtime.state.providerRuns?.some((r) => r.candidate === run.candidate && r.turn > run.turn))
      throw new Error('Inspect the latest AI turn for this candidate before resolving work.')
    runtime.state.busy = true
    this.changed(runtime)
    try {
      runtime.abort = new AbortController()
      const candidate = runtime.state.candidates.find((c) => c.id === run.candidate)!
      await this.attachCheckpoint(runtime, candidate, run, '', true)
      const call = runtime.checkpoint!.ledger.find((c) => c.key === callKey)
      if (!call || call.status !== 'uncertain')
        throw new Error('This tool no longer requires inspection.')
      const inspected = await this.inspectTool(runtime, candidate, call)
      if (inspected !== 'completed') {
        if (action === 'skip') {
          call.status = 'completed'
          call.afterDigest = candidate.digest
          call.result = {
            status: 'uncertain',
            error:
              'User inspected retained state and skipped this operation. It was not rerun and its outcome must not be claimed as passed.',
            inspection: call.inspected,
          }
        } else if (action === 'rerun') {
          if (call.processId) {
            try {
              process.kill(call.processId, 0)
              throw new Error(
                'The old process may still be running. Verify it has stopped before requesting a rerun.',
              )
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
            }
          }
          call.status = 'prepared'
          call.beforeDigest = candidate.digest
          call.approval = undefined
          call.checkId = undefined
        } else throw new Error('Choose skip or a new approved rerun after inspection.')
      }
      run.recovery = {
        kind: 'uncertain',
        message:
          action === 'rerun'
            ? 'Inspection acknowledged. Resume will request fresh command approval before rerunning.'
            : 'Inspection acknowledged. Resume will return the retained outcome without repeating the operation.',
      }
      await this.saveCheckpoint(runtime)
      await this.persist(runtime)
      return runtime.state
    } finally {
      runtime.checkpoint = undefined
      runtime.checkpointRun = undefined
      runtime.state.busy = false
      this.changed(runtime)
      await this.persist(runtime)
    }
  }
  async resume(id: string, runId: string, additional?: number) {
    const runtime = this.sessions.get(id)
    if (!runtime || this.active()) throw new Error('Wait for active work to stop before resuming.')
    const run = runtime.state.providerRuns?.find((r) => r.id === runId)
    if (!run || run.status === 'completed' || run.resumable === false)
      throw new Error('This AI turn cannot be resumed.')
    if (runtime.state.providerRuns?.some((r) => r.candidate === run.candidate && r.turn > run.turn))
      throw new Error(
        'A newer instruction exists for this candidate. Resume its latest AI turn or send a new follow-up after review.',
      )
    if (Boolean(run.testDouble) !== Boolean(this.providers?.state.testTransport))
      throw new Error(
        "Restore this turn's original provider configuration before resuming. No provider switch is allowed.",
      )
    const candidate = runtime.state.candidates.find((c) => c.id === run.candidate)
    if (!candidate) throw new Error('Retained worktree is unavailable.')
    const previousStatus = runtime.state.status
    runtime.state.busy = true
    runtime.state.status = 'running'
    runtime.state.activity = 'Inspecting retained work before resume'
    this.changed(runtime)
    try {
      runtime.abort = new AbortController()
      await this.refresh(runtime, candidate)
      const instructions =
        (await this.instructions(runtime, candidate)) +
        `\nRetained patch:\n${candidate.patch}\nCompleted tool/check results:\n${JSON.stringify(runtime.state.checks.filter((c) => c.candidate === candidate.id && c.turn === run.turn))}`
      await this.attachCheckpoint(runtime, candidate, run, instructions, true)
      const cp = runtime.checkpoint!
      if (cp.sourceDigest !== candidate.digest)
        cp.inspection = `Resume inspection: retained worktree source is now ${candidate.digest}. Inspect these current changes and preserve unrelated edits; completed receipts refer to their recorded source digests. Current patch:\n${candidate.patch.slice(0, 40000)}`
      cp.sourceDigest = candidate.digest
      if (cp.retry.notBefore && cp.retry.notBefore > Date.now())
        throw new Error(
          `Provider retry guidance requires waiting until ${new Date(cp.retry.notBefore).toISOString()}. No request was sent.`,
        )
      if (additional !== undefined) {
        if (!Number.isInteger(additional) || additional < 1 || additional > 24)
          throw new Error('Additional allowance must be 1 to 24 rounds.')
        cp.allowance = cp.rounds + additional
      } else if (cp.rounds >= cp.allowance)
        throw new Error(
          'The configured round allowance was reached. Explicitly add a bounded allowance to continue.',
        )
      cp.retry.attempts = 0
      cp.retry.allowanceWaitMs = 0
      runtime.abort = new AbortController()
      runtime.state.busy = true
      runtime.state.status = 'running'
      runtime.state.error = undefined
      run.continuations = (run.continuations ?? 0) + 1
      this.log(
        runtime,
        'user',
        `Resume ${candidate.name}`,
        `Same ${run.provider} / ${run.model}; retained worktree. ${cp.allowance - cp.rounds} rounds available. Completed receipts will be reused.`,
      )
      await this.saveCheckpoint(runtime)
      runtime.task = this.turn(runtime, [candidate.id], run).catch((error) =>
        this.failed(runtime, error),
      )
      return runtime.state
    } catch (error) {
      runtime.state.busy = false
      runtime.state.status = previousStatus
      runtime.state.error = error instanceof Error ? error.message : String(error)
      this.changed(runtime)
      await this.persist(runtime)
      throw error
    }
  }
  async tool(
    runtime: Runtime,
    candidate: CodingCandidate,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    runtime.abort.signal.throwIfAborted()
    const root = candidate.worktree
    if (
      runtime.proposalOnly &&
      ['write_file', 'delete_file', 'run_command', 'run_replay'].includes(name)
    )
      throw new Error(
        'Scenario proposal is read-only. Return propose_replay for user review before changing code or running commands.',
      )
    if (name === 'propose_replay') {
      const scenario = validateScenario(JSON.parse(String(args.scenario)))
      runtime.state.projectReplay ??= { order: [], orderRevision: 0, runs: [] }
      runtime.state.projectReplay.proposal = scenario
      this.log(
        runtime,
        'agent',
        'Replay scenario proposed — review before saving',
        JSON.stringify(scenario, null, 2),
      )
      return { proposed: true, requiresUserReview: true }
    }
    if (name === 'inspect_replay') return runtime.state.projectReplay ?? { runs: [] }
    if (name === 'run_replay')
      return runProjectBatch(this.replayHost(runtime), [candidate.id], args.order)
    if (name === 'read_instructions') return this.instructions(runtime, candidate)
    if (name === 'list_files' || name === 'search_files') {
      const snapshot = await sourceSnapshot(root, runtime.abort.signal)
      const result =
        name === 'list_files'
          ? [...snapshot.files.keys()]
          : [...snapshot.files]
              .flatMap(([path, data]) =>
                data
                  .toString('utf8')
                  .split('\n')
                  .flatMap((line, i) =>
                    line.includes(String(args.query))
                      ? [`${path}:${i + 1}: ${line.slice(0, 500)}`]
                      : [],
                  ),
              )
              .slice(0, 200)
      this.log(runtime, 'read', `${candidate.name} · ${name}`, result.join('\n'))
      return result
    }
    if (name === 'read_file') {
      await writablePath(root, String(args.path))
      const content = await safeRead(root, String(args.path))
      this.log(runtime, 'read', `${candidate.name} · ${args.path}`, content)
      return content
    }
    if (name === 'write_file' || name === 'delete_file') {
      const path = await writablePath(root, String(args.path))
      if (name === 'write_file') {
        if (typeof args.content !== 'string' || args.content.length > 200_000)
          throw new Error('Write content must be text under 200 KB.')
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, args.content)
      } else await rm(path)
      this.log(runtime, 'patch', `${candidate.name} · ${name} ${args.path}`)
      await this.refresh(runtime, candidate)
      return { path: args.path, digest: candidate.digest }
    }
    if (name === 'inspect_diff') {
      await this.refresh(runtime, candidate)
      this.log(runtime, 'patch', `${candidate.name} · actual diff`, candidate.patch)
      return candidate.patch
    }
    if (name === 'run_command') return this.runCommand(runtime, candidate, args)
    throw new Error(`Unknown repository tool: ${name}`)
  }
  async runCommand(runtime: Runtime, candidate: CodingCandidate, args: Record<string, unknown>) {
    if (
      typeof args.executable !== 'string' ||
      !Array.isArray(args.args) ||
      !args.args.every((a) => typeof a === 'string') ||
      typeof args.cwd !== 'string'
    )
      throw new Error('Command requires executable, string args, and relative cwd.')
    if (
      !['node', 'npm', 'npx', 'python', 'python3', 'pytest', 'cargo', 'go', 'dotnet'].includes(
        args.executable,
      )
    )
      throw new Error(
        'Use a supported build/test executable without a shell. Git mutations and shell interpreters are excluded.',
      )
    const cwd =
      args.cwd === '.' ? candidate.worktree : await writablePath(candidate.worktree, args.cwd)
    const actual = await realpath(cwd)
    if (relative(candidate.worktree, actual).startsWith('..'))
      throw new Error('Command cwd must stay inside the worktree.')
    let detail =
      'This project command can execute repository code. Approval is for this invocation only.'
    if (args.executable === 'npm' && args.args[0] === 'run') {
      const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
      }
      const script = String(args.args[1])
      detail +=
        '\n' +
        [`pre${script}`, script, `post${script}`]
          .map((name) => `${name}: ${manifest.scripts?.[name] ?? '(none)'}`)
          .join('\n')
    }
    await this.refresh(runtime, candidate)
    const request = {
      id: randomUUID(),
      candidate: candidate.id,
      executable: args.executable,
      args: args.args as string[],
      cwd,
      detail,
    }
    const approvedDigest = candidate.digest
    const approved = await this.askApproval(runtime, request)
    const check: CodingCheck = {
      id: request.id,
      candidate: candidate.id,
      turn: runtime.executionTurn ?? runtime.state.turn,
      command: `${request.executable} ${request.args.map((a) => JSON.stringify(a)).join(' ')}`,
      cwd,
      digest: candidate.digest,
      status: approved ? 'running' : 'skipped',
      output: approved ? '' : 'Skipped: command approval was denied.',
    }
    runtime.state.checks.push(check)
    if (runtime.activeTool) runtime.activeTool.checkId = check.id
    this.changed(runtime)
    if (!approved) return check
    await this.refresh(runtime, candidate)
    if (candidate.digest !== approvedDigest) {
      check.status = 'skipped'
      check.output =
        'Source changed while awaiting approval. Request this command again to review its current script.'
      this.changed(runtime)
      return check
    }
    if (runtime.activeTool) {
      runtime.activeTool.status = 'running'
      await this.saveCheckpoint(runtime)
    }
    runtime.state.activity = `Running ${check.command}`
    this.log(runtime, 'command', `${candidate.name} · ${check.command}`, `cwd: ${cwd}`)
    const event = runtime.state.events.at(-1)!
    let executable = request.executable,
      argv = request.args
    if (executable === 'node') executable = process.execPath
    if (request.executable === 'npm' || request.executable === 'npx') {
      executable = process.execPath
      const npmPath =
        process.env.npm_execpath ??
        join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
      argv = [
        request.executable === 'npm' ? npmPath : join(dirname(npmPath), 'npx-cli.js'),
        ...argv,
      ]
    }
    try {
      const result = await command(cwd, executable, argv, runtime.abort.signal, {
        onSpawn: (pid) => {
          if (runtime.activeTool) {
            runtime.activeTool.processId = pid
            void this.saveCheckpoint(runtime).catch(() => {})
          }
        },
        onOutput: (chunk) => {
          check.output = (check.output + chunk).slice(-150_000)
          event.detail = `cwd: ${cwd}\n${check.output}`
          this.changed(runtime)
        },
      })
      Object.assign(check, result, { status: result.exitCode === 0 ? 'passed' : 'failed' })
    } catch (error) {
      check.status = runtime.abort.signal.aborted ? 'skipped' : 'failed'
      check.output += `\n${error instanceof Error ? error.message : String(error)}`
      throw error
    } finally {
      await this.refresh(runtime, candidate).catch(() => {})
      this.changed(runtime)
    }
    await this.persist(runtime)
    return check
  }
  approve(id: string, requestId: string, allow: boolean) {
    const runtime = this.sessions.get(id)
    if (!runtime?.approval || runtime.state.approval?.id !== requestId)
      throw new Error('This command approval is no longer pending.')
    runtime.approval(allow)
  }
  async askApproval(runtime: Runtime, request: CommandApproval) {
    runtime.abort.signal.throwIfAborted()
    const allowed = new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        runtime.approval = undefined
        reject(new Error('Turn cancelled while waiting for approval.'))
      }
      runtime.approval = (allow) => {
        runtime.abort.signal.removeEventListener('abort', abort)
        runtime.approval = undefined
        runtime.state.approval = undefined
        this.changed(runtime)
        resolve(allow)
      }
      runtime.abort.signal.addEventListener('abort', abort, { once: true })
    })
    // An abort can arrive during the durable checkpoint below, before the await.
    void allowed.catch(() => {})
    runtime.state.approval = request
    runtime.state.activity = 'Waiting for command approval'
    try {
      if (runtime.activeTool) {
        runtime.activeTool.status = 'awaiting-approval'
        runtime.activeTool.approval = { ...request }
        runtime.activeTool.approvalHistory ??= []
        runtime.activeTool.approvalHistory.push(runtime.activeTool.approval)
        await this.saveCheckpoint(runtime)
        runtime.abort.signal.throwIfAborted()
      }
      this.log(
        runtime,
        'command',
        'Approval required',
        `${request.executable} ${request.args.join(' ')}\ncwd: ${request.cwd}\n${request.detail}`,
      )
      const decision = await allowed
      if (runtime.activeTool) {
        runtime.activeTool.approval!.decision = decision
        runtime.activeTool.status =
          runtime.activeTool.name === 'run_command' ? 'prepared' : 'running'
        await this.saveCheckpoint(runtime)
      }
      return decision
    } finally {
      runtime.state.approval = undefined
      this.changed(runtime)
    }
  }
  async replaySource(runtime: Runtime, version: string) {
    if (version === 'baseline') {
      const target = join(runtime.dir, 'worktrees/baseline')
      if (!(await lstat(join(target, '.git')).catch(() => null))) {
        const headFiles = (
          await git(
            runtime.state.repo.path,
            ['ls-tree', '-r', '--name-only', '-z', runtime.state.baseline.revision],
            runtime.abort.signal,
          )
        )
          .split(String.fromCharCode(0))
          .filter(Boolean)
        this.log(runtime, 'worktree', 'Creating replay Baseline', target)
        await createWorktree(
          runtime.state.repo.path,
          target,
          {
            revision: runtime.state.baseline.revision,
            dirty: runtime.state.baseline.dirty,
            digest: runtime.state.baseline.digest,
            files: runtime.baseline,
            headFiles,
          },
          runtime.abort.signal,
          { linkDependencies: false },
        )
      }
      const current = await sourceSnapshot(target, runtime.abort.signal)
      if (current.digest !== runtime.state.baseline.digest)
        throw new Error(
          'Baseline worktree no longer matches the captured source. Start a fresh investigation to avoid testing a modified baseline.',
        )
      runtime.state.projectReplay!.baselineWorktree = target
      return { worktree: target, digest: current.digest }
    }
    const candidate = runtime.state.candidates.find((c) => c.id === version)
    if (!candidate) throw new Error('Unknown replay implementation.')
    await this.refresh(runtime, candidate)
    return { worktree: candidate.worktree, digest: candidate.digest }
  }
  replayHost(runtime: Runtime): ReplayHost {
    return {
      state: runtime.state,
      dir: runtime.dir,
      signal: runtime.abort.signal,
      changed: () => this.changed(runtime),
      log: (title, detail) => this.log(runtime, 'check', title, detail),
      source: (version) => this.replaySource(runtime, version),
      approve: (request) => this.askApproval(runtime, { ...request, id: randomUUID() }),
    }
  }
  async saveReplay(id: string, scenario: unknown) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Coding session not found.')
    const saved = saveScenario(runtime.state, scenario)
    this.log(
      runtime,
      'user',
      `Saved replay scenario r${saved.revision}`,
      `${saved.scenario.name}\nSHA256 ${saved.digest}`,
    )
    await this.persist(runtime)
    return runtime.state
  }
  async replay(id: string, order: unknown, version: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Coding session not found.')
    if (this.active()) throw new Error('Wait for active tools to stop before replaying.')
    const scenario = runtime.state.projectReplay?.saved?.scenario
    if (!scenario) throw new Error('Save a replay scenario first.')
    replayOrder(
      order,
      scenario.requests.map((r) => r.id),
    )
    const versions =
      version === 'all' ? ['baseline', ...runtime.state.candidates.map((c) => c.id)] : [version]
    if (versions.some((v) => v !== 'baseline' && !runtime.state.candidates.some((c) => c.id === v)))
      throw new Error('Unknown replay implementation.')
    runtime.abort = new AbortController()
    runtime.state.busy = true
    runtime.state.status = 'running'
    runtime.state.error = undefined
    runtime.state.activity = 'Preparing real browser replay'
    this.changed(runtime)
    await this.persist(runtime)
    runtime.task = (async () => {
      await runProjectBatch(this.replayHost(runtime), versions, order)
      runtime.state.busy = false
      runtime.state.status = 'ready'
      runtime.state.activity = 'Replay complete — inspect recorded evidence'
      this.changed(runtime)
      await this.persist(runtime)
    })().catch((error) => this.failed(runtime, error))
    return runtime.state
  }
  async generateReplayFixes(id: string, sequential = false) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Coding session not found.')
    if (this.active()) throw new Error('Wait for active tools to finish.')
    if (
      !runtime.state.projectReplay?.runs.some(
        (run) =>
          run.version === 'baseline' &&
          run.scenarioDigest === runtime.state.projectReplay?.saved?.digest &&
          run.orderRevision === runtime.state.projectReplay.orderRevision &&
          run.sourceDigest === runtime.state.baseline.digest &&
          (run.status === 'passed' || run.status === 'failed'),
      )
    )
      throw new Error('Run the saved scenario on Baseline before generating fixes.')
    const saved = runtime.state.projectReplay.saved!
    const message =
      'Implement two materially different fixes for the original task. Keep the saved browser actions, fixtures and assertion unchanged. Scenario: ' +
      JSON.stringify(saved.scenario) +
      '. Use the actual Baseline evidence, request applicable checks, and inspect the patch.'
    runtime.state.compare = true
    runtime.state.sequential = sequential
    runtime.state.candidates[0].name = 'Candidate A'
    let prepare: (() => Promise<void>) | undefined
    if (!runtime.state.candidates.some((c) => c.id === 'b')) {
      const candidate: CodingCandidate = {
        id: 'b',
        name: 'Candidate B',
        worktree: join(runtime.dir, 'worktrees/b'),
        digest: runtime.state.baseline.digest,
        files: [],
        patch: '',
      }
      runtime.state.candidates.push(candidate)
      prepare = async () => {
        const headFiles = (
          await git(
            runtime.state.repo.path,
            ['ls-tree', '-r', '--name-only', '-z', runtime.state.baseline.revision],
            runtime.abort.signal,
          )
        )
          .split(String.fromCharCode(0))
          .filter(Boolean)
        await createWorktree(
          runtime.state.repo.path,
          candidate.worktree,
          {
            revision: runtime.state.baseline.revision,
            dirty: runtime.state.baseline.dirty,
            digest: runtime.state.baseline.digest,
            files: runtime.baseline,
            headFiles,
          },
          runtime.abort.signal,
          { linkDependencies: false },
        )
      }
    } else runtime.state.candidates[1].name = 'Candidate B'
    await this.followup(id, message, prepare)
    return runtime.state
  }
  async generateNext(id: string, candidateId: string) {
    const runtime = this.sessions.get(id)
    if (!runtime || this.active())
      throw new Error('Wait for active work before generating the next candidate.')
    const generation = runtime.state.generation
    if (
      !generation ||
      generation.turn !== runtime.state.turn ||
      !generation.queued.includes(candidateId)
    )
      throw new Error('This candidate is not queued for the current instruction.')
    generation.queued = generation.queued.filter((id) => id !== candidateId)
    runtime.abort = new AbortController()
    runtime.state.busy = true
    runtime.state.status = 'running'
    runtime.state.error = undefined
    this.log(
      runtime,
      'user',
      `Generate Candidate ${candidateId.toUpperCase()}`,
      'Same captured baseline; the other candidate and its evidence are retained.',
    )
    await this.persist(runtime)
    runtime.task = this.turn(runtime, [candidateId]).catch((error) => this.failed(runtime, error))
    return runtime.state
  }
  async proposeReplay(id: string) {
    await this.followup(
      id,
      'Read the app entry point, repository instructions and package scripts. Propose a local Chromium fetch/XHR replay scenario using propose_replay. Include executable/argv/cwd, local origin with {PORT}, page/readiness paths, fixed click/fill/select actions with gate IDs, exact URL/method/optional body request fixtures, response order, DOM text assertion, settleMs and timeoutMs. This request is read-only: do not edit files or run commands. The user will review, change, and save the proposal.',
      undefined,
      true,
    )
    return this.state(id)
  }
  async followup(id: string, message: string, prepare?: () => Promise<void>, proposalOnly = false) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Coding session not found.')
    if (this.active()) throw new Error('Wait for the active turn to stop before continuing.')
    runtime.abort = new AbortController()
    runtime.state.turn++
    runtime.state.generation =
      runtime.state.compare && runtime.state.sequential && !proposalOnly
        ? { turn: runtime.state.turn, queued: ['b'] }
        : undefined
    runtime.proposalOnly = proposalOnly
    runtime.state.busy = true
    runtime.state.status = 'running'
    runtime.state.error = undefined
    runtime.state.activity = 'Continuing from retained candidate edits'
    runtime.state.messages.push({ role: 'user', content: message, turn: runtime.state.turn })
    this.log(runtime, 'user', message)
    await this.persist(runtime)
    runtime.task = (async () => {
      await prepare?.()
      await this.turn(runtime, runtime.state.generation ? ['a'] : undefined)
    })()
      .catch((error) => this.failed(runtime, error))
      .finally(() => {
        runtime.proposalOnly = false
      })
  }
  cancel(id: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Coding session not found.')
    if (!runtime.state.busy) return
    runtime.abort.abort()
    runtime.state.activity = 'Cancelling active tools…'
    this.changed(runtime)
  }
  async failed(runtime: Runtime, error: unknown) {
    for (const run of runtime.state.providerRuns ?? [])
      if (run.status === 'running') {
        run.status = 'interrupted'
        run.resumable = true
        run.recovery =
          error instanceof RecoveryRequired
            ? { ...error.info, waiting: false }
            : {
                kind: runtime.abort.signal.aborted ? 'cancelled' : 'provider',
                message: error instanceof Error ? error.message : String(error),
              }
      }
    for (const candidate of runtime.state.candidates)
      await this.refresh(runtime, candidate, true).catch(() => {})
    runtime.state.status = runtime.abort.signal.aborted ? 'cancelled' : 'error'
    runtime.state.approval = undefined
    runtime.state.activity = runtime.abort.signal.aborted
      ? 'Turn cancelled; edits retained'
      : 'Turn stopped; edits retained'
    runtime.state.error = error instanceof Error ? error.message : String(error)
    if (runtime.checkpointRun?.recovery) runtime.checkpointRun.recovery.waiting = false
    await this.saveCheckpoint(runtime).catch(() => {})
    runtime.checkpoint = undefined
    runtime.checkpointRun = undefined
    runtime.activeTool = undefined
    runtime.state.busy = false
    this.log(runtime, 'error', runtime.state.activity, runtime.state.error)
    await this.persist(runtime)
  }
  async review(id: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Coding session not found.')
    if (!runtime.state.busy)
      for (const candidate of runtime.state.candidates) await this.refresh(runtime, candidate)
    await this.persist(runtime)
    return runtime.state
  }
  async apply(id: string, candidateId: string, target: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Coding session not found.')
    if (this.active()) throw new Error('Wait for active tools to finish before applying.')
    const candidate = runtime.state.candidates.find((c) => c.id === candidateId)
    if (!candidate) throw new Error('Select a candidate.')
    runtime.state.busy = true
    this.changed(runtime)
    try {
      const current = await this.refresh(runtime, candidate)
      const applied = await applyCandidate({
        target,
        revision: runtime.state.baseline.revision,
        baseline: runtime.baseline,
        current,
        patch: candidate.patch,
        files: candidate.files,
        patchPath: join(runtime.dir, 'apply.patch'),
      })
      runtime.state.applied = {
        path: applied,
        digest: candidate.digest,
        at: new Date().toISOString(),
      }
      this.log(runtime, 'agent', 'Patch applied to checkout', applied)
    } finally {
      runtime.state.busy = false
      this.changed(runtime)
      await this.persist(runtime)
    }
    return runtime.state
  }
  async checkpoint(id: string) {
    await this.sessions.get(id)?.persistence
  }
  async wait(id: string) {
    const runtime = this.sessions.get(id)
    await runtime?.task
    await runtime?.persistence
  }
  async close() {
    for (const runtime of this.sessions.values()) {
      if (runtime.state.busy) runtime.abort.abort()
      await runtime.task
      await runtime.persistence
    }
  }
}
