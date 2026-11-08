import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile, readFile, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { command } from '../../runner/process.ts'
import { WindowsCredentialStore } from '../../runner/credentials.ts'
import { scenarioView, replayTools } from './scenario-editor-helpers.ts'
import { sourceSnapshot } from '../../runner/coding-files.ts'
import type { CodingSession } from '../../shared/coding.ts'
import {
  createGeminiAcceptanceRepo,
  geminiScenario,
  reportGuard,
  reportKeyed,
} from './gemini-fixture.ts'

test.use({ trace: 'off', actionTimeout: 15000 })
test.setTimeout(180000)
async function port() {
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
    await delay(50)
  }
  throw new Error('Server not ready: ' + url)
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exit = once(child, 'exit')
  if (process.platform === 'win32')
    await command(process.cwd(), 'taskkill.exe', ['/PID', String(child.pid), '/T', '/F'])
  else process.kill(-child.pid!, 'SIGKILL')
  await exit
}

test('recovery UI: A then B, approval restart, separate replay status, exact resume, bounded retry cancellation', async ({
  page,
}) => {
  const id = randomUUID(),
    dir = resolve('artifacts/step5-browser', id),
    repo = await createGeminiAcceptanceRepo(dir)
  await writeFile(
    join(repo, '.gitignore'),
    (await readFile(join(repo, '.gitignore'), 'utf8').catch(() => '')) + '\n.recovery-count\n',
  )
  await writeFile(
    join(repo, 'check-report.cjs'),
    "const fs=require('node:fs'),vm=require('node:vm');fs.appendFileSync('.recovery-count','x');new vm.Script(fs.readFileSync('report.js','utf8'));console.log('Actual syntax check passed');\n",
  )
  const original = await sourceSnapshot(repo),
    target = `PARALLAX AI/Test/${id}`,
    key = 'inert-step5-key-' + id
  const vault = new WindowsCredentialStore(target + '/Gemini')
  await vault.set(key)
  let blockB = true,
    blockBefore = true
  const signed = 'opaque-recovery-signature'
  const provider = createServer(async (req, res) => {
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
            { name: 'models/recovery-ui-double', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      )
      return
    }
    let raw = ''
    for await (const c of req) raw += String(c)
    const body = JSON.parse(raw),
      context = body.contents as { parts: { functionResponse?: unknown; text?: string }[] }[]
    const count = context.flatMap((c) => c.parts).filter((p) => p.functionResponse).length
    const probe = body.tools[0].functionDeclarations.some(
      (d: { name: string }) => d.name === 'parallax_probe',
    )
    const task = context
      .flatMap((c) => c.parts)
      .map((p) => p.text ?? '')
      .join(' ')
    if (task.includes('wait before edit') && !probe && blockBefore) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '2' })
      res.end(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }))
      return
    }
    const b = /Candidate: Candidate B\./.test(body.systemInstruction.parts[0].text)
    if (!probe && b && count >= 2 && blockB) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'quota_exceeded' } }))
      return
    }
    const calls = probe
      ? count
        ? []
        : [{ name: 'parallax_probe', args: { value: 'parallax-ready' } }]
      : task.includes('wait before edit') || count
        ? []
        : [
            {
              name: 'write_file',
              args: { path: 'report.js', content: b ? reportKeyed : reportGuard },
            },
            {
              name: 'run_command',
              args: { executable: 'node', args: ['check-report.cjs'], cwd: '.' },
            },
          ]
    const parts = calls.length
      ? calls.map((call, index) => ({
          thoughtSignature: signed,
          functionCall: { id: 'call-' + index, name: call.name, args: call.args },
        }))
      : [{ text: probe ? 'parallax-acknowledged' : 'Controlled provider completed; NO MODEL.' }]
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: ' +
        JSON.stringify({
          modelVersion: 'recovery-ui-double',
          candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
        }) +
        '\n\n',
    )
  })
  provider.listen(0, '127.0.0.1')
  await once(provider, 'listening')
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  const providerURL = `http://127.0.0.1:${address.port}`
  const runnerPort = await port(),
    browserPort = await port(),
    root = `http://127.0.0.1:${runnerPort}`,
    base = `http://127.0.0.1:${browserPort}`
  let runner: ChildProcess | undefined,
    logs = ''
  const collect = (p: ChildProcess) => {
    p.stdout!.on('data', (d) => {
      logs += String(d)
    })
    p.stderr!.on('data', (d) => {
      logs += String(d)
    })
  }
  async function startRunner() {
    runner = spawn(process.execPath, ['runner/server.ts'], {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GEMINI_API_KEY: '',
        GOOGLE_API_KEY: '',
        OPENAI_API_KEY: '',
        PARALLAX_MODEL: '',
        PARALLAX_ENABLE_TEST_PROVIDER: '1',
        PARALLAX_TEST_PROVIDER_FILE: '',
        PARALLAX_GEMINI_TEST_URL: providerURL,
        PARALLAX_CREDENTIAL_TARGET: target,
        PARALLAX_STATE_DIR: join(dir, 'sessions'),
        PARALLAX_RUNNER_PORT: String(runnerPort),
        PARALLAX_BROWSER_ORIGINS: base,
      },
    })
    collect(runner)
    await ready(root + '/api/health')
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
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PARALLAX_RUNNER_URL: root },
    },
  )
  collect(vite)
  const state = async (): Promise<CodingSession> => {
    const id = await page.evaluate(() => localStorage.getItem('parallax-coding-session'))
    return (await (await fetch(root + '/api/coding/sessions/' + id)).json()) as CodingSession
  }
  async function finish() {
    for (let i = 0; i < 1200; i++) {
      const s = await state()
      if (!s.busy) return s
      if (s.approval) {
        await expect(page.getByRole('region', { name: 'Command approval' })).toHaveAttribute(
          'data-request-id',
          s.approval.id,
        )
        await page.getByRole('button', { name: 'Approve command', exact: true }).click()
      }
      await page.waitForTimeout(50)
    }
    throw new Error('Recovery flow did not finish')
  }
  try {
    await ready(base)
    await page.goto(base)
    await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Manage providers' })
    await settings.getByRole('tab', { name: 'Google Gemini', exact: true }).click()
    await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(settings.getByLabel('Available model')).toBeEnabled()
    await settings.getByRole('button', { name: 'Run coding-agent check', exact: true }).click()
    await expect(settings.getByText(/Harmless tool-call round trip passed/)).toBeVisible()
    await settings.getByRole('button', { name: 'Use model for new sessions', exact: true }).click()
    await settings.getByRole('button', { name: 'Close provider settings', exact: true }).click()
    await page.getByLabel('Local repository path').fill(repo)
    await page.getByRole('button', { name: 'Open repository', exact: true }).click()
    await expect(page.locator('.coding-baseline')).toContainText(repo)
    await page
      .getByLabel('Coding task', { exact: true })
      .fill('Investigate the team-report stale response. Controlled provider, no live model.')
    await page.getByRole('checkbox', { name: 'Investigate browser behavior' }).check()
    await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Project browser replay' })).toBeVisible()
    await finish()
    await scenarioView(page, 'json')
    await page.getByLabel('Replay scenario JSON').fill(JSON.stringify(geminiScenario))
    await page.getByRole('button', { name: 'Save scenario', exact: true }).click()
    await expect(page.locator('.replay-editor')).toContainText('Replay scenario r1')
    await page.getByRole('button', { name: 'Replay Baseline', exact: true }).click()
    await finish()
    await replayTools(page)
    await page.getByRole('button', { name: 'Generate Candidate A first', exact: true }).click()
    let s = await finish()
    expect(s.providerRuns![0].status).toBe('completed')
    const aPatch = s.candidates[0].patch,
      aRun = s.providerRuns![0].id
    expect(s.generation?.queued).toEqual(['b'])
    await page
      .getByRole('button', { name: 'Generate Candidate B from same baseline', exact: true })
      .click()
    await expect(page.getByRole('region', { name: 'Command approval' })).toBeVisible()
    const originalApproval = (await state()).approval!.id
    await page
      .getByRole('tab', { name: /Approach B/ })
      .first()
      .click()
    await stop(runner!)
    await expect(page.getByText('Reconnecting to runner…', { exact: true }).first()).toBeVisible()
    await startRunner()
    await expect(page.getByText('Runner connected', { exact: true })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByTestId('ai-turn-status')).toHaveText('AI turn interrupted')
    await page.getByRole('button', { name: 'Resume AI turn', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Command approval' })).toBeVisible()
    expect((await state()).approval!.id).not.toBe(originalApproval)
    expect(
      await access(join((await state()).candidates[1].worktree, '.recovery-count')).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    s = await finish()
    expect(s.providerRuns![1].recovery?.kind).toBe('quota')
    await page.getByRole('button', { name: 'Replay all', exact: true }).click()
    s = await finish()
    expect(s.projectReplay?.runs.slice(-3).map((r) => r.status)).toEqual([
      'failed',
      'passed',
      'passed',
    ])
    await expect(page.getByTestId('ai-turn-status')).toHaveText('AI turn interrupted')
    await expect(page.getByTestId('patch-verification-status')).toContainText(
      'Replay checks passed',
    )
    await page.screenshot({ path: join(dir, 'interrupted-ai-passed-replay.png'), fullPage: true })
    blockB = false
    await page.getByRole('button', { name: 'Resume AI turn', exact: true }).click()
    await expect.poll(async () => (await state()).providerRuns![1].continuations).toBe(2)
    s = await finish()
    expect(s.providerRuns![1].status).toBe('completed')
    expect(s.providerRuns![1].continuations).toBe(2)
    expect(s.providerRuns![0].id).toBe(aRun)
    expect(s.candidates[0].patch).toBe(aPatch)
    for (const c of s.candidates)
      expect(await readFile(join(c.worktree, '.recovery-count'), 'utf8')).toBe('x')
    expect(JSON.stringify(s)).not.toContain(signed)
    expect(JSON.stringify(s)).not.toContain(key)
    await writeFile(join(dir, 'comparison-proof.json'), JSON.stringify(s, null, 2))
    const journal = await readFile(
      join(dir, 'sessions', s.id, `agent-${s.providerRuns![1].id}.json`),
      'utf8',
    )
    expect(journal).toContain(signed)
    expect(journal).not.toContain(key)
    await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
    await settings.getByRole('button', { name: 'Run coding-agent check', exact: true }).click()
    await expect(settings.getByText(/Harmless tool-call round trip passed/)).toBeVisible()
    await settings.getByRole('button', { name: 'Close provider settings', exact: true }).click()
    await page.getByRole('button', { name: 'New coding session', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Investigate browser behavior' }).uncheck()
    await page
      .getByLabel('Coding task', { exact: true })
      .fill('wait before edit — controlled rate-limit cancellation')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await expect(page.getByTestId('ai-turn-status')).toHaveText('AI waiting to retry')
    await expect(page.getByRole('region', { name: 'Candidate recovery' })).toContainText(
      'Provider reported retry delay: 2s',
    )
    await page.getByRole('button', { name: 'Cancel turn', exact: true }).click()
    await expect.poll(async () => (await state()).busy).toBe(false)
    await expect(page.getByRole('region', { name: 'Candidate recovery' })).toContainText(
      'Provider reported retry delay: 2s',
    )
    blockBefore = false
    await expect(page.getByRole('button', { name: 'Resume AI turn', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Resume AI turn', exact: true }).click()
    await expect.poll(async () => (await state()).providerRuns![0].continuations).toBe(1)
    const cancelled = await finish()
    expect(cancelled.providerRuns![0].status).toBe('completed')
    expect(cancelled.candidates[0].files.length).toBe(0)
    expect((await sourceSnapshot(repo)).digest).toBe(original.digest)
    await writeFile(join(dir, 'retry-proof.json'), JSON.stringify(cancelled, null, 2))
    await writeFile(
      resolve('artifacts/step5-browser-latest.json'),
      JSON.stringify({ directory: dir }, null, 2),
    )
    expect(logs).not.toContain(key)
  } finally {
    if (runner) await stop(runner)
    await stop(vite)
    provider.closeAllConnections()
    provider.close()
    await vault.remove()
    await writeFile(join(dir, 'server.log'), logs)
  }
})
