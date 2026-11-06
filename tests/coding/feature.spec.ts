import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { command, git } from '../../runner/process.ts'
import { sourceSnapshot } from '../../runner/coding-files.ts'
import type { CodingSession } from '../../shared/coding.ts'

const root = process.cwd()
test.setTimeout(180_000)
async function port() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  await new Promise<void>((r) => server.close(() => r()))
  return address.port
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (process.platform === 'win32')
    await command(root, 'taskkill.exe', ['/PID', String(child.pid), '/T', '/F'])
  else process.kill(-child.pid!, 'SIGKILL')
  await exited
}
async function waitFor(url: string) {
  for (let i = 0; i < 300; i++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return
    await delay(50)
  }
  throw new Error(`Server never became ready: ${url}`)
}

test('ordinary repo feature, follow-up, approved commands, transactional apply, and continuous restart recovery', async ({
  page,
}) => {
  const dir = resolve('artifacts/step2-acceptance', randomUUID())
  await mkdir(dir, { recursive: true })
  const seed = resolve('artifacts/step2-seed')
  if (
    !(await access(join(seed, '.git')).then(
      () => true,
      () => false,
    ))
  )
    await git(root, [
      'clone',
      '--depth',
      '1',
      '--',
      'https://github.com/jonschlinkert/is-number.git',
      seed,
    ])
  const repo = join(dir, 'number project with spaces'),
    clean = join(dir, 'clean apply target'),
    conflict = join(dir, 'conflicting target')
  for (const path of [repo, clean, conflict])
    await git(root, ['clone', '--shared', '--', seed, path])
  const original = await sourceSnapshot(repo)
  await writeFile(
    join(dir, 'AGENTS.md'),
    'Acceptance repository instructions: use Node built-in tests, preserve all existing predicate cases, and do not commit or push.\n',
  )
  const originalIndex = await git(repo, ['diff', '--cached', '--binary'])
  const index = await readFile(join(repo, 'index.js'), 'utf8')
  const first = index.replace(
    'function(num) {',
    "function(num) {\n  if (typeof num === 'bigint') return true;",
  )
  expect(first).not.toBe(index)
  const second = first
    .replace('function(num) {', 'function(num, options = {}) {')
    .replace(
      "if (typeof num === 'bigint') return true;",
      "if (typeof num === 'bigint') return options.allowBigInt === true;",
    )
  const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
  manifest.engines.node = '>=18'
  manifest.scripts = {
    ...manifest.scripts,
    build: 'node --check index.js',
    test: 'node --test test.js bigint.test.cjs',
  }
  const legacyTests = (await readFile(join(repo, 'test.js'), 'utf8')).replace(
    "require('mocha');",
    "var { describe, it } = require('node:test');",
  )
  const readme = await readFile(join(repo, 'README.md'), 'utf8')
  const firstTests = `const { test } = require('node:test'); const assert = require('node:assert/strict'); const isNumber = require('./');\ntest('bigint values are accepted', () => { assert.equal(isNumber(12n), true); assert.equal(isNumber(-12n), true); });\n`
  const secondTests = `const { test } = require('node:test'); const assert = require('node:assert/strict'); const isNumber = require('./');\ntest('bigint requires explicit opt in and existing values keep their behaviour', () => { assert.equal(isNumber(12n), false); assert.equal(isNumber(-12n, {allowBigInt:true}), true); assert.equal(isNumber(12n, {allowBigInt:false}), false); assert.equal(isNumber('12'), true); assert.equal(isNumber(Infinity), false); });\n`
  const write = (path: string, content: string) => ({ name: 'write_file', args: { path, content } })
  const read = (path: string) => ({ name: 'read_file', args: { path } })
  const checks = [
    { name: 'run_command', args: { executable: 'npm', args: ['run', 'build'], cwd: '.' } },
    { name: 'run_command', args: { executable: 'npm', args: ['run', 'test'], cwd: '.' } },
  ]
  const providerFile = join(dir, 'test-provider.json')
  await writeFile(
    providerFile,
    JSON.stringify({
      turns: [
        {
          calls: [
            { name: 'read_instructions', args: {} },
            { name: 'list_files', args: {} },
            { name: 'search_files', args: { query: 'module.exports' } },
            read('index.js'),
            read('test.js'),
            write('index.js', first),
            write('package.json', JSON.stringify(manifest, null, 2) + '\n'),
            write('test.js', legacyTests),
            write('bigint.test.cjs', firstTests),
            write(
              'README.md',
              readme + '\n## BigInt support\nBigInt values are supported on Node 18 and later.\n',
            ),
            { name: 'inspect_diff', args: {} },
            ...checks,
          ],
          message:
            'Test provider: implemented bigint support, preserved the legacy cases, and requested real build/test commands.',
        },
        {
          calls: [
            read('index.js'),
            read('bigint.test.cjs'),
            write('index.js', second),
            write('bigint.test.cjs', secondTests),
            write(
              'README.md',
              readme +
                '\n## BigInt support\nUse isNumber(value, { allowBigInt: true }) to opt in. The default rejects BigInt. Requires Node 18 or later.\n',
            ),
            { name: 'inspect_diff', args: {} },
            ...checks,
          ],
          message:
            'Test provider: continued from the existing implementation and made bigint support opt in. Actual command evidence is shown separately.',
        },
      ],
    }),
  )
  const runnerPort = await port(),
    browserPort = await port()
  const base = `http://127.0.0.1:${browserPort}`,
    runnerUrl = `http://127.0.0.1:${runnerPort}`
  let runner!: ChildProcess
  let logs = ''
  const startRunner = async () => {
    runner = spawn(process.execPath, ['--env-file-if-exists=.env', 'runner/server.ts'], {
      cwd: root,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PARALLAX_RUNNER_PORT: String(runnerPort),
        PARALLAX_STATE_DIR: join(dir, 'sessions'),
        PARALLAX_BROWSER_ORIGINS: base,
        PARALLAX_ENABLE_TEST_PROVIDER: '1',
        PARALLAX_TEST_PROVIDER_FILE: providerFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    runner.stdout!.on('data', (d) => {
      logs += String(d)
    })
    runner.stderr!.on('data', (d) => {
      logs += String(d)
    })
    await waitFor(runnerUrl + '/api/health')
  }
  await startRunner()
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
      cwd: root,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, PARALLAX_RUNNER_URL: runnerUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  vite.stdout!.on('data', (d) => {
    logs += String(d)
  })
  vite.stderr!.on('data', (d) => {
    logs += String(d)
  })
  const state = async (): Promise<CodingSession> => {
    const id = await page.evaluate(() => localStorage.getItem('parallax-coding-session'))
    return (await (await fetch(runnerUrl + `/api/coding/sessions/${id}`)).json()) as CodingSession
  }
  async function finish(verifyStale = false) {
    let approvals = 0
    for (let i = 0; i < 600; i++) {
      const value = await state()
      if (!value.busy) {
        expect(value.status, value.error).toBe('ready')
        return value
      }
      if (value.approval) {
        await expect(page.getByRole('region', { name: 'Command approval' })).toContainText(
          value.approval.cwd,
        )
        await expect(page.getByRole('region', { name: 'Command approval' })).toContainText(
          value.approval.executable,
        )
        if (verifyStale && approvals === 0)
          await expect(page.getByTestId('coding-check').filter({ hasText: 'STALE' })).toHaveCount(2)
        await page.getByRole('button', { name: 'Approve command', exact: true }).click()
        approvals++
      }
      await page.waitForTimeout(100)
    }
    throw new Error('Coding session did not finish')
  }
  try {
    await waitFor(base)
    await page.goto(base)
    await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Local repository path' }).fill(repo)
    await page.getByRole('button', { name: 'Open repository', exact: true }).click()
    await expect(page.locator('.coding-baseline')).toContainText(original.revision)
    await expect(page.locator('.coding-baseline')).toContainText('Clean checkout')
    await expect(page.getByRole('checkbox', { name: 'Compare approaches' })).not.toBeChecked()
    const cfg = await (await fetch(runnerUrl + '/api/coding/config')).json()
    const live = cfg.live.configured === true
    await page
      .getByRole('combobox', { name: 'Coding provider' })
      .selectOption(live ? 'live' : 'test')
    await page
      .getByRole('textbox', { name: 'Coding task', exact: true })
      .fill(
        'Add BigInt support to is-number, preserve all existing number/string behaviours, document it in README, and add bigint.test.cjs. Migrate the existing Mocha test.js to node:test without dropping cases. Set npm test to run both tests with node --test and add npm run build as node --check index.js. Require Node 18 or later. Run build and tests.',
      )
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Follow-up instruction' })).toBeVisible()
    const firstState = await finish()
    expect(firstState.candidates).toHaveLength(1)
    expect(
      firstState.events.some(
        (event) =>
          event.kind === 'read' && event.detail.includes('Acceptance repository instructions'),
      ),
    ).toBe(true)
    expect(firstState.candidates[0].files.length).toBeGreaterThanOrEqual(4)
    expect(firstState.checks.every((c) => c.status === 'passed')).toBe(true)
    if (!live)
      await expect(
        page.getByText('SCRIPTED TEST PROVIDER · NO MODEL', { exact: true }),
      ).toBeVisible()
    const candidatePath = firstState.candidates[0].worktree
    expect((await sourceSnapshot(repo)).digest).toBe(original.digest)
    await page
      .getByRole('textbox', { name: 'Follow-up instruction' })
      .fill(
        'Change the requirement: BigInt must be rejected by default and accepted only with the second argument { allowBigInt: true }, including negative BigInts. Continue from the existing implementation, keep all original tests and Node runner migration, update bigint.test.cjs and README, and rerun build and tests.',
      )
    await page.getByRole('button', { name: 'Continue session', exact: true }).click()
    const completed = await finish(!live)
    expect(completed.id).toBe(firstState.id)
    expect(completed.turn).toBe(2)
    expect(completed.candidates[0].worktree).toBe(candidatePath)
    expect(completed.checks.filter((c) => c.turn === 2).every((c) => c.status === 'passed')).toBe(
      true,
    )
    expect(
      completed.checks.some((c) => c.turn === 1 && c.digest !== completed.candidates[0].digest),
    ).toBe(true)
    await page.reload()
    await expect(page.locator('.coding-session-header')).toContainText('Turn 2')
    await page.getByRole('button', { name: 'modified · index.js', exact: true }).click()
    await expect(page.getByLabel('Selected file diff')).toContainText('allowBigInt')
    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Export patch', exact: true }).click()
    const patchPath = join(dir, 'exported.patch')
    await (await download).saveAs(patchPath)
    await git(clean, ['apply', '--check', patchPath])
    await page.getByRole('textbox', { name: 'Apply target checkout' }).fill(clean)
    await page.getByRole('button', { name: 'Apply to checkout', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: `Applied to ${clean}` })).toBeVisible()
    const npmPath =
      process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    const checked = await command(clean, process.execPath, [npmPath, 'run', 'test'])
    expect(checked.exitCode, checked.output).toBe(0)
    expect(await git(clean, ['diff', '--cached', '--binary'])).toBe('')
    await writeFile(join(conflict, 'index.js'), index + '\n// Existing unstaged conflict\n')
    await writeFile(join(conflict, 'README.md'), readme + '\nExisting staged user note\n')
    await git(conflict, ['add', 'README.md'])
    const conflictingBefore = await sourceSnapshot(conflict),
      stagedBefore = await git(conflict, ['diff', '--cached', '--binary'])
    await page.getByRole('textbox', { name: 'Apply target checkout' }).fill(conflict)
    await page.getByRole('button', { name: 'Apply to checkout', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Apply conflict')
    expect((await sourceSnapshot(conflict)).digest).toBe(conflictingBefore.digest)
    expect(await git(conflict, ['diff', '--cached', '--binary'])).toBe(stagedBefore)
    expect((await sourceSnapshot(repo)).digest).toBe(original.digest)
    expect(await git(repo, ['diff', '--cached', '--binary'])).toBe(originalIndex)
    // Actual source edits outside the provider invalidate earlier verification too.
    const verifiedIndex = await readFile(join(candidatePath, 'index.js'), 'utf8')
    await writeFile(
      join(candidatePath, 'index.js'),
      verifiedIndex + '\n// Candidate changed after verification\n',
    )
    await page.getByRole('button', { name: 'Refresh review', exact: true }).click()
    await expect(page.getByTestId('coding-check').filter({ hasText: 'STALE' })).toHaveCount(
      completed.checks.length,
    )
    await writeFile(join(candidatePath, 'index.js'), verifiedIndex)
    await page.getByRole('button', { name: 'Refresh review', exact: true }).click()
    // Leave the UI open while only its runner process is killed and restarted.
    await writeFile(
      providerFile,
      JSON.stringify({
        turns: [
          {
            calls: [
              {
                name: 'run_command',
                args: {
                  executable: 'node',
                  args: ['-e', "console.log('restart probe active');setInterval(()=>{},1000)"],
                  cwd: '.',
                },
              },
            ],
            message: 'This probe must be interrupted.',
          },
        ],
      }),
    )
    await page.getByRole('button', { name: 'New coding session', exact: true }).click()
    await page.getByRole('combobox', { name: 'Coding provider' }).selectOption('test')
    await page
      .getByRole('textbox', { name: 'Coding task', exact: true })
      .fill('Restart probe with a real active command; scripted provider only')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await page.getByRole('button', { name: 'Approve command', exact: true }).click()
    await expect
      .poll(async () =>
        (await state()).checks.some((c) => c.output.includes('restart probe active')),
      )
      .toBe(true)
    const interruptedId = (await state()).id
    await stop(runner)
    await expect(page.getByText('Reconnecting to runner…', { exact: true }).first()).toBeVisible()
    await startRunner()
    await expect(page.locator('.cut-agent-status')).toContainText('Interrupted by runner restart', {
      timeout: 30_000,
    })
    await expect(page.getByRole('textbox', { name: 'Follow-up instruction' })).toBeEnabled()
    expect((await state()).id).toBe(interruptedId)
    expect((await state()).checks[0].status).toBe('skipped')
    await page.getByRole('combobox', { name: 'Saved coding sessions' }).selectOption(completed.id)
    await expect(page.locator('.coding-session-header')).toContainText('Turn 2')
    await expect(page.getByLabel('Selected file diff')).toContainText('allowBigInt')
    await page.getByRole('button', { name: 'Refresh review', exact: true }).click()
    await expect(page.getByText('Missing local runner token.', { exact: true })).toHaveCount(0)
    expect((await state()).candidates[0].patch).toBe(completed.candidates[0].patch)
    await page.screenshot({
      path: join(dir, 'completed-feature-after-restart.png'),
      fullPage: true,
    })
    await writeFile(
      join(dir, 'proof.json'),
      JSON.stringify(
        {
          provider: live ? 'live' : 'scripted test provider (no model)',
          revision: original.revision,
          session: completed.id,
          featureChecks: completed.checks,
          appliedCheckoutTest: checked,
          conflictPreserved: true,
          continuousUIRestart: true,
          originalPreserved: true,
        },
        null,
        2,
      ),
    )
    // Denial must be visible as skipped and must not execute the command.
    await writeFile(
      providerFile,
      JSON.stringify({
        turns: [
          {
            calls: [
              {
                name: 'run_command',
                args: {
                  executable: 'node',
                  args: ['-e', "require('node:fs').writeFileSync('must-not-exist.txt','executed')"],
                  cwd: '.',
                },
              },
            ],
            message: 'Scripted denial probe complete; command skipped.',
          },
        ],
      }),
    )
    await page.getByRole('button', { name: 'New coding session', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Compare approaches' }).check()
    await page.getByRole('combobox', { name: 'Coding provider' }).selectOption('test')
    await page
      .getByRole('textbox', { name: 'Coding task', exact: true })
      .fill('Compare two isolated approaches with denied commands')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    for (let i = 0; i < 2; i++)
      await page.getByRole('button', { name: 'Skip command', exact: true }).click()
    await expect(page.locator('.cut-agent-status')).toContainText('Ready for review')
    const denied = await state()
    expect(denied.candidates).toHaveLength(2)
    expect(denied.checks.every((c) => c.status === 'skipped')).toBe(true)
    for (const candidate of denied.candidates)
      await expect(access(join(candidate.worktree, 'must-not-exist.txt'))).rejects.toThrow()
    await writeFile(
      providerFile,
      JSON.stringify({
        turns: [
          {
            calls: [
              {
                name: 'run_command',
                args: {
                  executable: 'node',
                  args: [
                    '-e',
                    "require('node:fs').writeFileSync('approval-must-not-execute.txt','executed')",
                  ],
                  cwd: '.',
                },
              },
              {
                name: 'run_command',
                args: {
                  executable: 'node',
                  args: ['-e', "console.error('Expected check failure probe');process.exit(7)"],
                  cwd: '.',
                },
              },
            ],
            message:
              'Scripted probes report skipped and failed commands, never a passed verification.',
          },
        ],
      }),
    )
    await page.getByRole('button', { name: 'New coding session', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Compare approaches' }).uncheck()
    await page
      .getByRole('textbox', { name: 'Coding task', exact: true })
      .fill('Approval mutation and failed-check probe')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Command approval' })).toBeVisible()
    const pending = await state()
    await writeFile(
      join(pending.candidates[0].worktree, 'index.js'),
      index + '\n// Changed while awaiting command approval\n',
    )
    await page.getByRole('button', { name: 'Approve command', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Command approval' })).toContainText(
      'process.exit(7)',
    )
    await page.getByRole('button', { name: 'Approve command', exact: true }).click()
    await expect(page.locator('.cut-agent-status')).toContainText('Ready for review')
    const failed = await state()
    expect(failed.checks[0].status).toBe('skipped')
    expect(failed.checks[0].output).toContain('Source changed while awaiting approval')
    expect(failed.checks.find((check) => check.exitCode === 7)?.status).toBe('failed')
    await expect(
      access(join(pending.candidates[0].worktree, 'approval-must-not-execute.txt')),
    ).rejects.toThrow()
    await expect(page.getByTestId('coding-check').filter({ hasText: 'FAILED' })).toHaveCount(1)
  } finally {
    await stop(runner)
    await stop(vite)
    await writeFile(join(dir, 'server.log'), logs)
  }
})
