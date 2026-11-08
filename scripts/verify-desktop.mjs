import { chromium, expect } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { checkInstalledReplay } from './desktop-replay-check.mjs'

// Verification runs the INSTALLED executable. No frontend or runner is started here.
const exe = process.env.PARALLAX_INSTALLED_EXE
if (!exe || !exe.includes(' '))
  throw Error('Set PARALLAX_INSTALLED_EXE to the installed path with spaces.')
const id = randomUUID(),
  artifact = resolve('artifacts/desktop', id)
const data = join(process.env.LOCALAPPDATA, 'dev.parallax-ai.desktop', `verification-${id}`)
const repo = join(data, 'feature repo with spaces'),
  provider = join(data, 'controlled-provider.json')
await mkdir(repo, { recursive: true })
await mkdir(artifact, { recursive: true })
await writeFile(
  resolve('artifacts/desktop/latest.json'),
  JSON.stringify({ artifact, data, exe }, null, 2),
)
const git = join(exe, '..', 'resources/desktop/git/cmd/git.exe')
const runGit = (args) => execFileSync(git, args, { cwd: repo, windowsHide: true, encoding: 'utf8' })
await writeFile(
  join(repo, 'package.json'),
  JSON.stringify({
    name: 'desktop-verification',
    private: true,
    type: 'module',
    scripts: { test: 'node --test math.test.js' },
  }),
)
await writeFile(join(repo, 'math.js'), 'export const greet = name => `Hello, ${name}!`\n')
await writeFile(
  join(repo, 'math.test.js'),
  "import {test} from 'node:test';import assert from 'node:assert/strict';import {greet} from './math.js';test('greeting',()=>assert.equal(greet('Ada'),'Hello, Ada!'))\n",
)
runGit(['init', '--initial-branch=main'])
runGit(['add', '.'])
runGit([
  '-c',
  'user.name=Desktop Verification',
  '-c',
  'user.email=desktop@parallax.invalid',
  'commit',
  '-m',
  'Verification seed',
])
const call = (name, args = {}) => ({ name, args })
const check = call('run_command', { executable: 'npm', args: ['run', 'test'], cwd: '.' })
const first = 'export const greet = name => `Welcome, ${name}!`\n'
const testSource =
  "import {test} from 'node:test';import assert from 'node:assert/strict';import {greet} from './math.js';test('greeting',()=>assert.equal(greet('Ada'),'Welcome, Ada!'))\n"
await writeFile(
  provider,
  JSON.stringify({
    turns: [
      {
        calls: [
          call('read_instructions'),
          call('read_file', { path: 'math.js' }),
          call('write_file', { path: 'math.js', content: first }),
          call('write_file', { path: 'math.test.js', content: testSource }),
          call('inspect_diff'),
          check,
        ],
        message: 'CONTROLLED PROVIDER — greeting edited and real approved test executed.',
      },
      {
        calls: [
          call('read_file', { path: 'math.js' }),
          call('write_file', {
            path: 'README.md',
            content: 'The greeting says Welcome. Follow-up retained the first edit.\n',
          }),
          call('inspect_diff'),
          check,
        ],
        message: 'CONTROLLED PROVIDER — follow-up kept the existing edit and reran the test.',
      },
    ],
  }),
)
let app, browser, page
const proof = {
  exe,
  data,
  provider: 'Scripted controlled provider — no live model',
  scenarios: {},
  errors: [],
}
const blocker = createServer((_request, response) => response.end('Verification owns port 1420.'))
blocker.listen(1420, '127.0.0.1')
await once(blocker, 'listening')
proof.scenarios.port1420Occupied = true
async function start() {
  app = spawn(exe, [], {
    cwd: process.env.TEMP,
    windowsHide: false,
    env: {
      ...process.env,
      PATH: [
        join(process.env.SystemRoot, 'System32'),
        process.env.SystemRoot,
        join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0'),
      ].join(';'),
      PARALLAX_DESKTOP_TEST: '1',
      PARALLAX_DESKTOP_DATA_DIR: data,
      PARALLAX_ENABLE_TEST_PROVIDER: '1',
      PARALLAX_TEST_PROVIDER_FILE: provider,
      PARALLAX_CREDENTIAL_TARGET: `PARALLAX AI/Test/${id}`,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        '--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1',
    },
  })
  for (let i = 0; i < 400; i++) {
    if (app.exitCode !== null) throw Error('Installed app exited during startup')
    if (
      await fetch('http://127.0.0.1:9223/json/version').then(
        (r) => r.ok,
        () => false,
      )
    )
      break
    await new Promise((r) => setTimeout(r, 100))
  }
  browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
  for (let attempt = 0; attempt < 150; attempt++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('parallax.localhost'))
    if (page) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!page)
    throw Error(
      'Installed WebView page not found: ' +
        JSON.stringify(
          browser
            .contexts()
            .flatMap((c) => c.pages())
            .map((p) => p.url()),
        ),
    )
  page.on('pageerror', (e) => proof.errors.push(e.message))
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible({ timeout: 30000 })
  proof.runtime = JSON.parse(await readFile(join(data, 'desktop-runtime.json'), 'utf8'))
  expect(proof.runtime.port).not.toBe(1420)
  expect(proof.runtime.payload.toLowerCase()).toContain(resolve(exe, '..').toLowerCase())
}
async function state() {
  return page.evaluate(async () => {
    const id = localStorage.getItem('parallax-coding-session')
    return (await fetch(`/api/coding/sessions/${id}`)).json()
  })
}
async function finish() {
  for (let i = 0; i < 600; i++) {
    const s = await state()
    if (s.approval) {
      await expect(page.getByRole('region', { name: 'Command approval' })).toContainText(
        s.approval.cwd,
      )
      await page.getByRole('button', { name: 'Approve command', exact: true }).click()
    }
    if (!s.busy) return s
    await page.waitForTimeout(100)
  }
  throw Error('Installed coding task did not finish')
}
async function stop(graceful = true) {
  if (!app) return
  if (graceful)
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`,
      ],
      { windowsHide: true },
    )
  else app.kill()
  for (let i = 0; i < 150 && app.exitCode === null; i++)
    await new Promise((r) => setTimeout(r, 100))
  if (app.exitCode === null) app.kill()
  await browser?.close().catch(() => {})
  app = undefined
}
try {
  await start()
  if (process.env.PARALLAX_DESKTOP_REPLAY_ONLY === '1') {
    proof.scenarios.mainReplay = await checkInstalledReplay({
      page,
      state,
      finish,
      data,
      artifact,
      provider,
      exe,
    })
  } else {
    proof.scenarios.privatePort =
      (await fetch(`http://127.0.0.1:${proof.runtime.port}/api/coding/config`)).status === 403
    await page.screenshot({ path: join(artifact, 'initial-window.png') })
    const picker = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        resolve('scripts/desktop-folder-check.ps1'),
        '-Repository',
        repo,
      ],
      { windowsHide: true },
    )
    let pickerOutput = ''
    picker.stdout.on('data', (c) => (pickerOutput += c))
    picker.stderr.on('data', (c) => (pickerOutput += c))
    await page.getByLabel('Local repository path').fill(repo)
    await page.getByRole('button', { name: 'Browse folders…', exact: true }).click()
    await new Promise((r, j) =>
      picker.on('exit', (code) => (code === 0 ? r() : j(Error(pickerOutput)))),
    )
    await expect(page.getByLabel('Local repository path')).toHaveValue(repo)
    await expect(page.locator('.coding-baseline')).toContainText('main')
    await expect(page.locator('.coding-baseline')).toContainText(repo)
    proof.scenarios.nativePicker = true
    console.log('Native folder selection passed.')
    await page.getByLabel('Coding provider', { exact: true }).selectOption('test')
    await page
      .getByLabel('Coding task', { exact: true })
      .fill(
        'Controlled provider verification: make the greeting say Welcome, update the project test, inspect the patch, and request npm run test.',
      )
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Command approval' })).toBeVisible({
      timeout: 30000,
    })
    await page.screenshot({ path: join(artifact, 'command-approval.png') })
    let s = await finish()
    expect(s.checks.findLast((check) => check.command.startsWith('npm ')).status).toBe('passed')
    expect(s.candidates[0].files).toHaveLength(2)
    const featureId = s.id
    await page
      .getByLabel('Follow-up instruction')
      .fill('Keep the Welcome change and add a README explaining it; rerun the project test.')
    await page.getByRole('button', { name: 'Continue session', exact: true }).click()
    s = await finish()
    expect(s.turn).toBe(2)
    expect(s.candidates[0].files).toHaveLength(3)
    await expect(page.locator('.coding-diff')).toContainText('Welcome')
    await page.screenshot({ path: join(artifact, 'patch-review.png') })
    proof.scenarios.coding = {
      id: s.id,
      checks: s.checks.map((c) => c.status),
      files: s.candidates[0].files.map((f) => f.path),
    }
    await stop()
    await start()
    s = await state()
    expect(s.id).toBe(featureId)
    expect(s.checks.findLast((check) => check.command.startsWith('npm ')).status).toBe('passed')
    expect(s.candidates[0].files).toHaveLength(3)
    proof.scenarios.completedRecovery = true
    console.log('Coding, approval, follow-up, diff and completed-session recovery passed.')
    // Leave an approved real command active, terminate the native process, then relaunch.
    await writeFile(
      provider,
      JSON.stringify({
        turns: [
          {
            calls: [
              call('read_file', { path: 'math.js' }),
              call('run_command', {
                executable: 'node',
                args: ['-e', "console.log('desktop recovery active');setTimeout(()=>{},60000)"],
                cwd: '.',
              }),
            ],
            message: 'Controlled interruption probe.',
          },
        ],
      }),
    )
    await page.getByRole('button', { name: 'New coding session', exact: true }).click()
    await page.getByLabel('Coding provider', { exact: true }).selectOption('test')
    await page
      .getByLabel('Coding task', { exact: true })
      .fill('Controlled command cancellation probe.')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await page.getByRole('button', { name: 'Approve command', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await state()).checks.some((c) => c.output.includes('desktop recovery active')),
        { timeout: 30000 },
      )
      .toBe(true)
    await page.getByRole('button', { name: 'Cancel turn', exact: true }).click()
    await expect.poll(async () => (await state()).busy).toBe(false)
    const cancelled = await state()
    proof.scenarios.cancellation = {
      session: cancelled.id,
      status: cancelled.status,
      checks: cancelled.checks.map((c) => c.status),
    }
    await page.getByRole('button', { name: 'New coding session', exact: true }).click()
    await page.getByLabel('Coding provider', { exact: true }).selectOption('test')
    await page
      .getByLabel('Coding task', { exact: true })
      .fill('Controlled interruption probe with an approved active command.')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await page.getByRole('button', { name: 'Approve command', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await state()).checks.some((c) => c.output.includes('desktop recovery active')),
        { timeout: 30000 },
      )
      .toBe(true)
    const interrupted = await state(),
      oldPid = proof.runtime.runnerPid
    await stop(false)
    await start()
    s = await state()
    expect(s.id).toBe(interrupted.id)
    expect(s.busy).toBe(false)
    expect(s.activity).toContain('Interrupted')
    proof.scenarios.interruptedRecovery = {
      session: s.id,
      status: s.status,
      activity: s.activity,
      checks: s.checks.map((c) => c.status),
      previousRunnerPid: oldPid,
    }
    await page.screenshot({ path: join(artifact, 'interrupted-session.png') })
    console.log('Cancellation and native crash/relaunch recovery passed.')
    // No-key pickup workflow uses the installed Node, Chromium, Git, Vite, and compiler.
    await page.goto('http://parallax.localhost/pickup')
    await expect(
      page.getByRole('button', { name: 'Start investigation', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
    await expect(page.locator('.cut-agent-status')).toContainText(
      'Investigation ready for review',
      {
        timeout: 180000,
      },
    )
    const pickup = await page.evaluate(async () => {
      const id = localStorage.getItem('parallax-investigation')
      return (await fetch(`/api/sessions/${id}`)).json()
    })
    expect(
      pickup.runs
        .filter((r) => r.version === 'baseline')
        .map((r) => r.status)
        .sort(),
    ).toEqual(['failed', 'passed'])
    for (const version of ['a', 'b'])
      expect(pickup.runs.filter((r) => r.version === version).map((r) => r.status)).toEqual([
        'passed',
        'passed',
      ])
    proof.scenarios.pickup = {
      id: pickup.id,
      runs: pickup.runs.map((r) => ({ version: r.version, order: r.schedule, status: r.status })),
      checks: pickup.checks.map((c) => ({ command: c.command, exitCode: c.exitCode })),
    }
    expect(pickup.checks.every((c) => c.exitCode === 0 || c.version === 'baseline')).toBe(true)
    await page.screenshot({ path: join(artifact, 'pickup-comparison.png') })
    proof.scenarios.mainReplay = await checkInstalledReplay({
      page,
      state,
      finish,
      data,
      artifact,
      provider,
      exe,
    })
  }
  proof.scenarios.sourcePreserved = runGit(['status', '--porcelain']) === ''
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2))
  console.log(`Installed app acceptance passed. Evidence: ${artifact}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(artifact, 'failure.png') }).catch(() => {})
  await writeFile(
    join(artifact, 'proof-partial.json'),
    JSON.stringify({ ...proof, failure: String(error) }, null, 2),
  )
  throw error
} finally {
  await stop()
  blocker.closeAllConnections()
  blocker.close()
}
