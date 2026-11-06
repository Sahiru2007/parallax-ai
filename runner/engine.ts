import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ViteDevServer } from 'vite'
import type {
  Candidate,
  Investigation,
  Schedule,
  ToolEvent,
  VersionId,
} from '../shared/investigation.ts'
import { parseSchedule } from '../shared/scenario.ts'
import { command } from './process.ts'
import {
  HOOK_PATH,
  candidateDiff,
  captureSnapshot,
  createWorktree,
  safeRead,
  type Snapshot,
} from './worktrees.ts'
import { latestRequestGuard, queryKeyedResults } from './patches.ts'
import { fixtureServer, replay } from './replay.ts'
import { regressionSource } from './regression.ts'
import { runLiveAgent } from './provider.ts'

interface Runtime {
  state: Investigation
  abort: AbortController
  dir: string
  snapshot?: Snapshot
  servers: Map<VersionId, { server: ViteDevServer; url: string }>
}
export class InvestigationEngine {
  root: string
  updates = new EventEmitter()
  sessions = new Map<string, Runtime>()
  constructor(root: string) {
    this.root = root
  }
  async restore() {
    const base = join(this.root, 'artifacts/investigations')
    const entries = await readdir(base).catch(() => [] as string[])
    for (const id of entries.filter((name) => /^[a-f0-9-]{36}$/.test(name))) {
      const dir = join(base, id)
      try {
        const state = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')) as Investigation
        if (state.id !== id) continue
        for (const candidate of state.candidates)
          candidate.worktree = join(dir, 'worktrees', candidate.id)
        if (state.busy) {
          state.busy = false
          state.status = 'cancelled'
          state.activity = 'Interrupted by runner restart'
          state.error = 'The runner restarted before this run completed. Start a new investigation.'
        }
        this.sessions.set(id, { state, dir, abort: new AbortController(), servers: new Map() })
      } catch {
        /* Incomplete sessions have no completed manifest to restore. */
      }
    }
  }
  state(id: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Investigation not found.')
    return runtime.state
  }
  active() {
    return [...this.sessions.values()].some((runtime) => runtime.state.busy)
  }
  changed(runtime: Runtime) {
    this.updates.emit(runtime.state.id, runtime.state)
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
    await writeFile(join(runtime.dir, 'session.json'), JSON.stringify(runtime.state, null, 2))
  }
  start(task: string, mode: 'sample' | 'live'): Investigation {
    if (this.active())
      throw new Error('Another local run is active. Cancel it or wait for completion.')
    const id = randomUUID()
    const candidates: Candidate[] = [
      {
        id: 'baseline',
        name: 'Baseline',
        strategy: 'Unmodified working-copy snapshot',
        patchOrigin: 'baseline',
        ready: false,
      },
      {
        id: 'a',
        name: 'Candidate A',
        strategy: 'Latest-request guard',
        patchOrigin: mode === 'sample' ? 'prewritten' : 'model',
        ready: false,
      },
      {
        id: 'b',
        name: 'Candidate B',
        strategy: 'Query-keyed results',
        patchOrigin: mode === 'sample' ? 'prewritten' : 'model',
        ready: false,
      },
    ]
    const state: Investigation = {
      id,
      task,
      mode,
      status: 'running',
      activity: 'Capturing repository snapshot',
      revision: '',
      snapshot: '',
      dirty: false,
      capturedFiles: 0,
      createdAt: new Date().toISOString(),
      selectedSchedule: ['B', 'A'],
      busy: true,
      events: [],
      candidates,
      runs: [],
      checks: [],
      steering: [],
    }
    const runtime: Runtime = {
      state,
      abort: new AbortController(),
      dir: join(this.root, 'artifacts/investigations', id),
      servers: new Map(),
    }
    this.sessions.set(id, runtime)
    void this.investigate(runtime).catch((error: unknown) => this.failed(runtime, error))
    return state
  }
  async failed(runtime: Runtime, error: unknown) {
    runtime.state.busy = false
    runtime.state.status = runtime.abort.signal.aborted ? 'cancelled' : 'error'
    runtime.state.activity =
      runtime.state.status === 'cancelled' ? 'Run cancelled' : 'Investigation stopped'
    runtime.state.error = error instanceof Error ? error.message : String(error)
    this.log(
      runtime,
      runtime.state.status === 'cancelled' ? 'agent' : 'error',
      runtime.state.activity,
      runtime.state.error,
    )
    await this.persist(runtime).catch(() => {})
  }
  async investigate(runtime: Runtime) {
    await mkdir(runtime.dir, { recursive: true })
    this.log(
      runtime,
      'user',
      runtime.state.task,
      runtime.state.mode === 'sample'
        ? 'Bundled sample · prewritten patches, real execution'
        : 'Live provider · model-generated patches, real execution',
    )
    const snapshot = await captureSnapshot(this.root)
    runtime.snapshot = snapshot
    Object.assign(runtime.state, {
      revision: snapshot.revision,
      snapshot: snapshot.digest,
      dirty: snapshot.dirty,
      capturedFiles: snapshot.files.size,
    })
    this.log(
      runtime,
      'command',
      'git rev-parse HEAD + working-copy snapshot',
      `Revision ${snapshot.revision}\nSnapshot SHA256 ${snapshot.digest}\n${snapshot.files.size} source files captured, including uncommitted and untracked source. Ignored caches and credentials excluded. No commit or reset.`,
    )
    for (const candidate of runtime.state.candidates) {
      runtime.abort.signal.throwIfAborted()
      candidate.worktree = join(runtime.dir, 'worktrees', candidate.id)
      runtime.state.activity = `Creating ${candidate.name} worktree`
      this.log(
        runtime,
        'command',
        `git worktree add --detach ${candidate.id} ${snapshot.revision.slice(0, 8)}`,
        candidate.worktree,
      )
      await createWorktree(this.root, candidate.worktree, snapshot, runtime.abort.signal)
      this.log(
        runtime,
        'worktree',
        `${candidate.name} worktree created`,
        `${candidate.worktree}\nMaterialized snapshot ${snapshot.digest.slice(0, 12)}; active checkout unchanged.`,
      )
      const hook = await safeRead(candidate.worktree, HOOK_PATH)
      this.log(runtime, 'read', `${candidate.name} · read ${HOOK_PATH}`, hook)
      if (candidate.id !== 'baseline') {
        if (runtime.state.mode === 'sample') {
          this.log(
            runtime,
            'agent',
            `Applying prewritten ${candidate.strategy.toLowerCase()} patch`,
            'Bundled demonstration recipe. This is not model-generated output.',
          )
          await writeFile(
            join(candidate.worktree, HOOK_PATH),
            candidate.id === 'a' ? latestRequestGuard : queryKeyedResults,
          )
        } else await this.generateLive(runtime, candidate)
        candidate.patch = await candidateDiff(
          candidate.worktree,
          snapshot.files.get(HOOK_PATH)!,
          join(runtime.dir, 'diffs', candidate.id),
        )
        if (!candidate.patch) throw new Error(`${candidate.name} produced no patch.`)
        this.log(runtime, 'patch', `${candidate.name} · read actual patch`, candidate.patch)
      }
      candidate.ready = true
      await this.check(runtime, candidate)
      if (!runtime.servers.has(candidate.id))
        runtime.servers.set(candidate.id, await fixtureServer(candidate.worktree))
      for (const order of [
        runtime.state.selectedSchedule,
        [...runtime.state.selectedSchedule].reverse() as Schedule,
      ]) {
        await this.recordReplay(runtime, candidate.id, order)
      }
      if (candidate.id !== 'baseline') await this.verifyExport(runtime, candidate)
    }
    runtime.state.status = 'ready'
    runtime.state.busy = false
    runtime.state.activity = 'Investigation ready for review'
    const failures = runtime.state.runs.filter((run) => run.status === 'failed').length
    this.log(
      runtime,
      'agent',
      'Evidence ready · no patch has been applied',
      `${runtime.state.runs.length} actual browser runs; ${failures} failing final assertions. Both candidates used identical actions, response bodies, and executable checks. Review the recorded evidence and choose a patch to export.`,
    )
    await this.persist(runtime)
  }
  async check(runtime: Runtime, candidate: Candidate) {
    const cwd = candidate.worktree!
    for (const [title, args] of [
      [
        'tsc -b --force --pretty false',
        [join(this.root, 'node_modules/typescript/bin/tsc'), '-b', '--force', '--pretty', 'false'],
      ],
      ['node --test runner/schedule.test.ts', ['--test', 'runner/schedule.test.ts']],
    ] as const) {
      runtime.state.activity = `${candidate.name} · ${title}`
      this.log(runtime, 'command', `${candidate.name} · ${title}`, `cwd: ${cwd}`)
      const result = await command(cwd, process.execPath, [...args], runtime.abort.signal)
      runtime.state.checks.push({ version: candidate.id, command: title, ...result })
      this.log(
        runtime,
        'check',
        `${candidate.name} · exit ${result.exitCode}`,
        result.output || 'Command completed successfully with no output.',
      )
      if (result.exitCode !== 0)
        throw new Error(`${candidate.name}: ${title} failed. See the actual command output.`)
    }
  }
  async recordReplay(runtime: Runtime, version: VersionId, order: Schedule) {
    runtime.abort.signal.throwIfAborted()
    const fixture = runtime.servers.get(version)
    if (!fixture) throw new Error(`No executable fixture exists for ${version}.`)
    runtime.state.activity = `Playwright · ${version} · ${order.join(' → ')}`
    this.log(
      runtime,
      'command',
      `Playwright Chromium · ${version} · deliver ${order.join(' → ')}`,
      'Real browser run with intercepted requests and explicit release gates. Both responses must be handled before the fixed final assertion.',
    )
    const result = await replay({
      version,
      order,
      url: fixture.url,
      artifactDir: join(runtime.dir, 'frames'),
      publicPrefix: `/api/sessions/${runtime.state.id}/frames`,
      signal: runtime.abort.signal,
      onEvent: (event) => {
        if (event.kind === 'response')
          this.log(
            runtime,
            'command',
            `${version} · releasing response ${event.requestId}`,
            `GET /api/places?q=${event.query}\nFixed payload: ${JSON.stringify(event.payload)}`,
          )
        if (event.kind === 'state')
          this.log(
            runtime,
            'read',
            `${version} · observed UI after response ${event.requestId}`,
            `At ${event.atMs} ms; active query ${event.query}\nDOM suggestions: ${JSON.stringify(event.items)}`,
          )
      },
    })
    runtime.state.runs.push(result)
    this.log(
      runtime,
      result.status === 'error' ? 'error' : 'check',
      `${version} · ${result.status.toUpperCase()} · ${order.join(' → ')}`,
      result.output,
    )
    await writeFile(join(runtime.dir, `replay-${result.id}.json`), JSON.stringify(result, null, 2))
    if (result.status === 'error') throw new Error(result.error)
  }
  async verifyExport(runtime: Runtime, candidate: Candidate) {
    const dir = join(runtime.dir, 'exports', candidate.id)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'pickup-regression.spec.ts'),
      regressionSource(runtime.state.selectedSchedule),
    )
    await writeFile(
      join(dir, 'playwright.config.mjs'),
      `export default { testDir: '.', testMatch: 'pickup-regression.spec.ts', workers: 1, reporter: 'line' }\n`,
    )
    this.log(
      runtime,
      'command',
      `${candidate.name} · execute exported regression`,
      'Running the exact self-contained Playwright test offered for download.',
    )
    const childEnvUrl = runtime.servers.get(candidate.id)!.url
    // The generated config injects only a fixture URL, never runner credentials.
    await writeFile(
      join(dir, 'playwright.config.mjs'),
      `process.env.PICKUP_BASE_URL=${JSON.stringify(childEnvUrl)}; export default { testDir: '.', outputDir: ${JSON.stringify(join(dir, 'results'))}, testMatch: 'pickup-regression.spec.ts', workers: 1, reporter: 'line' }\n`,
    )
    const result = await command(
      dir,
      process.execPath,
      [
        join(this.root, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        join(dir, 'playwright.config.mjs'),
      ],
      runtime.abort.signal,
    )
    runtime.state.checks.push({
      version: candidate.id,
      command: 'Playwright exported regression',
      ...result,
    })
    this.log(
      runtime,
      'check',
      `${candidate.name} · exported regression exit ${result.exitCode}`,
      result.output,
    )
    // A live proposal may fail; retain its real evidence instead of rewriting the assertion.
  }
  async generateLive(runtime: Runtime, candidate: Candidate) {
    await runLiveAgent({
      task: runtime.state.task,
      strategy: candidate.strategy,
      signal: runtime.abort.signal,
      steering: () => runtime.state.steering,
      onText: (text) => this.log(runtime, 'agent', `${candidate.name} · model`, text),
      execute: async (name, args) => {
        const cwd = candidate.worktree!
        if (name === 'list_files') {
          const files = [...runtime.snapshot!.files.keys()]
          this.log(runtime, 'read', `${candidate.name} · list_files`, files.join('\n'))
          return files
        }
        if (name === 'read_file') {
          const file = String(args.path)
          const content = await safeRead(cwd, file)
          this.log(runtime, 'read', `${candidate.name} · ${file}`, content)
          return content
        }
        if (name === 'write_file') {
          if (
            args.path !== HOOK_PATH ||
            typeof args.content !== 'string' ||
            args.content.length > 100_000
          )
            throw new Error(`Only ${HOOK_PATH} is writable in this slice.`)
          await writeFile(join(cwd, HOOK_PATH), args.content)
          this.log(runtime, 'patch', `${candidate.name} · write_file`, args.content)
          return { written: HOOK_PATH }
        }
        if (name === 'inspect_diff')
          return candidateDiff(
            cwd,
            runtime.snapshot!.files.get(HOOK_PATH)!,
            join(runtime.dir, 'diffs', candidate.id),
          )
        if (name === 'run_checks') {
          await this.check(runtime, candidate)
          if (!runtime.servers.has(candidate.id))
            runtime.servers.set(candidate.id, await fixtureServer(cwd))
          for (const order of [
            ['B', 'A'],
            ['A', 'B'],
          ] as Schedule[])
            await this.recordReplay(runtime, candidate.id, order)
          return runtime.state.runs.filter((run) => run.version === candidate.id)
        }
        throw new Error(`Unknown tool ${name}.`)
      },
    })
  }
  steer(id: string, message: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Investigation not found.')
    runtime.state.steering.push(message)
    this.log(
      runtime,
      'user',
      message,
      runtime.state.mode === 'sample'
        ? 'Steering note recorded. Bundled mode retains the two disclosed prewritten recipes; use the timeline to change executable delivery order.'
        : 'This steering note will be included at the next model tool boundary.',
    )
  }
  rerun(id: string, order: unknown) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Investigation not found.')
    if (this.active()) throw new Error('A run is already active.')
    if (!runtime.state.candidates.every((candidate) => candidate.ready))
      throw new Error('Wait for all candidate worktrees before replaying.')
    const schedule = parseSchedule(order)
    runtime.abort = new AbortController()
    runtime.state.selectedSchedule = schedule
    runtime.state.busy = true
    runtime.state.status = 'running'
    runtime.state.error = undefined
    this.log(
      runtime,
      'user',
      `Replay saved order ${schedule.join(' → ')}`,
      'User actions, payloads, and final assertion remain identical across all versions.',
    )
    void (async () => {
      for (const candidate of runtime.state.candidates) {
        if (!runtime.servers.has(candidate.id))
          runtime.servers.set(candidate.id, await fixtureServer(candidate.worktree!))
        await this.recordReplay(runtime, candidate.id, schedule)
      }
      for (const candidate of runtime.state.candidates.filter((item) => item.id !== 'baseline'))
        await this.verifyExport(runtime, candidate)
      await writeFile(join(runtime.dir, 'schedule.json'), JSON.stringify(schedule))
      runtime.state.busy = false
      runtime.state.status = 'ready'
      runtime.state.activity = 'Replay complete'
      this.changed(runtime)
      await this.persist(runtime)
    })().catch((error: unknown) => this.failed(runtime, error))
  }
  cancel(id: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Investigation not found.')
    if (runtime.state.busy) {
      runtime.abort.abort()
      runtime.state.activity = 'Cancelling active tools…'
      this.changed(runtime)
    }
  }
  async close() {
    for (const runtime of this.sessions.values()) {
      runtime.abort.abort()
      for (const fixture of runtime.servers.values()) await fixture.server.close()
    }
  }
  getArtifactDir(id: string) {
    const runtime = this.sessions.get(id)
    if (!runtime) throw new Error('Investigation not found.')
    return runtime.dir
  }
}
