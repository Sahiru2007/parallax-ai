import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { chromium, type Browser } from '@playwright/test'
import type { CodingSession, CommandApproval } from '../shared/coding.ts'
import {
  validateScenario,
  replayOrder,
  type ReplayScenario,
  type ProjectReplayRun,
} from '../shared/project-replay.ts'
import { command } from './process.ts'
import { driveProjectReplay } from './project-replay-driver.ts'

export interface ReplayHost {
  state: CodingSession
  dir: string
  signal: AbortSignal
  changed: () => void
  log: (title: string, detail?: string) => void
  source: (version: string) => Promise<{ worktree: string; digest: string }>
  approve: (request: Omit<CommandApproval, 'id'>) => Promise<boolean>
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    )
  return value
}
export function scenarioDigest(scenario: ReplayScenario) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(scenario)))
    .digest('hex')
}
export function saveScenario(state: CodingSession, input: unknown) {
  if (state.busy) throw new Error('Wait for active tools before editing the scenario.')
  const scenario = structuredClone(validateScenario(input)),
    digest = scenarioDigest(scenario)
  const replay = (state.projectReplay ??= { order: [], orderRevision: 0, runs: [] })
  if (replay.saved?.digest === digest) return replay.saved
  replay.history ??= []
  if (replay.saved && !replay.history.some((record) => record.revision === replay.saved!.revision))
    replay.history.push(structuredClone(replay.saved))
  replay.saved = { revision: (replay.saved?.revision ?? 0) + 1, digest, scenario }
  replay.history.push(structuredClone(replay.saved))
  replay.order = [...scenario.order]
  replay.orderRevision++
  return replay.saved
}
async function allocatePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local app port available.')
  await new Promise<void>((r) => server.close(() => r()))
  return address.port
}
function executableCommand(executable: string, args: string[]) {
  if (executable === 'node') return { executable: process.execPath, args }
  if (executable === 'npm' || executable === 'npx') {
    const npm =
      process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    return {
      executable: process.execPath,
      args: [executable === 'npm' ? npm : join(dirname(npm), 'npx-cli.js'), ...args],
    }
  }
  return { executable, args }
}
export async function runProjectBatch(
  host: ReplayHost,
  versions: string[],
  requestedOrder: unknown,
) {
  const state = host.state,
    replay = state.projectReplay
  if (!replay?.saved) throw new Error('Save a replay scenario first.')
  const saved = structuredClone(replay.saved),
    scenario = saved.scenario
  const order = replayOrder(
    requestedOrder,
    scenario.requests.map((r) => r.id),
  )
  if (order.join() !== replay.order.join()) replay.orderRevision++
  replay.order = [...order]
  const attemptId = randomUUID()
  for (const version of versions) {
    host.signal.throwIfAborted()
    const run: ProjectReplayRun = {
      id: randomUUID(),
      version,
      attemptId,
      startedAt: new Date().toISOString(),
      scenarioRevision: saved.revision,
      scenarioDigest: saved.digest,
      sourceDigest:
        version === 'baseline'
          ? state.baseline.digest
          : (state.candidates.find((c) => c.id === version)?.digest ?? ''),
      baselineRevision: state.baseline.revision,
      order: [...order],
      orderRevision: replay.orderRevision,
      status: 'running',
      events: [],
      coverage: { seen: [], cancelled: [], missing: [], unexpected: [], different: false },
      finalTexts: [],
      durationMs: 0,
      output: '',
    }
    replay.runs.push(run)
    host.changed()
    let browser: Browser | undefined
    const appAbort = new AbortController()
    let app: Promise<void> | undefined, exitError: string | undefined
    const started = Date.now()
    const stopBrowser = () => {
      void browser?.close().catch(() => {})
    }
    host.signal.addEventListener('abort', stopBrowser, { once: true })
    try {
      const source = await host.source(version)
      run.sourceDigest = source.digest
      const port = scenario.app.origin.includes('{PORT}')
        ? await allocatePort()
        : Number(new URL(scenario.app.origin).port || 80)
      const origin = scenario.app.origin.replaceAll('{PORT}', String(port))
      const argv = scenario.app.args.map((arg) => arg.replaceAll('{PORT}', String(port)))
      const cwd =
        scenario.app.cwd === '.'
          ? source.worktree
          : await (
              await import('./coding-files.ts')
            ).writablePath(source.worktree, scenario.app.cwd)
      const ready = new URL(scenario.app.readyPath.replaceAll('{PORT}', String(port)), origin).href
      if (scenario.app.prepare) {
        const setup = scenario.app.prepare,
          args = setup.args.map((arg) => arg.replaceAll('{PORT}', String(port)))
        const approved = await host.approve({
          candidate: version,
          executable: setup.executable,
          args,
          cwd,
          detail: `Prepare this isolated ${version} worktree before app start. ${await scriptDetails(cwd, setup.executable, args)}`,
        })
        if (!approved)
          throw new Error(
            'App preparation skipped: approval denied; no browser assertion executed.',
          )
        if ((await host.source(version)).digest !== source.digest)
          throw new Error('Source changed during preparation approval. Review and replay again.')
        const actual = executableCommand(setup.executable, args)
        state.activity = `Preparing ${version} app`
        host.changed()
        const result = await command(cwd, actual.executable, actual.args, host.signal, {
          onOutput: (text) => {
            run.output = (run.output + text).slice(-100_000)
            host.changed()
          },
        })
        run.output += `\nPreparation exit ${result.exitCode}\n`
        if (result.exitCode !== 0)
          throw new Error(`App preparation failed (exit ${result.exitCode}). ${result.output}`)
        if ((await host.source(version)).digest !== source.digest)
          throw new Error(
            'Preparation changed captured source. Use a lockfile-preserving install/build and ignored generated outputs.',
          )
      }
      const exists = await fetch(ready, { signal: AbortSignal.timeout(300) }).then(
        () => true,
        () => false,
      )
      if (exists)
        throw new Error(
          `App port ${port} is already in use. Stop that app or use {PORT} in the command and origin to isolate each worktree.`,
        )
      const approved = await host.approve({
        candidate: version,
        executable: scenario.app.executable,
        args: argv,
        cwd,
        detail: `Start ${version} from its isolated source for scenario r${saved.revision}. Readiness: ${ready}. The app process tree is stopped after this browser run.\n${await scriptDetails(cwd, scenario.app.executable, argv)}`,
      })
      if (!approved)
        throw new Error(
          'App start command skipped: approval was denied. No browser assertion executed.',
        )
      const current = await host.source(version)
      if (current.digest !== source.digest)
        throw new Error(
          'Source changed while app-start approval was pending. Review the source and replay again.',
        )
      const actual = executableCommand(scenario.app.executable, argv)
      state.activity = `Starting ${version} app`
      host.changed()
      host.log(
        `Replay ${version} · app start`,
        `${scenario.app.executable} ${argv.join(' ')}\ncwd: ${cwd}`,
      )
      app = command(
        cwd,
        actual.executable,
        actual.args,
        AbortSignal.any([host.signal, appAbort.signal]),
        {
          timeoutMs: 120_000,
          onOutput: (text) => {
            run.output = (run.output + text).slice(-100_000)
            host.changed()
          },
        },
      )
        .then((result) => {
          exitError = `App exited before replay completed (exit ${result.exitCode}).\n${result.output}`
        })
        .catch((error) => {
          if (!appAbort.signal.aborted && !host.signal.aborted) exitError = String(error)
        })
      const deadline = Date.now() + Math.max(10_000, scenario.timeoutMs)
      while (true) {
        host.signal.throwIfAborted()
        if (exitError) throw new Error(exitError)
        if (
          await fetch(ready, { signal: AbortSignal.timeout(500) }).then(
            (r) => r.ok,
            () => false,
          )
        )
          break
        if (Date.now() > deadline)
          throw new Error(
            `App did not become ready at ${ready}. Check its start command, bind address, port placeholder, and readiness path.\n${run.output}`,
          )
        await new Promise((r) => setTimeout(r, 100))
      }
      if ((await host.source(version)).digest !== source.digest)
        throw new Error(
          'App startup changed tracked source. Put generated output in ignored files before comparing against this baseline.',
        )
      const environment = { ...process.env }
      delete environment.OPENAI_API_KEY
      delete environment.PARALLAX_MODEL
      browser = await chromium.launch({ headless: true, timeout: 15_000, env: environment })
      host.signal.throwIfAborted()
      const page = await browser.newPage({
        viewport: { width: 1000, height: 650 },
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      })
      state.activity = `Replaying ${version} · ${order.join(' → ')}`
      host.changed()
      const frames = join(host.dir, 'replay-frames')
      await mkdir(frames, { recursive: true })
      const result = await driveProjectReplay(page, scenario, order, origin, async (event) => {
        host.signal.throwIfAborted()
        if (event.track !== 'response') {
          const filename = `${run.id}-${run.events.length}.png`
          await page.screenshot({ path: join(frames, filename), animations: 'disabled' })
          event.screenshot = `/api/coding/sessions/${state.id}/replay/frames/${filename}`
        }
        run.events.push(event)
        host.changed()
      })
      Object.assign(run, {
        coverage: result.coverage,
        finalTexts: result.finalTexts,
        firstUnexpected: result.firstUnexpected,
        status: result.executionError ? 'error' : result.passed ? 'passed' : 'failed',
        error: result.executionError,
      })
      run.output += `\nFixed actions: ${JSON.stringify(scenario.actions)}\nFixtures: ${JSON.stringify(scenario.requests)}\nExpected: ${JSON.stringify(scenario.expected)}\nActual final UI: ${JSON.stringify(result.finalTexts)}\nCoverage: ${JSON.stringify(result.coverage)}`
      if (exitError) throw new Error(exitError)
      if ((await host.source(version)).digest !== source.digest)
        throw new Error(
          'Source changed during the browser run. Rerun against stable source; this result is not verified.',
        )
    } catch (error) {
      run.status = host.signal.aborted ? 'cancelled' : 'error'
      run.error = error instanceof Error ? error.message : String(error)
      run.output += `\n${run.error}`
    } finally {
      host.signal.removeEventListener('abort', stopBrowser)
      await browser?.close().catch(() => {})
      appAbort.abort()
      await app
      run.durationMs = Date.now() - started
      host.log(
        `Replay ${version} · ${run.status.toUpperCase()}`,
        run.error ??
          `Observed ${JSON.stringify(run.finalTexts)}; source ${run.sourceDigest}; scenario r${run.scenarioRevision}; order ${order.join(' → ')}`,
      )
      await writeFile(join(host.dir, `project-replay-${run.id}.json`), JSON.stringify(run, null, 2))
      host.changed()
    }
    host.signal.throwIfAborted()
  }
  return replay.runs.filter((run) => run.attemptId === attemptId)
}
async function scriptDetails(cwd: string, executable: string, args: string[]) {
  if (executable !== 'npm' || args[0] !== 'run')
    return 'Exact executable/argv shown above; no shell interpretation.'
  const { readFile } = await import('node:fs/promises')
  const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const script = args[1]
  return [`pre${script}`, script, `post${script}`]
    .map((key) => `${key}: ${manifest.scripts?.[key] ?? '(none)'}`)
    .join('\n')
}
export function exportedProjectTest(
  saved: NonNullable<NonNullable<CodingSession['projectReplay']>['saved']>,
  order: string[],
) {
  replayOrder(
    order,
    saved.scenario.requests.map((r) => r.id),
  )
  const appInstructions = JSON.stringify(saved.scenario.app).replaceAll(/[\u2028\u2029]/g, ' ')
  return `// PARALLAX standalone Chromium regression. Scenario r${saved.revision}, SHA256 ${saved.digest}.
// Fixtures, actions, request matching, handling barriers and assertions are embedded below.
// In the target repo: npm install --save-dev @playwright/test && npx playwright install chromium
// App configuration (executable, argv, cwd, optional prepare): ${appInstructions}
// In the configured app cwd, run optional prepare first, then start the app separately. Replace {PORT} with a free local port.
// Set PARALLAX_BASE_URL to that origin. Put this file in ./parallax-regression/.
// Run: npx playwright test --config ./parallax-regression parallax-regression.spec.ts --output ./parallax-regression/results
// The selected response order is ${order.join(' -> ')}. Service workers are blocked; the strict coverage assertion flags cancellation or changed requests.
import { test, expect } from '@playwright/test'
test.use({ browserName: 'chromium', serviceWorkers: 'block', viewport: { width: 1000, height: 650 }, reducedMotion: 'reduce' })
const scenario = ${JSON.stringify(saved.scenario, null, 2)}
const order = ${JSON.stringify(order)}
${driveProjectReplay.toString()}
test(${JSON.stringify(saved.scenario.name)}, async ({ page }) => {
  test.setTimeout(60000)
  const origin = process.env.PARALLAX_BASE_URL
  if (!origin) throw new Error('Start the chosen app and set PARALLAX_BASE_URL to its local HTTP origin.')
  const result = await driveProjectReplay(page, scenario, order, origin)
  expect(result.executionError, 'Scenario execution error: ' + result.executionError).toBeUndefined()
  expect(result.coverage.different, 'Request coverage changed: ' + JSON.stringify(result.coverage)).toBe(false)
  expect(result.firstUnexpected, scenario.expected.description).toBeUndefined()
  expect(result.finalTexts, scenario.expected.description).toEqual(scenario.expected.texts)
})
`
}
