import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm, realpath } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { CodingSession, CodingCandidate, CodingCheck } from '../shared/coding.ts'
import type { ToolEvent } from '../shared/investigation.ts'
import { command } from './process.ts'
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

interface Runtime {
  state: CodingSession
  dir: string
  abort: AbortController
  persistence: Promise<void>
  task?: Promise<void>
  baseline: Map<string, Buffer>
  approval?: (allow: boolean) => void
}
export class CodingEngine {
  base: string
  sessions = new Map<string, Runtime>()
  updates = new EventEmitter()
  constructor(base: string) {
    this.base = base
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
            'This turn was interrupted. Your candidate edits and earlier evidence are retained. Send a follow-up to continue.'
          state.approval = undefined
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
  async start(path: string, task: string, provider: 'live' | 'test', compare: boolean) {
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
      compare,
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
        await this.turn(runtime)
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
  async turn(runtime: Runtime) {
    const state = runtime.state
    for (const candidate of state.candidates) {
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
      if (state.compare)
        instructions += `\nCompare approaches is enabled. Use a materially distinct approach for ${candidate.name}. ${candidate.id === 'b' ? `Approach A patch for reference:\n${state.candidates[0].patch}` : ''}`
      await runCodingProvider({
        mode: state.provider,
        task: state.messages.filter((m) => m.role === 'user').at(-1)!.content,
        history: state.messages
          .filter((m) => m.turn < state.turn)
          .map(({ role, content }) => ({ role, content })),
        turn: state.turn,
        candidate: candidate.name,
        instructions,
        signal: runtime.abort.signal,
        onText: (text) => {
          state.messages.push({ role: 'assistant', content: text, turn: state.turn })
          this.log(
            runtime,
            'agent',
            `${candidate.name} · ${state.provider === 'test' ? 'test provider' : 'model'}`,
            text,
          )
        },
        execute: (name, args) => this.tool(runtime, candidate, name, args),
      })
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
  async tool(
    runtime: Runtime,
    candidate: CodingCandidate,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    runtime.abort.signal.throwIfAborted()
    const root = candidate.worktree
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
    runtime.state.approval = request
    const approvedDigest = candidate.digest
    runtime.state.activity = 'Waiting for command approval'
    const allowed = new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        runtime.approval = undefined
        reject(new Error('Turn cancelled while waiting for approval.'))
      }
      runtime.approval = (allow) => {
        runtime.abort.signal.removeEventListener('abort', abort)
        runtime.approval = undefined
        resolve(allow)
      }
      runtime.abort.signal.addEventListener('abort', abort, { once: true })
    })
    this.log(
      runtime,
      'command',
      'Approval required',
      `${request.executable} ${request.args.join(' ')}\ncwd: ${cwd}\n${detail}`,
    )
    const approved = await allowed
    runtime.state.approval = undefined
    const check: CodingCheck = {
      id: request.id,
      candidate: candidate.id,
      turn: runtime.state.turn,
      command: `${request.executable} ${request.args.map((a) => JSON.stringify(a)).join(' ')}`,
      cwd,
      digest: candidate.digest,
      status: approved ? 'running' : 'skipped',
      output: approved ? '' : 'Skipped: command approval was denied.',
    }
    runtime.state.checks.push(check)
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
    return check
  }
  approve(id: string, requestId: string, allow: boolean) {
    const runtime = this.sessions.get(id)
    if (!runtime?.approval || runtime.state.approval?.id !== requestId)
      throw new Error('This command approval is no longer pending.')
    runtime.approval(allow)
  }
  async followup(id: string, message: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Coding session not found.')
    if (this.active()) throw new Error('Wait for the active turn to stop before continuing.')
    runtime.abort = new AbortController()
    runtime.state.turn++
    runtime.state.busy = true
    runtime.state.status = 'running'
    runtime.state.error = undefined
    runtime.state.activity = 'Continuing from retained candidate edits'
    runtime.state.messages.push({ role: 'user', content: message, turn: runtime.state.turn })
    this.log(runtime, 'user', message)
    await this.persist(runtime)
    runtime.task = this.turn(runtime).catch((error) => this.failed(runtime, error))
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
    for (const candidate of runtime.state.candidates)
      await this.refresh(runtime, candidate, true).catch(() => {})
    runtime.state.busy = false
    runtime.state.status = runtime.abort.signal.aborted ? 'cancelled' : 'error'
    runtime.state.approval = undefined
    runtime.state.activity = runtime.abort.signal.aborted
      ? 'Turn cancelled; edits retained'
      : 'Turn stopped; edits retained'
    runtime.state.error = error instanceof Error ? error.message : String(error)
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
