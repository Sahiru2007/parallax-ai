import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { command, git } from '../../runner/process.ts'
import { WindowsCredentialStore } from '../../runner/credentials.ts'
import type { CodingSession } from '../../shared/coding.ts'

test.use({ trace: 'off' })
test.setTimeout(180000)
async function port() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const value = server.address()
  if (!value || typeof value === 'string') throw new Error('Missing port')
  await new Promise<void>((r) => server.close(() => r()))
  return value.port
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (process.platform === 'win32')
    await command(process.cwd(), 'taskkill.exe', ['/PID', String(child.pid), '/T', '/F'])
  else process.kill(-child.pid!, 'SIGKILL')
  await exited
}
async function ready(url: string) {
  for (let i = 0; i < 200; i++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return
    await delay(50)
  }
  throw new Error('Server did not start: ' + url)
}

test('settings, credential vault, model pinning, real approved edits through both protocol doubles, and restart persistence', async ({
  page,
}) => {
  test.skip(process.platform !== 'win32', 'Real Windows Credential Manager acceptance')
  const id = randomUUID(),
    dir = resolve('artifacts/step4b-acceptance', id)
  await mkdir(dir, { recursive: true })
  const credentialTarget = `PARALLAX AI/Test/${id}`,
    vault = new WindowsCredentialStore(credentialTarget)
  const inertKey = 'inert-provider-protocol-test-key-' + id
  let empty = true,
    openaiCalls = 0
  const requests: { provider: string; model: string; authorized: boolean }[] = []
  const double = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += String(chunk)
    const body = JSON.parse(text || '{}')
    const openai = req.url?.startsWith('/v1/')
    res.setHeader('Content-Type', 'application/json')
    if (openai && req.headers.authorization !== `Bearer ${inertKey}`) {
      res.writeHead(401)
      res.end('{}')
      return
    }
    if (req.url === '/v1/models') {
      res.end(
        JSON.stringify({ data: [{ id: 'openai-double-alpha' }, { id: 'openai-double-beta' }] }),
      )
      return
    }
    if (req.url === '/api/tags') {
      res.end(
        JSON.stringify({
          models: empty ? [] : [{ name: 'local-double:latest' }, { name: 'no-tools:latest' }],
        }),
      )
      return
    }
    if (req.url !== '/v1/responses' && req.url !== '/api/chat') {
      res.writeHead(404)
      res.end('{}')
      return
    }
    if (openai) openaiCalls++
    requests.push({
      provider: openai ? 'openai' : 'ollama',
      model: body.model,
      authorized: openai
        ? req.headers.authorization === `Bearer ${inertKey}`
        : !req.headers.authorization,
    })
    const tools = body.tools as { name?: string; function?: { name: string } }[]
    const probe = tools.some((t) => (t.name ?? t.function?.name) === 'parallax_probe')
    const context = (openai ? body.input : body.messages) as { type?: string; role?: string }[]
    const completed = context.filter((item) =>
      openai ? item.type === 'function_call_output' : item.role === 'tool',
    ).length
    let calls: { name: string; args: Record<string, unknown> }[] = [],
      content = ''
    if (probe) {
      if (body.model === 'no-tools:latest') content = 'This double does not call tools.'
      else if (!completed) calls = [{ name: 'parallax_probe', args: { value: 'parallax-ready' } }]
      else content = 'parallax-acknowledged'
    } else if (completed === 0)
      calls = [
        { name: 'read_instructions', args: {} },
        { name: 'read_file', args: { path: 'index.js' } },
      ]
    else if (completed === 2)
      calls = [
        {
          name: 'write_file',
          args: {
            path: 'provider-feature.cjs',
            content: 'module.exports = (name) => `Hello, ${name}!`;\n',
          },
        },
        {
          name: 'write_file',
          args: {
            path: 'provider-feature.test.cjs',
            content:
              "const {test}=require('node:test');const assert=require('node:assert/strict');const greet=require('./provider-feature.cjs');test('greeting and clean command environment',()=>{assert.equal(greet('Parallax'),'Hello, Parallax!');assert.equal(process.env.OPENAI_API_KEY,undefined)});\n",
          },
        },
      ]
    else if (completed === 4)
      calls = [
        {
          name: 'run_command',
          args: { executable: 'node', args: ['--test', 'provider-feature.test.cjs'], cwd: '.' },
        },
      ]
    else
      content =
        'Protocol test double: repository tools and the approved check executed. No live model was used.'
    res.end(
      JSON.stringify(
        openai
          ? {
              model: body.model + '-snapshot',
              output: calls.length
                ? calls.map((c, i) => ({
                    type: 'function_call',
                    name: c.name,
                    arguments: JSON.stringify(c.args),
                    call_id: `call-${completed}-${i}`,
                  }))
                : [{ type: 'message', content: [{ type: 'output_text', text: content }] }],
            }
          : {
              model: body.model,
              message: {
                role: 'assistant',
                content,
                ...(calls.length
                  ? {
                      tool_calls: calls.map((c) => ({
                        function: { name: c.name, arguments: c.args },
                      })),
                    }
                  : {}),
              },
            },
      ),
    )
  })
  double.listen(0, '127.0.0.1')
  await once(double, 'listening')
  const address = double.address()
  if (!address || typeof address === 'string') throw new Error('Missing double address')
  const doubleUrl = `http://127.0.0.1:${address.port}`
  const runnerPort = await port(),
    browserPort = await port(),
    runnerUrl = `http://127.0.0.1:${runnerPort}`,
    base = `http://127.0.0.1:${browserPort}`
  const stateDir = join(dir, 'sessions'),
    repo = join(dir, 'provider test repo')
  const seed = resolve('artifacts/step2-seed')
  if (
    !(await access(join(seed, '.git')).then(
      () => true,
      () => false,
    ))
  )
    await git(process.cwd(), [
      'clone',
      '--depth',
      '1',
      '--',
      'https://github.com/jonschlinkert/is-number.git',
      seed,
    ])
  await git(process.cwd(), ['clone', '--shared', '--', seed, repo])
  let logs = '',
    runner: ChildProcess | undefined
  const collect = (child: ChildProcess) => {
    child.stdout!.on('data', (d) => {
      logs += String(d)
    })
    child.stderr!.on('data', (d) => {
      logs += String(d)
    })
  }
  async function startRunner() {
    runner = spawn(process.execPath, ['runner/server.ts'], {
      cwd: process.cwd(),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENAI_API_KEY: '',
        PARALLAX_MODEL: '',
        PARALLAX_RUNNER_PORT: String(runnerPort),
        PARALLAX_BROWSER_ORIGINS: base,
        PARALLAX_STATE_DIR: stateDir,
        PARALLAX_ENABLE_TEST_PROVIDER: '1',
        PARALLAX_TEST_PROVIDER_FILE: '',
        PARALLAX_OPENAI_TEST_URL: doubleUrl,
        PARALLAX_CREDENTIAL_TARGET: credentialTarget,
      },
    })
    collect(runner)
    await ready(runnerUrl + '/api/health')
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
      cwd: process.cwd(),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PARALLAX_RUNNER_URL: runnerUrl },
    },
  )
  collect(vite)
  const dialog = page.getByRole('dialog', { name: 'Manage providers' })
  async function state(): Promise<CodingSession> {
    const id = await page.evaluate(() => localStorage.getItem('parallax-coding-session'))
    return (await (await fetch(runnerUrl + '/api/coding/sessions/' + id)).json()) as CodingSession
  }
  async function useModel(model: string) {
    await dialog.getByLabel('Available model').selectOption(model)
    await dialog.getByRole('button', { name: 'Run coding-agent check', exact: true }).click()
    await expect(dialog.getByText(/Harmless tool-call round trip passed/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Use model for new sessions', exact: true }).click()
    await expect(
      dialog.getByText(new RegExp(`Default: .*${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Close provider settings', exact: true }),
    ).toBeEnabled()
  }
  async function finish() {
    await expect(page.getByRole('region', { name: 'Command approval' })).toContainText(
      'provider-feature.test.cjs',
      { timeout: 20000 },
    )
    await page.getByRole('button', { name: 'Approve command', exact: true }).click()
    // Wait for the approved process and durable receipt, including Windows process startup.
    await expect.poll(async () => (await state()).busy, { timeout: 20000 }).toBe(false)
    const completed = await state()
    expect(completed.status, completed.error).toBe('ready')
    expect(completed.checks.some((c) => c.status === 'passed')).toBe(true)
    expect(completed.candidates[0].files.map((f) => f.path)).toContain('provider-feature.cjs')
    return completed
  }
  try {
    await ready(base)
    await page.goto(base)
    await page.getByRole('button', { name: 'Connect Ollama', exact: true }).click()
    await dialog.getByLabel('Ollama server').fill(`http://127.0.0.1:${await port()}`)
    await dialog.getByRole('button', { name: 'Save Ollama server', exact: true }).click()
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(dialog.getByText(/Ollama is unreachable/)).toBeVisible()
    await dialog.getByLabel('Ollama server').fill(doubleUrl)
    await dialog.getByRole('button', { name: 'Save Ollama server', exact: true }).click()
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(dialog.getByText(/no local models are installed/)).toBeVisible()
    empty = false
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
    await dialog.getByLabel('Available model').selectOption('no-tools:latest')
    await dialog.getByRole('button', { name: 'Run coding-agent check', exact: true }).click()
    await expect(dialog.getByText(/Coding-agent check failed/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Use model for new sessions' })).toBeDisabled()
    await useModel('local-double:latest')
    await dialog.getByRole('tab', { name: 'OpenAI', exact: true }).click()
    await dialog.getByLabel('OpenAI API key', { exact: true }).fill('inert-invalid-key')
    await dialog.getByRole('button', { name: 'Save API key', exact: true }).click()
    await expect(dialog.getByLabel('OpenAI API key', { exact: true })).toHaveValue('')
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(dialog.getByText(/HTTP 401/)).toBeVisible()
    await dialog.getByLabel('OpenAI API key', { exact: true }).fill(inertKey)
    await dialog.getByRole('button', { name: 'Save API key', exact: true }).click()
    await expect.poll(() => vault.get()).toBe(inertKey)
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
    await useModel('openai-double-alpha')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Coding provider' })).toHaveValue(
      'openai:openai-double-alpha',
    )
    await page.getByLabel('Local repository path').fill(repo)
    await page.getByRole('button', { name: 'Open repository', exact: true }).click()
    await expect(page.locator('.coding-baseline')).toContainText(repo)
    await expect(page.locator('.coding-baseline')).toContainText('Clean checkout')
    await page
      .getByLabel('Coding task', { exact: true })
      .fill('Add a greeting function in provider-feature.cjs, add a Node test, and run it.')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Command approval' })).toBeVisible({
      timeout: 20000,
    })
    await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
    await useModel('openai-double-beta')
    await dialog.getByRole('button', { name: 'Close provider settings', exact: true }).click()
    const first = await finish()
    expect(first.repo.path).toBe(repo)
    expect(first.modelSelection?.model).toBe('openai-double-alpha')
    expect(first.providerRuns?.[0]).toMatchObject({
      provider: 'openai',
      model: 'openai-double-alpha',
      actualModel: 'openai-double-alpha-snapshot',
      status: 'completed',
    })
    // The same session remains pinned, including follow-ups after changing the default.
    await page
      .getByLabel('Follow-up instruction')
      .fill('Inspect the existing greeting and rerun its test.')
    await page.getByRole('button', { name: 'Continue session', exact: true }).click()
    const followup = await finish()
    expect(followup.providerRuns?.at(-1)?.model).toBe('openai-double-alpha')
    await stop(runner!)
    await expect(page.getByText('Reconnecting to runner…', { exact: true }).first()).toBeVisible()
    await startRunner()
    await expect(page.getByText('Runner connected', { exact: true })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.locator('.coding-session-header')).toContainText(
      'openai-double-alpha-snapshot',
    )
    await page.getByRole('button', { name: 'New coding session', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Coding provider' })).toHaveValue(
      'openai:openai-double-beta',
    )
    await page.reload()
    await expect(page.locator('.coding-baseline')).toContainText(repo)
    await expect(page.getByRole('combobox', { name: 'Coding provider' })).toHaveValue(
      'openai:openai-double-beta',
    )
    // A runner restart while the composer is open must refresh the mutation token too.
    await stop(runner!)
    await expect(page.getByText('Reconnecting to runner…', { exact: true })).toBeVisible()
    await startRunner()
    await expect(page.getByText('Runner connected', { exact: true })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByRole('combobox', { name: 'Coding provider' })).toHaveValue(
      'openai:openai-double-beta',
    )
    await page.getByRole('combobox', { name: 'Coding provider' }).selectOption('manage')
    await dialog.getByRole('tab', { name: 'Ollama', exact: true }).click()
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
    await useModel('local-double:latest')
    await dialog.getByRole('button', { name: 'Close provider settings', exact: true }).click()
    await page
      .getByLabel('Coding task', { exact: true })
      .fill('Create a tested greeting function and run its test using the local model.')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    const local = await finish()
    expect(local.repo.path).toBe(repo)
    expect(local.providerRuns?.[0]).toMatchObject({
      provider: 'ollama',
      model: 'local-double:latest',
      actualModel: 'local-double:latest',
      status: 'completed',
    })
    expect(local.modelSelection?.testDouble).toBe(true)
    expect(
      await (await fetch(runnerUrl + `/api/coding/sessions/${local.id}/patch/a`)).text(),
    ).not.toContain(inertKey)
    await page.screenshot({ path: join(dir, 'local-provider-completed.png'), fullPage: true })
    await new Promise<void>((r) => double.close(() => r()))
    const cloudCount = openaiCalls
    await page.getByLabel('Follow-up instruction').fill('Rerun the local greeting check.')
    await page.getByRole('button', { name: 'Continue session', exact: true }).click()
    await expect.poll(async () => (await state()).status).toBe('error')
    await expect(page.locator('.coding-conversation')).toContainText('No cloud fallback was used')
    expect(openaiCalls).toBe(cloudCount)
    await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
    await dialog.getByRole('tab', { name: 'OpenAI', exact: true }).click()
    await dialog.getByRole('button', { name: 'Remove API key', exact: true }).click()
    await expect.poll(() => vault.get()).toBe(null)
    await expect(dialog.getByText(/Key: none/)).toBeVisible()
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }))
    expect(storage).not.toContain(inertKey)
    const configText = await (await fetch(runnerUrl + '/api/coding/config')).text()
    expect(configText).not.toContain(inertKey)
    const savedFiles = [
      join(stateDir, 'providers.json'),
      ...(await readdir(stateDir))
        .filter((v) => /^[a-f0-9-]{36}$/.test(v))
        .map((v) => join(stateDir, v, 'session.json')),
    ]
    for (const file of savedFiles) expect(await readFile(file, 'utf8')).not.toContain(inertKey)
    expect(logs).not.toContain(inertKey)
    expect(requests.every((r) => r.authorized)).toBe(true)
    expect(await git(repo, ['status', '--porcelain'])).toBe('')
    await writeFile(
      join(dir, 'proof.json'),
      JSON.stringify(
        {
          providerKind: 'PROTOCOL TEST DOUBLES — NO LIVE MODEL',
          windowsCredentialManager: true,
          openai: first.providerRuns,
          followup: followup.providerRuns,
          ollama: local.providerRuns,
          actualCommands: local.checks,
          defaultAndRestartPersistence: true,
          activeSessionPinned: true,
          secretChecks: true,
          requests,
        },
        null,
        2,
      ),
    )
    await writeFile(
      resolve('artifacts/step4b-latest.json'),
      JSON.stringify({ directory: dir }, null, 2),
    )
  } finally {
    if (runner) await stop(runner)
    await stop(vite)
    double.close()
    await vault.remove()
    await writeFile(join(dir, 'server.log'), logs)
  }
})
