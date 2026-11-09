import { test, expect } from '@playwright/test'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { command, git } from '../../runner/process.ts'
import type { CodingSession } from '../../shared/coding.ts'

test('HTTP 503 wait is visible/cancellable; Resume keeps the same session and model', async ({
  page,
}) => {
  test.setTimeout(120000)
  const root = process.cwd(),
    dir = resolve('artifacts/service-recovery-browser', randomUUID()),
    repo = join(dir, 'repository with spaces')
  await mkdir(repo, { recursive: true })
  await mkdir(join(dir, 'host'))
  await writeFile(join(repo, 'value.cjs'), 'module.exports=0;\n')
  await git(repo, ['init', '--initial-branch=main'])
  await git(repo, ['add', '.'])
  await git(repo, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@parallax.invalid',
    'commit',
    '-m',
    'Baseline',
  ])
  const key = 'inert-ui-503-key-' + randomUUID(),
    target = 'PARALLAX AI/Test/' + randomUUID()
  let blocked = true,
    codingRequests = 0
  const provider = httpServer(async (req, res) => {
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
            { name: 'models/service-ui-double', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      )
      return
    }
    let raw = ''
    for await (const c of req) raw += String(c)
    const body = JSON.parse(raw),
      probe = body.tools[0].functionDeclarations.some(
        (t: { name: string }) => t.name === 'parallax_probe',
      )
    if (!probe) {
      codingRequests++
      if (blocked) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '10' })
        res.end(JSON.stringify({ error: { status: 'UNAVAILABLE' } }))
        return
      }
    }
    const count = body.contents
      .flatMap((c: { parts: unknown[] }) => c.parts)
      .filter((p: { functionResponse?: unknown }) => p.functionResponse).length
    const parts =
      probe && !count
        ? [
            {
              thoughtSignature: 'ui-signature',
              functionCall: {
                name: 'parallax_probe',
                id: 'probe',
                args: { value: 'parallax-ready' },
              },
            },
          ]
        : [{ text: probe ? 'parallax-acknowledged' : 'Controlled completion; no live provider.' }]
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: ' +
        JSON.stringify({
          modelVersion: 'service-ui-double',
          candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
        }) +
        '\n\n',
    )
  })
  provider.listen(0, '127.0.0.1')
  await once(provider, 'listening')
  const providerURL = 'http://127.0.0.1:' + (provider.address() as { port: number }).port
  async function port() {
    const s = createServer()
    s.listen(0, '127.0.0.1')
    await once(s, 'listening')
    const p = (s.address() as { port: number }).port
    await new Promise<void>((r) => s.close(() => r()))
    return p
  }
  const runnerPort = await port(),
    browserPort = await port(),
    runnerURL = `http://127.0.0.1:${runnerPort}`,
    base = `http://127.0.0.1:${browserPort}`
  const children: ChildProcess[] = []
  function start(args: string[], extra: NodeJS.ProcessEnv) {
    const child = spawn(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, ...extra },
      stdio: 'ignore',
    })
    children.push(child)
    return child
  }
  async function stop(c: ChildProcess) {
    if (c.exitCode !== null || c.signalCode !== null) return
    const ended = once(c, 'exit')
    if (process.platform === 'win32')
      await command(root, 'taskkill.exe', ['/PID', String(c.pid), '/T', '/F'])
    else process.kill(-c.pid!, 'SIGKILL')
    await ended
  }
  async function ready(url: string) {
    for (let i = 0; i < 400; i++) {
      if (
        await fetch(url).then(
          (r) => r.ok,
          () => false,
        )
      )
        return
      await delay(50)
    }
    throw new Error('Controlled server did not start')
  }
  start(['runner/server.ts'], {
    PARALLAX_REPO_ROOT: join(dir, 'host'),
    PARALLAX_STATE_DIR: join(dir, 'sessions'),
    PARALLAX_RUNNER_PORT: String(runnerPort),
    PARALLAX_BROWSER_ORIGINS: base,
    PARALLAX_ENABLE_TEST_PROVIDER: '1',
    PARALLAX_GEMINI_TEST_URL: providerURL,
    PARALLAX_CREDENTIAL_TARGET: target,
    GEMINI_API_KEY: key,
    GOOGLE_API_KEY: '',
    OPENAI_API_KEY: '',
  })
  start(
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(browserPort),
      '--strictPort',
    ],
    { PARALLAX_RUNNER_URL: runnerURL },
  )
  try {
    await ready(runnerURL + '/api/health')
    await ready(base)
    await page.goto(base)
    await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Manage providers' })
    await settings.getByRole('tab', { name: 'Google Gemini', exact: true }).click()
    await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(settings.getByLabel('Available model')).toBeEnabled()
    await settings.getByRole('button', { name: 'Run coding-agent check', exact: true }).click()
    await expect(settings.getByText(/Harmless tool-call round trip passed/)).toBeVisible()
    await settings.getByRole('button', { name: 'Use model for new sessions', exact: true }).click()
    await settings.getByRole('button', { name: 'Close provider settings', exact: true }).click()
    await page.getByLabel('Local repository path', { exact: true }).fill(repo)
    await page.getByRole('button', { name: 'Open repository', exact: true }).click()
    await page
      .getByLabel('Coding task', { exact: true })
      .fill('Controlled HTTP 503 recovery; no live model.')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    const state = async () => {
      const id = await page.evaluate(() => localStorage.getItem('parallax-coding-session'))
      return (await (await fetch(runnerURL + '/api/coding/sessions/' + id)).json()) as CodingSession
    }
    await expect(page.getByTestId('ai-turn-status')).toHaveText('AI waiting to retry')
    await expect(page.getByRole('region', { name: 'Candidate recovery' })).toContainText('HTTP 503')
    await expect(page.getByTestId('model-request-size')).toContainText('1 measured requests')
    const waiting = await state()
    expect(waiting.providerRuns![0].recovery?.kind).toBe('unavailable')
    const worktree = waiting.candidates[0].worktree
    await page.screenshot({ path: join(dir, '503-waiting-viewport.png') })
    await page.getByRole('button', { name: 'Cancel turn', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await state()).busy).toBe(false)
    await delay(200)
    expect(codingRequests).toBe(1)
    expect((await state()).providerRuns![0].recovery?.kind).toBe('cancelled')
    blocked = false
    await expect(page.getByRole('button', { name: 'Resume AI turn', exact: true })).toBeEnabled({
      timeout: 15000,
    })
    await page.getByRole('button', { name: 'Resume AI turn', exact: true }).click()
    await expect.poll(async () => (await state()).providerRuns![0].status).toBe('completed')
    const completed = await state()
    expect(completed.id).toBe(waiting.id)
    expect(completed.candidates[0].worktree).toBe(worktree)
    expect(completed.providerRuns![0].model).toBe('models/service-ui-double')
    expect(codingRequests).toBe(2)
    expect(completed.providerRuns![0].requestSizes).toHaveLength(2)
    await writeFile(join(dir, 'proof.json'), JSON.stringify({ waiting, completed }, null, 2))
  } finally {
    for (const child of children.reverse()) await stop(child)
    provider.closeAllConnections()
    await new Promise<void>((r) => provider.close(() => r()))
  }
})
