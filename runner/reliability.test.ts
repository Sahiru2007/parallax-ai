import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, symlink, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { InvestigationEngine } from './engine.ts'
import { captureSnapshot, createWorktree, removeCandidateWorktree, HOOK_PATH } from './worktrees.ts'
import { command, git } from './process.ts'
import { fixtureServer } from './replay.ts'
import { regressionSource } from './regression.ts'
import { EXPECTED_ITEMS, scenario } from '../shared/scenario.ts'
import type { Investigation } from '../shared/investigation.ts'

const sourceRoot = process.cwd()
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 500; i++) {
    if (await check()) return
    await delay(20)
  }
  throw new Error('Timed out waiting for runner state')
}
async function verifyProcessRestart(root: string, completed: Investigation) {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  const port = address.port
  await new Promise<void>((r) => listener.close(() => r()))
  const base = `http://127.0.0.1:${port}`
  let worker: ChildProcess
  let logs = ''
  const start = async () => {
    worker = spawn(process.execPath, ['runner/server.ts'], {
      cwd: sourceRoot,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PARALLAX_REPO_ROOT: root,
        PARALLAX_RUNNER_PORT: String(port),
        PARALLAX_STATE_DIR: join(root, 'artifacts/coding-sessions'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    worker.stdout!.on('data', (d) => {
      logs += String(d)
    })
    worker.stderr!.on('data', (d) => {
      logs += String(d)
    })
    await until(async () => {
      if (worker.exitCode !== null) throw new Error(logs)
      return fetch(base + '/api/health').then(
        (r) => r.ok,
        () => false,
      )
    })
  }
  const stop = async () => {
    if (worker.exitCode !== null || worker.signalCode !== null) return
    const exited = once(worker, 'exit')
    if (process.platform === 'win32')
      await command(sourceRoot, 'taskkill.exe', ['/PID', String(worker.pid), '/T', '/F'])
    else process.kill(-worker.pid!, 'SIGKILL')
    await exited
  }
  await start()
  try {
    const config = await (await fetch(base + '/api/config')).json()
    assert.equal(config.repo.path, root)
    const before = await (await fetch(base + `/api/sessions/${completed.id}`)).json()
    assert.equal(before.status, 'ready')
    assert.deepEqual(before.runs, completed.runs)
    const interrupted = await (
      await fetch(base + '/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Parallax-Token': config.token },
        body: JSON.stringify({
          repo: 'current',
          mode: 'sample',
          task: 'Interrupt a real runner process',
        }),
      })
    ).json()
    assert(interrupted.id)
    await until(async () => {
      const current = await (await fetch(base + `/api/sessions/${interrupted.id}`)).json()
      if (!current.busy) throw new Error('Run finished before restart fault injection')
      if (!current.events.some((e: { title: string }) => e.title.includes('tsc -b'))) return false
      const manifest = JSON.parse(
        await readFile(
          join(root, 'artifacts/investigations', interrupted.id, 'session.json'),
          'utf8',
        ),
      )
      return (
        manifest.busy && manifest.events.some((e: { title: string }) => e.title.includes('tsc -b'))
      )
    })
    await stop()
    await start()
    const restored = await (await fetch(base + `/api/sessions/${interrupted.id}`)).json()
    assert.equal(restored.status, 'cancelled')
    assert.equal(restored.busy, false)
    assert.match(restored.activity, /Interrupted by runner restart/)
    const retained = await (await fetch(base + `/api/sessions/${completed.id}`)).json()
    assert.equal(retained.status, 'ready')
    assert.deepEqual(retained.runs, completed.runs)
    const frame = retained.runs[0].events.find(
      (e: { screenshot?: string }) => e.screenshot,
    ).screenshot
    const image = await fetch(base + frame)
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    const nextConfig = await (await fetch(base + '/api/config')).json()
    assert.notEqual(nextConfig.token, config.token)
    const cleanup = await fetch(base + `/api/sessions/${interrupted.id}/cleanup`, {
      method: 'POST',
      headers: { 'X-Parallax-Token': nextConfig.token },
    })
    assert.equal(cleanup.status, 200, await cleanup.text())
    // Even an immediate crash after the start acknowledgement must have a durable session.
    const immediate = await (
      await fetch(base + '/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Parallax-Token': nextConfig.token },
        body: JSON.stringify({
          repo: 'current',
          mode: 'sample',
          task: 'Restart immediately after acknowledgement',
        }),
      })
    ).json()
    await stop()
    await start()
    const immediateRestore = await (await fetch(base + `/api/sessions/${immediate.id}`)).json()
    assert.equal(immediateRestore.status, 'cancelled')
    assert.match(immediateRestore.activity, /Interrupted/)
    const finalConfig = await (await fetch(base + '/api/config')).json()
    const immediateCleanup = await fetch(base + `/api/sessions/${immediate.id}/cleanup`, {
      method: 'POST',
      headers: { 'X-Parallax-Token': finalConfig.token },
    })
    assert.equal(immediateCleanup.status, 200, await immediateCleanup.text())
  } finally {
    await stop()
  }
}

test(
  'dirty repository with spaces: worktree safety, failures, retry, recovery, and independent export',
  { timeout: 180_000 },
  async (t) => {
    const root = resolve('artifacts/reliability', `repo with spaces ${randomUUID()}`)
    await mkdir(resolve('artifacts/reliability'), { recursive: true })
    await git(sourceRoot, ['clone', '--shared', '--', sourceRoot, root])
    await symlink(
      join(sourceRoot, 'node_modules'),
      join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const revision = await git(root, ['rev-parse', 'HEAD'])
    await writeFile(
      join(root, HOOK_PATH),
      (await readFile(join(root, HOOK_PATH), 'utf8')) + '\n// Local dirty-checkout marker\n',
    )
    await writeFile(join(root, 'local-note.txt'), 'Untracked local edit included in snapshot\n')
    await writeFile(join(root, '.env'), 'DO_NOT_COPY_THIS_TEST_SECRET=placeholder\n')
    // Include a staged edit as well as unstaged and untracked files.
    await writeFile(
      join(root, 'README.md'),
      (await readFile(join(root, 'README.md'), 'utf8')) + '\nStaged local edit\n',
    )
    await git(root, ['add', 'README.md'])
    const before = await captureSnapshot(root)
    const initialStatus = await git(root, ['status', '--porcelain'])
    const initialIndex = await git(root, ['diff', '--cached', '--binary'])
    const preserved = async () => {
      assert.equal(await git(root, ['rev-parse', 'HEAD']), revision)
      assert.equal((await captureSnapshot(root)).digest, before.digest)
      assert.equal(await git(root, ['status', '--porcelain']), initialStatus)
      assert.equal(await git(root, ['diff', '--cached', '--binary']), initialIndex)
      assert.equal(
        await readFile(join(root, '.env'), 'utf8'),
        'DO_NOT_COPY_THIS_TEST_SECRET=placeholder\n',
      )
    }
    let engine = new InvestigationEngine(root)
    let completed!: Investigation
    try {
      await t.test(
        'real sample includes dirty edits and identical replay contracts in every version',
        async () => {
          completed = engine.start('Investigate the pickup race', 'sample')
          await engine.wait(completed.id)
          assert.equal(completed.status, 'ready', completed.error)
          assert.equal(completed.revision, revision)
          assert.equal(completed.dirty, true)
          assert.equal(completed.snapshot, before.digest)
          assert.deepEqual(
            completed.runs.map((r) => [r.version, r.schedule.join(), r.status]),
            [
              ['baseline', 'B,A', 'failed'],
              ['baseline', 'A,B', 'passed'],
              ['a', 'B,A', 'passed'],
              ['a', 'A,B', 'passed'],
              ['b', 'B,A', 'passed'],
              ['b', 'A,B', 'passed'],
            ],
          )
          for (const run of completed.runs) {
            assert.deepEqual(
              run.events.filter((e) => e.kind === 'action').map((e) => e.query),
              ['Col', 'Colombo'],
            )
            assert.deepEqual(
              run.events.filter((e) => e.kind === 'response').map((e) => [e.requestId, e.payload]),
              run.schedule.map((id) => [id, [...scenario[id].items]]),
            )
            assert.deepEqual(run.expectedItems, EXPECTED_ITEMS)
          }
          for (const candidate of completed.candidates) {
            assert.equal(await git(candidate.worktree!, ['rev-parse', 'HEAD']), revision)
            assert.equal(
              await readFile(join(candidate.worktree!, 'local-note.txt'), 'utf8'),
              'Untracked local edit included in snapshot\n',
            )
            await assert.rejects(access(join(candidate.worktree!, '.env')))
            assert.match(
              await readFile(join(candidate.worktree!, 'README.md'), 'utf8'),
              /Staged local edit/,
            )
          }
          assert.match(
            await readFile(join(completed.candidates[0].worktree!, HOOK_PATH), 'utf8'),
            /Local dirty-checkout marker/,
          )
          await preserved()
        },
      )
      await t.test(
        'independent exported test fails on baseline, then passes after applying the exported patch',
        async () => {
          const dir = join(root, 'artifacts/investigations', randomUUID())
          const target = join(dir, 'worktrees/baseline')
          await createWorktree(root, target, before, new AbortController().signal)
          const fixture = await fixtureServer(target)
          const exported = join(dir, 'exported test')
          await mkdir(exported, { recursive: true })
          await writeFile(join(exported, 'pickup-regression.spec.ts'), regressionSource(['B', 'A']))
          await writeFile(
            join(exported, 'playwright.config.mjs'),
            `process.env.PICKUP_BASE_URL=${JSON.stringify(fixture.url)}; export default { testDir: '.', outputDir: ${JSON.stringify(join(exported, 'results'))}, workers: 1, reporter: 'line', use: { headless: true } }`,
          )
          const run = () =>
            command(exported, process.execPath, [
              join(sourceRoot, 'node_modules/@playwright/test/cli.js'),
              'test',
              '--config',
              join(exported, 'playwright.config.mjs'),
            ])
          try {
            const buggy = await run()
            assert.equal(buggy.exitCode, 1, buggy.output)
            assert.match(
              buggy.output,
              /After both deliveries, show only results for the active query/,
            )
            const patch = join(dir, 'chosen.patch')
            await writeFile(patch, completed.candidates[1].patch!)
            await git(target, ['apply', '--check', patch])
            await git(target, ['apply', patch])
            const fixed = await run()
            assert.equal(fixed.exitCode, 0, fixed.output)
            assert.match(fixed.output, /1 passed/)
            await writeFile(
              join(root, 'artifacts/independent-export-proof.json'),
              JSON.stringify({ baseline: buggy, afterPatch: fixed }, null, 2),
            )
          } finally {
            await fixture.server.close()
            await removeCandidateWorktree(root, dir, 'baseline')
          }
          await preserved()
        },
      )
      await t.test(
        'completed evidence survives a new engine; a cancelled replay cannot become fresh evidence',
        async () => {
          const oldRuns = JSON.stringify(completed.runs)
          await engine.close()
          await verifyProcessRestart(root, completed)
          engine = new InvestigationEngine(root)
          await engine.restore()
          assert.equal(JSON.stringify(engine.state(completed.id).runs), oldRuns)
          const oldAttempt = engine.state(completed.id).attemptId
          engine.rerun(completed.id, ['A', 'B'])
          assert.notEqual(engine.state(completed.id).attemptId, oldAttempt)
          engine.cancel(completed.id)
          await engine.wait(completed.id)
          assert.equal(engine.state(completed.id).status, 'cancelled')
          assert.equal(JSON.stringify(engine.state(completed.id).runs), oldRuns)
          await preserved()
        },
      )
      await t.test(
        'active command cancellation is checkpointed, retry is fresh, and cleanup preserves source and evidence',
        async () => {
          await engine.close()
          let started!: () => void
          let active = new Promise<void>((r) => {
            started = r
          })
          engine = new InvestigationEngine(root, {
            command: async (cwd, _executable, _args, signal) => {
              started()
              return command(
                cwd,
                process.execPath,
                ['-e', 'console.log("active command");setTimeout(()=>{},10000)'],
                signal,
              )
            },
          })
          const failed = engine.start('Cancel during a real command', 'sample')
          await active
          // Flush active checkpoint, then restore it while the original runtime is still running.
          await engine.sessions.get(failed.id)!.persistence
          const recovered = new InvestigationEngine(root)
          await recovered.restore()
          assert.equal(recovered.state(failed.id).status, 'cancelled')
          assert.match(recovered.state(failed.id).activity, /Interrupted/)
          await recovered.close()
          engine.cancel(failed.id)
          assert.throws(() => engine.retry(failed.id), /active/)
          await engine.wait(failed.id)
          assert.equal(failed.status, 'cancelled')
          assert.equal(failed.runs.length, 0)
          active = new Promise<void>((r) => {
            started = r
          })
          const retry = engine.retry(failed.id)
          assert.notEqual(retry.id, failed.id)
          assert.notEqual(retry.attemptId, failed.attemptId)
          assert.equal(
            retry.events.some((e) => e.title.includes('Run cancelled')),
            false,
          )
          assert.deepEqual(retry.runs, [])
          await active
          engine.cancel(retry.id)
          await engine.wait(retry.id)
          await engine.cleanup(failed.id)
          await engine.cleanup(retry.id)
          await assert.rejects(access(join(engine.getArtifactDir(failed.id), 'worktrees/baseline')))
          assert(
            await access(join(engine.getArtifactDir(failed.id), 'session.json')).then(() => true),
          )
          await preserved()
        },
      )
      await t.test(
        'command timeout and browser launch failure release the engine and retain separate error evidence',
        async () => {
          await engine.close()
          engine = new InvestigationEngine(root, {
            command: (cwd, _exe, _args, signal) =>
              command(cwd, process.execPath, ['-e', 'setTimeout(()=>{},10000)'], signal, {
                timeoutMs: 100,
              }),
          })
          const timeout = engine.start('Timeout a command', 'sample')
          await engine.wait(timeout.id)
          assert.equal(timeout.status, 'error')
          assert.match(timeout.error!, /timed out/)
          assert.equal(engine.active(), false)
          await engine.cleanup(timeout.id)
          const { chromium } = await import('@playwright/test')
          const launch = mock.method(chromium, 'launch', async () => {
            throw new Error('Browser startup failure (test double)')
          })
          // Run real commands and fixture setup; only Chromium startup is fault-injected.
          engine.deps.command = command
          try {
            const browserFailure = engine.retry(timeout.id)
            await engine.wait(browserFailure.id)
            assert.equal(browserFailure.status, 'error')
            assert.equal(browserFailure.runs[0].status, 'error')
            assert.match(browserFailure.runs[0].error!, /Browser startup failure/)
            assert.deepEqual(browserFailure.runs[0].events, [])
            await engine.cleanup(browserFailure.id)
          } finally {
            launch.mock.restore()
          }
          await preserved()
        },
      )
      await t.test(
        'provider failure leaves no invented candidate results and retry succeeds without mixing sessions',
        async () => {
          await engine.close()
          engine = new InvestigationEngine(root, {
            runLiveAgent: async () => {
              throw new Error('Provider HTTP 503 (test double)')
            },
          })
          const failed = engine.start('Provider failure', 'live')
          await engine.wait(failed.id)
          assert.equal(failed.status, 'error')
          assert.match(failed.error!, /Provider HTTP 503/)
          assert(failed.runs.every((r) => r.version === 'baseline'))
          assert.equal(failed.candidates[1].patch, undefined)
          const failedEvidence = JSON.stringify(failed)
          const retry = engine.start('Retry bundled investigation after failure', 'sample')
          await engine.wait(retry.id)
          assert.equal(retry.status, 'ready', retry.error)
          assert.equal(retry.runs.length, 6)
          assert(retry.runs.every((r) => r.attemptId === retry.attemptId))
          assert.equal(JSON.stringify(failed), failedEvidence)
          await engine.cleanup(failed.id)
          await engine.cleanup(retry.id)
          await preserved()
        },
      )
      const review = new InvestigationEngine(root)
      await review.restore()
      await review.cleanup(completed.id)
      assert.equal(review.state(completed.id).runs.length, 6)
      assert(review.state(completed.id).cleanedAt)
      assert(review.state(completed.id).candidates.every((candidate) => !candidate.ready))
      await review.close()
      await preserved()
      await writeFile(
        join(root, 'artifacts/reliability-proof.json'),
        JSON.stringify(
          { revision, dirty: before.dirty, snapshot: before.digest, originalPreserved: true },
          null,
          2,
        ),
      )
    } finally {
      await engine.close()
    }
  },
)

test('invalid repository and nested paths fail explicitly without creating candidates', async () => {
  const root = resolve('artifacts/reliability', `invalid repo ${randomUUID()}`)
  await mkdir(root, { recursive: true })
  const engine = new InvestigationEngine(root)
  const state = engine.start('Invalid repo', 'sample')
  await engine.wait(state.id)
  assert.equal(state.status, 'error')
  assert.match(state.error!, /checkout root|git .* failed/)
  assert.equal(
    state.candidates.some((c) => c.worktree),
    false,
  )
  assert.deepEqual(state.runs, [])
  await engine.close()
})
