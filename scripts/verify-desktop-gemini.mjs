import { chromium, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const exe = process.env.PARALLAX_INSTALLED_EXE
if (!exe) throw Error('Set PARALLAX_INSTALLED_EXE')
const id = randomUUID(),
  artifact = resolve('artifacts/desktop', 'gemini-' + id),
  data = join(process.env.LOCALAPPDATA, 'dev.parallax-ai.desktop', 'verification-live-' + id),
  repo = join(data, 'live task repo')
await mkdir(artifact, { recursive: true })
await mkdir(join(data, 'sessions'), { recursive: true })
await mkdir(repo, { recursive: true })
const legacy = join(process.env.USERPROFILE, '.parallax/coding-sessions/providers.json')
try {
  await copyFile(legacy, join(data, 'sessions/providers.json'))
} catch {}
const git = join(exe, '..', 'resources/desktop/git/cmd/git.exe'),
  gitRun = (args) => execFileSync(git, args, { cwd: repo, windowsHide: true, encoding: 'utf8' })
await writeFile(
  join(repo, 'package.json'),
  JSON.stringify({ name: 'parallax-live-desktop-verification', private: true, type: 'module' }),
)
await writeFile(join(repo, 'greet.mjs'), 'export const greet = name => `Hello, ${name}!`\n')
await writeFile(
  join(repo, 'greeting.test.mjs'),
  "import {test} from 'node:test';import assert from 'node:assert/strict';import {greet} from './greet.mjs';test('greeting',()=>assert.equal(greet('Ada'),'Hello, Ada!'))\n",
)
await writeFile(
  join(repo, 'AGENTS.md'),
  'Only edit greet.mjs and greeting.test.mjs for this task. Request approval for node --test greeting.test.mjs.\n',
)
gitRun(['init', '--initial-branch=main'])
gitRun(['add', '.'])
gitRun([
  '-c',
  'user.name=Live Desktop Verification',
  '-c',
  'user.email=desktop@parallax.invalid',
  'commit',
  '-m',
  'Live verification seed',
])
const link = join(
  process.env.APPDATA,
  'Microsoft/Windows/Start Menu/Programs/PARALLAX AI/PARALLAX AI.lnk',
)
const env = {
  ...process.env,
  PARALLAX_START_LINK: link,
  PARALLAX_DESKTOP_TEST: '1',
  PARALLAX_DESKTOP_DATA_DIR: data,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    '--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1',
}
for (const name of [
  'PARALLAX_ENABLE_TEST_PROVIDER',
  'PARALLAX_TEST_PROVIDER_FILE',
  'PARALLAX_CREDENTIAL_TARGET',
  'PARALLAX_GEMINI_TEST_URL',
  'PARALLAX_OPENAI_TEST_URL',
])
  delete env[name]
const pid = Number(
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$app = Start-Process -FilePath $env:PARALLAX_START_LINK -WindowStyle Normal -PassThru; $app.Id',
    ],
    { env, windowsHide: true, encoding: 'utf8' },
  ).trim(),
)
const running = () => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
let browser, page
const proof = {
  artifact,
  data,
  exe,
  launchedViaStartShortcut: link,
  appPid: pid,
  provider: 'LIVE Google Gemini',
  status: 'pending',
  maxToolRounds: 4,
}
try {
  for (let i = 0; i < 400; i++) {
    if (!running()) throw Error('Installed Start-menu launch exited')
    if (
      await fetch('http://127.0.0.1:9224/json/version').then(
        (r) => r.ok,
        () => false,
      )
    )
      break
    await new Promise((r) => setTimeout(r, 100))
  }
  browser = await chromium.connectOverCDP('http://127.0.0.1:9224')
  for (let i = 0; i < 150; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('parallax.localhost'))
    if (page) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible({ timeout: 30000 })
  const runtime = JSON.parse(await readFile(join(data, 'desktop-runtime.json'), 'utf8'))
  expect(runtime.appPid).toBe(pid)
  proof.runtime = runtime
  await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Manage providers' })
  const providerReply = (action, timeout = 100000) =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/providers') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON()?.action === action,
      { timeout },
    )
  await settings.getByRole('tab', { name: 'Google Gemini', exact: true }).click()
  const config = await page.evaluate(async () => (await fetch('/api/coding/config')).json())
  proof.keySource = config.providers.gemini.keySource
  if (proof.keySource === 'none') {
    proof.status = 'blocked'
    proof.reason = 'No saved Gemini credential available in this Windows account.'
  } else {
    const connection = providerReply('connection')
    await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
    await connection
    await expect(
      settings.getByRole('button', { name: 'Test connection', exact: true }),
    ).toBeEnabled()
    const models = await settings
      .getByLabel('Available model')
      .locator('option')
      .evaluateAll((es) => es.map((e) => e.value).filter(Boolean))
    proof.model =
      models.find((m) => m === config.providers.selection?.model && /flash-lite/.test(m)) ??
      models.find((m) => m === 'models/gemini-flash-lite-latest') ??
      models.find((m) => /flash-lite/.test(m) && !/tts|image/.test(m)) ??
      models[0]
    if (!proof.model) {
      proof.status = 'blocked'
      proof.reason = await settings.locator('.provider-failure').allTextContents()
    } else {
      await settings.getByLabel('Available model').selectOption(proof.model)
      const ready = providerReply('agent-check')
      await settings.getByRole('button', { name: 'Run coding-agent check', exact: true }).click()
      const readyResponse = await ready
      const readyResult = await readyResponse.json()
      proof.readiness = readyResult.gemini?.checks?.[proof.model]
      const use = settings.getByRole('button', { name: 'Use model for new sessions', exact: true })
      if (!proof.readiness?.ok) {
        proof.status = 'blocked'
        proof.reason =
          proof.readiness?.message ?? readyResult.error ?? 'Provider readiness did not complete.'
        proof.readinessPassed = false
      } else {
        proof.readinessPassed = true
        await expect(use).toBeEnabled()
        await settings.getByText('Development controls & agent limits', { exact: true }).click()
        await settings.getByLabel('Agent round limit', { exact: true }).fill('4')
        const limit = providerReply('round-limit')
        await settings.getByRole('button', { name: 'Save round limit', exact: true }).click()
        await limit
        const selected = providerReply('select')
        await use.click()
        await selected
        await settings.getByRole('button', { name: 'Close provider settings', exact: true }).click()
        await page.getByLabel('Local repository path').fill(repo)
        await page.getByRole('button', { name: 'Open repository', exact: true }).click()
        await expect(page.locator('.coding-baseline')).toContainText(repo)
        await page
          .getByLabel('Coding task', { exact: true })
          .fill(
            'Desktop live verification. Read AGENTS.md and greet.mjs. Change greet(name) to return Welcome, followed by the name and !, instead of Hello. Update greeting.test.mjs accordingly. Inspect the diff and run node --test greeting.test.mjs through command approval. Keep the original checkout unchanged. You have at most four model rounds.',
          )
        await page.getByRole('button', { name: 'Start coding', exact: true }).click()
        await expect
          .poll(() => page.evaluate(() => localStorage.getItem('parallax-coding-session')), {
            timeout: 30000,
          })
          .not.toBeNull()
        let session
        const deadline = Date.now() + 100000
        while (Date.now() < deadline) {
          session = await page.evaluate(async () => {
            const id = localStorage.getItem('parallax-coding-session')
            return (await fetch('/api/coding/sessions/' + id)).json()
          })
          if (session.approval)
            await page.getByRole('button', { name: 'Approve command', exact: true }).click()
          if (!session.busy) break
          await page.waitForTimeout(250)
        }
        if (session.busy) {
          await page.getByRole('button', { name: 'Cancel turn', exact: true }).click()
          proof.reason = 'Verification deadline reached; turn cancelled with evidence retained.'
        }
        session = await page.evaluate(async () => {
          const id = localStorage.getItem('parallax-coding-session')
          return (await fetch('/api/coding/sessions/' + id)).json()
        })
        proof.session = session.id
        proof.status =
          session.providerRuns?.at(-1)?.status === 'completed' &&
          session.checks.some((c) => c.status === 'passed')
            ? 'passed'
            : 'blocked'
        proof.reason ??= session.error || session.providerRuns?.at(-1)?.recovery?.message
        proof.run = session.providerRuns?.at(-1)
        proof.files = session.candidates[0].files.map((f) => f.path)
        proof.checks = session.checks
        await writeFile(join(artifact, 'session.json'), JSON.stringify(session, null, 2))
      }
    }
  }
  await page.screenshot({ path: join(artifact, 'live-gemini.png') })
  proof.sourcePreserved = gitRun(['status', '--porcelain']) === ''
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2))
  await writeFile(
    'artifacts/desktop/gemini-latest.json',
    JSON.stringify(
      { artifact, data, status: proof.status, model: proof.model, reason: proof.reason },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify({ status: proof.status, model: proof.model, reason: proof.reason, artifact }),
  )
} catch (error) {
  proof.status = 'blocked'
  proof.reason = String(error)
  if (page) {
    proof.visibleErrors = await page
      .getByRole('alert')
      .allTextContents()
      .catch(() => [])
    await page.screenshot({ path: join(artifact, 'verification-error.png') }).catch(() => {})
  }
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2))
  await writeFile(
    'artifacts/desktop/gemini-latest.json',
    JSON.stringify(
      { artifact, data, status: proof.status, model: proof.model, reason: proof.reason },
      null,
      2,
    ),
  )
  throw error
} finally {
  if (running())
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Process -Id ${pid}).CloseMainWindow() | Out-Null`,
      ],
      { windowsHide: true },
    )
  for (let i = 0; i < 100 && running(); i++) await new Promise((r) => setTimeout(r, 100))
  if (running()) process.kill(pid)
  await browser?.close().catch(() => {})
}
