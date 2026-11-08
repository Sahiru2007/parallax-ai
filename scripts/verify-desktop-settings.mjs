import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { WindowsCredentialStore } from '../runner/credentials.ts'

const exe = process.env.PARALLAX_INSTALLED_EXE
if (!exe) throw Error('Set PARALLAX_INSTALLED_EXE')
const id = randomUUID(),
  artifact = resolve('artifacts/desktop', 'settings-' + id),
  data = join(process.env.LOCALAPPDATA, 'dev.parallax-ai.desktop', 'verification-settings-' + id),
  target = 'PARALLAX AI/Test/' + id
await mkdir(artifact, { recursive: true })
await mkdir(data, { recursive: true })
const double = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/api/tags') {
    res.end(JSON.stringify({ models: [{ name: 'desktop-local-double:latest' }] }))
    return
  }
  let raw = ''
  for await (const part of req) raw += part
  const body = JSON.parse(raw || '{}'),
    done = body.messages?.some((m) => m.role === 'tool')
  res.end(
    JSON.stringify({
      model: body.model,
      prompt_eval_count: 4,
      eval_count: 2,
      message: {
        role: 'assistant',
        content: done ? 'parallax-acknowledged' : '',
        ...(!done
          ? {
              tool_calls: [
                { function: { name: 'parallax_probe', arguments: { value: 'parallax-ready' } } },
              ],
            }
          : {}),
      },
    }),
  )
})
double.listen(0, '127.0.0.1')
await once(double, 'listening')
const endpoint = 'http://127.0.0.1:' + double.address().port
let child, browser, page
async function start() {
  child = spawn(exe, [], {
    windowsHide: false,
    cwd: process.env.TEMP,
    env: {
      ...process.env,
      PARALLAX_DESKTOP_TEST: '1',
      PARALLAX_DESKTOP_DATA_DIR: data,
      PARALLAX_ENABLE_TEST_PROVIDER: '1',
      PARALLAX_CREDENTIAL_TARGET: target,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        '--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1',
    },
  })
  for (let i = 0; i < 400; i++) {
    if (
      await fetch('http://127.0.0.1:9225/json/version').then(
        (r) => r.ok,
        () => false,
      )
    )
      break
    await new Promise((r) => setTimeout(r, 100))
  }
  browser = await chromium.connectOverCDP('http://127.0.0.1:9225')
  for (let i = 0; i < 150; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('parallax.localhost'))
    if (page) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible({ timeout: 30000 })
}
async function stop() {
  if (!child) return
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${child.pid}).CloseMainWindow() | Out-Null`,
    ],
    { windowsHide: true },
  )
  for (let i = 0; i < 100 && child.exitCode === null; i++)
    await new Promise((r) => setTimeout(r, 100))
  if (child.exitCode === null) child.kill()
  await browser.close().catch(() => {})
  child = undefined
}
const keys = {
  gemini: 'desktop-vault-fixture-' + randomUUID(),
  openai: 'desktop-vault-fixture-' + randomUUID(),
}
try {
  await start()
  await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Manage providers' })
  for (const provider of ['gemini', 'openai']) {
    await settings
      .getByRole('tab', { name: provider === 'gemini' ? 'Google Gemini' : 'OpenAI', exact: true })
      .click()
    await settings
      .getByLabel(provider === 'gemini' ? 'Gemini API key' : 'OpenAI API key', { exact: true })
      .fill(keys[provider])
    await settings.getByRole('button', { name: 'Save API key', exact: true }).click()
    await expect(
      settings.getByText('Key: credential-store · Windows Credential Manager', { exact: true }),
    ).toBeVisible()
  }
  await settings.getByRole('tab', { name: 'Ollama', exact: true }).click()
  await settings.getByLabel('Ollama server', { exact: true }).fill(endpoint)
  await settings.getByRole('button', { name: 'Save Ollama server', exact: true }).click()
  await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
  await expect(settings.getByLabel('Available model')).toHaveValue('desktop-local-double:latest')
  await settings.getByRole('button', { name: 'Run coding-agent check', exact: true }).click()
  await expect(settings.getByText(/Harmless tool-call round trip passed/)).toBeVisible()
  await settings.getByRole('button', { name: 'Use model for new sessions', exact: true }).click()
  await expect(settings.locator('.provider-current-default')).toContainText(
    'desktop-local-double:latest',
  )
  await page.screenshot({ path: join(artifact, 'installed-provider-settings.png') })
  await settings.getByRole('button', { name: 'Close provider settings', exact: true }).click()
  await stop()
  await start()
  await expect(page.getByLabel('Coding provider', { exact: true })).toHaveValue(
    'ollama:desktop-local-double:latest',
  )
  for (const provider of ['gemini', 'openai'])
    expect(
      await new WindowsCredentialStore(provider === 'gemini' ? target + '/Gemini' : target).get(),
    ).toBe(keys[provider])
  const config = await page.evaluate(async () => (await fetch('/api/coding/config')).json())
  for (const key of Object.values(keys)) expect(JSON.stringify(config)).not.toContain(key)
  const proof = {
    exe,
    artifact,
    data,
    target,
    model: 'desktop-local-double:latest',
    provider: 'Ollama protocol double — no live model',
    credentialSources: {
      gemini: config.providers.gemini.keySource,
      openai: config.providers.openai.keySource,
    },
    selection: config.providers.selection,
    roundTrip: true,
    restartPersisted: true,
    secretAbsentFromConfig: true,
  }
  await writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2))
  await writeFile(
    'artifacts/desktop/settings-latest.json',
    JSON.stringify(
      { artifact, data, target, providerFile: join(data, 'sessions/providers.json') },
      null,
      2,
    ),
  )
  console.log(
    'Installed Windows vault, provider settings, tool probe and model restart persistence passed.',
  )
} finally {
  await stop()
  double.closeAllConnections()
  double.close()
}
