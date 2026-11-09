import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { git, command } from '../../runner/process.ts'
import type { CodingSession } from '../../shared/coding.ts'

test('complete command output remains downloadable from the browser after runner restart', async ({
  page,
}) => {
  test.setTimeout(120000)
  const root = process.cwd(),
    dir = resolve('artifacts/context-browser', randomUUID()),
    repo = join(dir, 'repository with spaces')
  await mkdir(repo, { recursive: true })
  await mkdir(join(dir, 'host'), { recursive: true })
  await writeFile(join(repo, 'value.cjs'), 'module.exports=0;\n')
  await writeFile(
    join(repo, 'output.cjs'),
    "console.log('FIRST_COMPLETE_LOG_LINE');for(let n=0;n<10000;n++)console.log('line '+n+' '+ 'x'.repeat(80));console.log('LAST_COMPLETE_LOG_LINE');\n",
  )
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
  const providerFile = join(dir, 'provider.json')
  await writeFile(
    providerFile,
    JSON.stringify({
      turns: [
        {
          calls: [
            { name: 'run_command', args: { executable: 'node', args: ['output.cjs'], cwd: '.' } },
          ],
          message: 'Scripted provider; actual command executed, no model call.',
        },
      ],
    }),
  )
  async function freePort() {
    const s = createServer()
    s.listen(0, '127.0.0.1')
    await once(s, 'listening')
    const p = (s.address() as { port: number }).port
    await new Promise<void>((r) => s.close(() => r()))
    return p
  }
  const runnerPort = await freePort(),
    browserPort = await freePort(),
    base = `http://127.0.0.1:${browserPort}`,
    runnerURL = `http://127.0.0.1:${runnerPort}`
  const children: ChildProcess[] = []
  function start(args: string[], env: NodeJS.ProcessEnv) {
    const c = spawn(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: process.platform !== 'win32',
    })
    children.push(c)
    return c
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
      await delay(30)
    }
    throw new Error('Test server unavailable')
  }
  function startRunner() {
    return start(['runner/server.ts'], {
      ...process.env,
      PARALLAX_REPO_ROOT: join(dir, 'host'),
      PARALLAX_RUNNER_PORT: String(runnerPort),
      PARALLAX_STATE_DIR: join(dir, 'sessions'),
      PARALLAX_BROWSER_ORIGINS: base,
      PARALLAX_ENABLE_TEST_PROVIDER: '1',
      PARALLAX_TEST_PROVIDER_FILE: providerFile,
    })
  }
  let runner = startRunner()
  const vite = start(
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(browserPort),
      '--strictPort',
    ],
    { ...process.env, PARALLAX_RUNNER_URL: runnerURL },
  )
  try {
    await ready(runnerURL + '/api/health')
    await ready(base)
    await page.goto(base)
    await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
    await page.getByLabel('Local repository path', { exact: true }).fill(repo)
    await page.getByRole('button', { name: 'Open repository', exact: true }).click()
    await page.getByRole('combobox', { name: 'Coding provider' }).selectOption('test')
    await page
      .getByLabel('Coding task', { exact: true })
      .fill('Controlled browser verification: execute the scripted output fixture.')
    await page.getByRole('button', { name: 'Start coding', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Command approval' })).toContainText('output.cjs')
    await page.getByRole('button', { name: 'Approve command', exact: true }).focus()
    await page.keyboard.press('Enter')
    const session = async () => {
      const id = await page.evaluate(() => localStorage.getItem('parallax-coding-session'))
      return (await (await fetch(runnerURL + '/api/coding/sessions/' + id)).json()) as CodingSession
    }
    await expect.poll(async () => (await session()).busy, { timeout: 30000 }).toBe(false)
    const state = await session(),
      check = state.checks.find((c) => c.fullOutput)!
    expect(check.status).toBe('passed')
    expect(check.output.length).toBeLessThanOrEqual(150000)
    expect(check.outputChars).toBeGreaterThan(500000)
    const details = page.getByTestId('coding-check').filter({ hasText: 'output.cjs' })
    await details.locator('summary').click()
    const downloaded = page.waitForEvent('download')
    await details.getByRole('link', { name: 'Download complete output', exact: true }).focus()
    await page.keyboard.press('Enter')
    const log = join(dir, 'downloaded.log')
    await (await downloaded).saveAs(log)
    const content = await readFile(log, 'utf8')
    expect(content.startsWith('FIRST_COMPLETE_LOG_LINE')).toBe(true)
    expect(content.includes('LAST_COMPLETE_LOG_LINE')).toBe(true)
    await stop(runner)
    runner = startRunner()
    await ready(runnerURL + '/api/health')
    const response = await fetch(
      runnerURL + `/api/coding/sessions/${state.id}/checks/${check.id}/output`,
    )
    expect(response.ok).toBe(true)
    expect(await response.text()).toBe(content)
    const absent = await fetch(
      runnerURL + `/api/coding/sessions/${state.id}/checks/${randomUUID()}/output`,
    )
    expect(absent.ok).toBe(false)
    await page.screenshot({ path: join(dir, 'complete-output-browser.png') })
  } finally {
    await stop(runner)
    await stop(vite)
  }
})
