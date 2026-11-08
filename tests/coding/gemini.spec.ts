import { test, expect, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { command } from '../../runner/process.ts'
import { sourceSnapshot } from '../../runner/coding-files.ts'
import { WindowsCredentialStore } from '../../runner/credentials.ts'
import { scenarioView, replayTools } from './scenario-editor-helpers.ts'
import type { CodingConfig, CodingSession } from '../../shared/coding.ts'
import {
  createGeminiAcceptanceRepo,
  greetingTask,
  greetingFollowup,
  replayTask,
  geminiScenario,
  reportGuard,
  reportKeyed,
} from './gemini-fixture.ts'

test.use({ trace: 'off', actionTimeout: 15000 })
test.setTimeout(900000)
async function freePort() {
  const s = createServer()
  s.listen(0, '127.0.0.1')
  await once(s, 'listening')
  const a = s.address()
  if (!a || typeof a === 'string') throw new Error('Missing port')
  await new Promise<void>((r) => s.close(() => r()))
  return a.port
}
async function ready(url: string) {
  for (let i = 0; i < 300; i++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return
    await delay(100)
  }
  throw new Error('App did not start: ' + url)
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (process.platform === 'win32')
    await command(process.cwd(), 'taskkill.exe', ['/PID', String(child.pid), '/T', '/F'])
  else process.kill(-child.pid!, 'SIGKILL')
  await exited
}
async function acceptance(page: Page, base: string, runnerURL: string, dir: string, live: boolean) {
  const resume = live && Boolean(process.env.PARALLAX_GEMINI_RESUME_DIR)
  const previous = resume
    ? (JSON.parse(await readFile(join(dir, 'first-task.json'), 'utf8')) as CodingSession)
    : undefined
  const repo = previous?.repo.path ?? (await createGeminiAcceptanceRepo(dir)),
    original = await sourceSnapshot(repo)
  let selected: string, first: CodingSession, initialCheck: { exitCode: number }
  await writeFile(join(dir, 'scenario.json'), JSON.stringify(geminiScenario, null, 2))
  await writeFile(
    join(dir, 'instructions.json'),
    JSON.stringify({ repo, greetingTask, greetingFollowup, replayTask }, null, 2),
  )
  const current = async (): Promise<CodingSession> => {
    const id = await page.evaluate(() => localStorage.getItem('parallax-coding-session'))
    return (await (await fetch(runnerURL + '/api/coding/sessions/' + id)).json()) as CodingSession
  }
  async function finish(readyStatus = true) {
    for (let i = 0; i < 6000; i++) {
      const state = await current()
      if (!state.busy) {
        if (readyStatus) expect(state.status, state.error).toBe('ready')
        return state
      }
      if (state.approval) {
        const approval = state.approval
        const owned =
          state.candidates.some((c) => c.worktree === approval.cwd) ||
          state.projectReplay?.baselineWorktree === approval.cwd
        const safe =
          owned &&
          approval.executable === 'node' &&
          (JSON.stringify(approval.args) === JSON.stringify(['--test', 'greet.test.cjs']) ||
            JSON.stringify(approval.args) === JSON.stringify(['--check', 'report.js']) ||
            (approval.args.length === 2 &&
              approval.args[0] === 'report-server.cjs' &&
              /^\d+$/.test(approval.args[1])))
        const panel = page.getByRole('region', { name: 'Command approval' })
        await expect(panel).toHaveAttribute('data-request-id', approval.id)
        await expect(panel).toContainText(approval.cwd)
        await panel
          .getByRole('button', { name: safe ? 'Approve command' : 'Skip command', exact: true })
          .click()
      }
      await page.waitForTimeout(100)
    }
    throw new Error(
      'Gemini acceptance exceeded its bounded wait; inspect retained session evidence.',
    )
  }
  async function checkGreet(state: CodingSession, uppercase = false) {
    expect(state.repo.path).toBe(repo)
    expect(state.candidates[0].files.map((f) => f.path)).toContain('greet.cjs')
    expect(
      state.checks.some(
        (c) =>
          c.turn === state.turn && c.status === 'passed' && c.command.includes('greet.test.cjs'),
      ),
    ).toBe(true)
    const checks = `const assert=require('node:assert/strict'),greet=require(${JSON.stringify(join(state.candidates[0].worktree, 'greet.cjs'))});assert.equal(greet(' Ada '),'Hello, Ada!');assert.equal(greet('  '),'Hello, friend!');${uppercase ? "assert.equal(greet(' Ada ',{uppercase:true}),'HELLO, ADA!');assert.equal(greet('',{uppercase:true}),'HELLO, FRIEND!');" : ''}`
    const result = await command(dir, process.execPath, ['-e', checks])
    expect(result.exitCode, result.output).toBe(0)
    return { exitCode: result.exitCode }
  }
  await ready(base)
  await page.goto(base)
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible({ timeout: 15000 })
  if (!previous) {
    await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Manage providers' })
    await settings.getByRole('tab', { name: 'Google Gemini', exact: true }).click()
    if (live) {
      const config = (await (await fetch(runnerURL + '/api/coding/config')).json()) as CodingConfig
      expect(
        config.providers?.gemini.keySource,
        'Enter your key through Gemini settings first; never pass it to this test.',
      ).not.toBe('none')
      expect(config.providers?.testTransport).toBe(false)
    }
    await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(settings.getByLabel('Available model')).toBeEnabled({ timeout: 30000 })
    const config = (await (await fetch(runnerURL + '/api/coding/config')).json()) as CodingConfig
    const models = config.providers!.gemini.models
    expect(models.length).toBeGreaterThan(0)
    selected =
      config.providers?.selection?.provider === 'gemini' &&
      models.includes(config.providers.selection.model)
        ? config.providers.selection.model
        : models[0]
    await settings.getByLabel('Available model').selectOption(selected)
    console.log(
      `${live ? 'LIVE Gemini' : 'Gemini PROTOCOL DOUBLE — NO MODEL'} requested model: ${selected}`,
    )
    await writeFile(
      join(dir, 'verification-start.json'),
      JSON.stringify(
        {
          live,
          repo,
          selected,
          maxToolRounds: config.providers?.maxToolRounds,
          baseline: original.revision,
        },
        null,
        2,
      ),
    )
    await settings.getByRole('button', { name: 'Run coding-agent check', exact: true }).click()
    await expect(settings.getByText(/Harmless tool-call round trip passed/)).toBeVisible({
      timeout: 100000,
    })
    await settings.getByRole('button', { name: 'Use model for new sessions', exact: true }).click()
    await expect(
      settings.getByRole('button', { name: 'Close provider settings', exact: true }),
    ).toBeEnabled()
    await settings.getByRole('button', { name: 'Close provider settings', exact: true }).click()
    await page.getByLabel('Local repository path').fill(repo)
    await page.getByRole('button', { name: 'Open repository', exact: true }).click()
    await expect(page.locator('.coding-baseline')).toContainText(repo)
    await page.getByLabel('Coding task', { exact: true }).fill(greetingTask)
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await expect(page.getByLabel('Follow-up instruction')).toBeVisible()
    first = await finish()
    initialCheck = await checkGreet(first)
    expect(first.modelSelection?.provider).toBe('gemini')
    expect(first.modelSelection?.model).toBe(selected)
    expect(first.providerRuns?.at(-1)?.toolCalls).toBeGreaterThan(0)
    if (first.providerRuns?.at(-1)?.usage?.totalTokens)
      await expect(page.getByTestId('provider-run').last()).toContainText('Tokens')
    await writeFile(join(dir, 'first-task.json'), JSON.stringify(first, null, 2))
  } else {
    first = previous
    selected = first.modelSelection!.model
    initialCheck = await checkGreet(first)
    console.log(`LIVE Gemini explicit continuation from retained edits: ${selected}`)
    await page.getByRole('combobox', { name: 'Saved coding sessions' }).selectOption(first.id)
    await expect(page.getByLabel('Follow-up instruction')).toBeVisible()
  }
  // Pace separate live tasks; this is a fixed acceptance-stage pause, not an API retry loop.
  if (live && !resume) {
    console.log('Live acceptance: allowing a 65-second request-rate window before follow-up.')
    await page.waitForTimeout(65000)
  }
  await page
    .getByLabel('Follow-up instruction')
    .fill(
      resume
        ? greetingFollowup +
            ' The previous attempt stopped on a rate limit after retaining edits. Inspect the current files and finish from those edits; do not start over. Batch independent reads in a single response, then request the exact Node test.'
        : greetingFollowup,
    )
  await page.getByRole('button', { name: 'Continue session', exact: true }).click()
  const followed = await finish(),
    followupCheck = await checkGreet(followed, true)
  await writeFile(join(dir, 'followup.json'), JSON.stringify(followed, null, 2))
  await page.screenshot({ path: join(dir, 'followup.png'), fullPage: true })
  await page.getByRole('button', { name: 'New coding session', exact: true }).click()
  await page.getByLabel('Coding task', { exact: true }).fill(replayTask)
  await page.getByRole('checkbox', { name: 'Investigate browser behavior' }).check()
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Project browser replay' })).toBeVisible()
  await finish()
  await scenarioView(page, 'json')
  await page.getByLabel('Replay scenario JSON').fill(JSON.stringify(geminiScenario))
  await page.getByRole('button', { name: 'Save scenario', exact: true }).click()
  await expect(page.locator('.replay-editor')).toContainText('Replay scenario r1')
  await page.getByRole('button', { name: 'Replay Baseline', exact: true }).click()
  const baseline = await finish()
  expect(baseline.projectReplay?.runs.at(-1)?.status).toBe('failed')
  if (live) {
    console.log(
      'Live acceptance: allowing a 65-second request-rate window before generating both fixes.',
    )
    await page.waitForTimeout(65000)
  }
  await replayTools(page)
  await page.getByRole('button', { name: 'Generate two fixes', exact: true }).click()
  const fixes = await finish()
  expect(fixes.candidates).toHaveLength(2)
  expect(fixes.candidates.every((c) => c.files.some((f) => f.path === 'report.js'))).toBe(true)
  const [a, b] = await Promise.all(
    fixes.candidates.map((c) => readFile(join(c.worktree, 'report.js'), 'utf8')),
  )
  expect(a).not.toBe(b)
  await writeFile(join(dir, 'fixes.json'), JSON.stringify(fixes, null, 2))
  await page.getByRole('button', { name: 'Replay all', exact: true }).click()
  const replayed = await finish()
  expect(replayed.projectReplay?.runs.slice(-3).map((r) => r.status)).toEqual([
    'failed',
    'passed',
    'passed',
  ])
  expect(replayed.projectReplay?.runs.slice(-3).some((r) => r.coverage.different)).toBe(false)
  await page.screenshot({ path: join(dir, 'two-fixes.png'), fullPage: true })
  // Both candidates must also preserve the ordinary response order.
  await page.getByRole('button', { name: 'Move response old earlier', exact: true }).click()
  await page.getByRole('button', { name: 'Replay all', exact: true }).click()
  const ordered = await finish()
  expect(ordered.projectReplay?.runs.slice(-3).map((r) => r.status)).toEqual([
    'passed',
    'passed',
    'passed',
  ])
  expect((await sourceSnapshot(repo)).digest).toBe(original.digest)
  const proof = {
    live,
    repo,
    selected,
    initialCheck,
    followupCheck,
    providerRuns: [...(followed.providerRuns ?? []), ...(ordered.providerRuns ?? [])],
    responseOrders: ordered.projectReplay?.runs.map((r) => ({
      version: r.version,
      order: r.order,
      status: r.status,
      coverage: r.coverage,
    })),
    sourcePreserved: true,
  }
  await writeFile(join(dir, 'proof.json'), JSON.stringify(proof, null, 2))
  await writeFile(
    resolve(`artifacts/gemini-${live ? 'live' : 'double'}-latest.json`),
    JSON.stringify({ directory: dir }, null, 2),
  )
  return proof
}

test('Gemini protocol double: settings, streamed tools, follow-up, usage and two real replay fixes', async ({
  page,
}) => {
  test.setTimeout(180000)
  const id = randomUUID(),
    dir = resolve('artifacts/gemini-double', id),
    target = `PARALLAX AI/Test/${id}`,
    vault = new WindowsCredentialStore(target + '/Gemini')
  await mkdir(dir, { recursive: true })
  const key = 'inert-gemini-double-' + id
  const failures: string[] = []
  const double = createServer(async (req, res) => {
    try {
      if (req.headers['x-goog-api-key'] !== key) {
        res.writeHead(403)
        res.end('{}')
        return
      }
      if (req.url?.startsWith('/v1beta/models?')) {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            models: [
              { name: 'models/pro-double', supportedGenerationMethods: ['generateContent'] },
              {
                name: 'models/gemini-flash-lite-double',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          }),
        )
        return
      }
      let raw = ''
      for await (const c of req) raw += String(c)
      const body = JSON.parse(raw),
        contents = body.contents as {
          role: string
          parts: {
            text?: string
            functionCall?: { id: string }
            functionResponse?: { id: string }
          }[]
        }[]
      const responded = contents.flatMap((c) => c.parts).filter((p) => p.functionResponse).length
      const task =
        contents
          .filter((c) => c.role === 'user' && c.parts.some((p) => p.text))
          .at(-1)
          ?.parts.map((p) => p.text ?? '')
          .join('') ?? ''
      const probe = body.tools[0].functionDeclarations.some(
        (d: { name: string }) => d.name === 'parallax_probe',
      )
      const replay = /Implement two materially different/.test(task),
        followup = /uppercase:true/.test(task)
      let calls: { name: string; args: Record<string, unknown> }[] = []
      if (probe && !responded)
        calls = [{ name: 'parallax_probe', args: { value: 'parallax-ready' } }]
      else if (!probe && responded === 0)
        calls = [
          { name: 'read_instructions', args: {} },
          { name: 'read_file', args: { path: replay ? 'report.js' : 'greet.cjs' } },
        ]
      else if (!probe && responded === 2)
        calls = replay
          ? [
              {
                name: 'write_file',
                args: {
                  path: 'report.js',
                  content: /Candidate: Candidate B\./.test(body.systemInstruction.parts[0].text)
                    ? reportKeyed
                    : reportGuard,
                },
              },
            ]
          : [
              {
                name: 'write_file',
                args: {
                  path: 'greet.cjs',
                  content: `module.exports=(name,options={})=>{const value='Hello, '+(String(name).trim()||'friend')+'!';return ${followup ? 'options.uppercase?value.toUpperCase():value' : 'value'};};\n`,
                },
              },
              {
                name: 'write_file',
                args: {
                  path: 'greet.test.cjs',
                  content:
                    "const {test}=require('node:test'),assert=require('node:assert/strict'),greet=require('./greet.cjs');test('greeting',()=>{assert.equal(greet(' Ada '),'Hello, Ada!');assert.equal(greet(' '),'Hello, friend!');assert.equal(process.env.GEMINI_API_KEY,undefined);assert.equal(process.env.GOOGLE_API_KEY,undefined);" +
                    (followup ? "assert.equal(greet('Ada',{uppercase:true}),'HELLO, ADA!');" : '') +
                    '});\n',
                },
              },
            ]
      else if (!probe && responded === (replay ? 3 : 4))
        calls = [
          { name: 'inspect_diff', args: {} },
          {
            name: 'run_command',
            args: {
              executable: 'node',
              args: replay ? ['--check', 'report.js'] : ['--test', 'greet.test.cjs'],
              cwd: '.',
            },
          },
        ]
      const parts = calls.length
        ? calls.map((c, i) => ({
            thoughtSignature: 'opaque-double-signature',
            functionCall: { id: `call-${responded}-${i}`, name: c.name, args: c.args },
          }))
        : [
            {
              text: probe
                ? 'parallax-acknowledged'
                : 'Protocol double completed the real tools. No live model.',
            },
          ]
      for (const c of contents.filter((c) => c.role === 'model'))
        for (const p of c.parts)
          if (p.functionCall && !('thoughtSignature' in p))
            failures.push('Missing thought signature')
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(
        'data: ' +
          JSON.stringify({
            modelVersion: 'gemini-flash-lite-double-snapshot',
            candidates: [{ content: { role: 'model', parts } }],
          }) +
          '\n\n',
      )
      res.end(
        'data: ' +
          JSON.stringify({
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4, totalTokenCount: 24 },
          }) +
          '\n\n',
      )
    } catch {
      failures.push('Protocol double handler failed')
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })
  double.listen(0, '127.0.0.1')
  await once(double, 'listening')
  const address = double.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  const runnerPort = await freePort(),
    browserPort = await freePort(),
    base = `http://127.0.0.1:${browserPort}`,
    runnerURL = `http://127.0.0.1:${runnerPort}`
  await vault.set(key)
  const runner = spawn(process.execPath, ['runner/server.ts'], {
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    env: {
      ...process.env,
      GEMINI_API_KEY: '',
      GOOGLE_API_KEY: '',
      OPENAI_API_KEY: '',
      PARALLAX_MODEL: '',
      PARALLAX_ENABLE_TEST_PROVIDER: '1',
      PARALLAX_TEST_PROVIDER_FILE: '',
      PARALLAX_GEMINI_TEST_URL: `http://127.0.0.1:${address.port}`,
      PARALLAX_CREDENTIAL_TARGET: target,
      PARALLAX_STATE_DIR: join(dir, 'sessions'),
      PARALLAX_RUNNER_PORT: String(runnerPort),
      PARALLAX_BROWSER_ORIGINS: base,
    },
  })
  const vite = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(browserPort),
      '--strictPort',
    ],
    {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      env: { ...process.env, PARALLAX_RUNNER_URL: runnerURL },
    },
  )
  try {
    await ready(runnerURL + '/api/health')
    const proof = await acceptance(page, base, runnerURL, dir, false)
    expect(failures).toEqual([])
    expect(proof.providerRuns.every((r) => r.testDouble)).toBe(true)
    expect(proof.providerRuns.every((r) => (r.usage?.totalTokens ?? 0) > 0)).toBe(true)
    expect(await (await fetch(runnerURL + '/api/coding/config')).text()).not.toContain(key)
  } finally {
    await stop(runner)
    await stop(vite)
    double.closeAllConnections()
    double.close()
    await vault.remove()
  }
})

test('LIVE Gemini: fresh task, follow-up and two candidate replay fixes on a separate Git repo', async ({
  page,
}) => {
  test.skip(
    process.env.PARALLAX_VERIFY_GEMINI_LIVE !== '1',
    'Opt-in only: consumes the configured real Gemini API quota.',
  )
  test.skip(
    Boolean(process.env.PARALLAX_GEMINI_FINALIZE_DIR),
    'Browser-only finalization explicitly requested; do not create more model calls.',
  )
  const dir = process.env.PARALLAX_GEMINI_RESUME_DIR
    ? resolve(process.env.PARALLAX_GEMINI_RESUME_DIR)
    : resolve('artifacts/gemini-live', randomUUID())
  await acceptance(page, 'http://127.0.0.1:1420', 'http://127.0.0.1:4317', dir, true)
})

test('LIVE Gemini retained fixes: browser-only finalization after an interrupted model turn', async ({
  page,
}) => {
  test.skip(
    !process.env.PARALLAX_GEMINI_FINALIZE_DIR || !process.env.PARALLAX_GEMINI_REPLAY_SESSION,
    'Only runs on explicit retained live evidence; makes no model calls.',
  )
  const dir = resolve(process.env.PARALLAX_GEMINI_FINALIZE_DIR!),
    sessionId = process.env.PARALLAX_GEMINI_REPLAY_SESSION!
  const root = 'http://127.0.0.1:4317',
    previous = JSON.parse(await readFile(join(dir, 'first-task.json'), 'utf8')) as CodingSession
  const followed = JSON.parse(await readFile(join(dir, 'followup.json'), 'utf8')) as CodingSession
  const current = async () =>
    (await (await fetch(root + '/api/coding/sessions/' + sessionId)).json()) as CodingSession
  const generation = await current()
  expect(generation.repo.path).toBe(previous.repo.path)
  expect(generation.candidates).toHaveLength(2)
  expect(generation.candidates.every((c) => c.files.some((f) => f.path === 'report.js'))).toBe(true)
  for (const candidate of generation.candidates)
    expect(
      generation.checks.some(
        (c) =>
          c.candidate === candidate.id && c.status === 'passed' && c.command.includes('report.js'),
      ),
    ).toBe(true)
  expect(generation.candidates[0].patch).not.toBe(generation.candidates[1].patch)
  await writeFile(join(dir, 'fixes.json'), JSON.stringify(generation, null, 2))
  const original = await sourceSnapshot(generation.repo.path)
  expect(original.digest).toBe(previous.baseline.digest)
  await page.goto('http://127.0.0.1:1420')
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible({ timeout: 15000 })
  await page.getByRole('combobox', { name: 'Saved coding sessions' }).selectOption(sessionId)
  await expect(page.getByLabel('Follow-up instruction')).toBeVisible()
  if ((await current()).projectReplay?.order[0] === 'old')
    await page.getByRole('button', { name: 'Move response current earlier', exact: true }).click()
  async function replay() {
    await page.getByRole('button', { name: 'Replay all', exact: true }).click()
    for (let i = 0; i < 1200; i++) {
      const state = await current()
      if (!state.busy) {
        expect(state.status, state.error).toBe('ready')
        return state
      }
      if (state.approval) {
        const a = state.approval,
          owned =
            state.candidates.some((c) => c.worktree === a.cwd) ||
            state.projectReplay?.baselineWorktree === a.cwd
        expect(owned).toBe(true)
        expect(a.executable).toBe('node')
        expect(
          (a.args[0] === '--check' && a.args[1] === 'report.js') ||
            (a.args[0] === 'report-server.cjs' && /^\d+$/.test(a.args[1])),
        ).toBe(true)
        await expect(page.getByRole('region', { name: 'Command approval' })).toHaveAttribute(
          'data-request-id',
          a.id,
        )
        await page.getByRole('button', { name: 'Approve command', exact: true }).click()
      }
      await page.waitForTimeout(100)
    }
    throw new Error('Retained replay did not finish.')
  }
  const reversed = await replay()
  expect(reversed.projectReplay?.runs.slice(-3).map((r) => r.status)).toEqual([
    'failed',
    'passed',
    'passed',
  ])
  expect(reversed.projectReplay?.runs.slice(-3).some((r) => r.coverage.different)).toBe(false)
  await page.screenshot({ path: join(dir, 'two-fixes.png'), fullPage: true })
  await page.getByRole('button', { name: 'Move response old earlier', exact: true }).click()
  const ordered = await replay()
  expect(ordered.projectReplay?.runs.slice(-3).map((r) => r.status)).toEqual([
    'passed',
    'passed',
    'passed',
  ])
  expect((await sourceSnapshot(generation.repo.path)).digest).toBe(original.digest)
  const proof = {
    live: true,
    browserOnlyFinalization: true,
    generationInterrupted: generation.providerRuns?.some((r) => r.status === 'failed'),
    generationError: generation.error,
    repo: generation.repo.path,
    selected: previous.modelSelection?.model,
    providerRuns: [...(followed.providerRuns ?? []), ...(generation.providerRuns ?? [])],
    initialCheck: { passed: true, evidence: 'first-task.json' },
    followupCheck: { passed: true, evidence: 'followup.json' },
    responseOrders: ordered.projectReplay?.runs.map((r) => ({
      version: r.version,
      order: r.order,
      status: r.status,
      coverage: r.coverage,
    })),
    sourcePreserved: true,
  }
  await writeFile(join(dir, 'proof.json'), JSON.stringify(proof, null, 2))
  await writeFile(
    resolve('artifacts/gemini-live-latest.json'),
    JSON.stringify({ directory: dir }, null, 2),
  )
})
