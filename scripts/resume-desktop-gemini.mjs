import { chromium, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const latest = JSON.parse(await readFile('artifacts/desktop/gemini-latest.json', 'utf8'))
const proof = JSON.parse(await readFile(join(latest.artifact, 'proof.json'), 'utf8'))
if (proof.run?.recovery?.kind !== 'limit' || proof.run.rounds !== 4)
  throw Error(
    'Only the retained four-round live verification is eligible for this bounded continuation.',
  )
const env = {
  ...process.env,
  PARALLAX_DESKTOP_TEST: '1',
  PARALLAX_DESKTOP_DATA_DIR: latest.data,
  PARALLAX_START_LINK: proof.launchedViaStartShortcut,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    '--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1',
}
for (const key of [
  'PARALLAX_ENABLE_TEST_PROVIDER',
  'PARALLAX_TEST_PROVIDER_FILE',
  'PARALLAX_CREDENTIAL_TARGET',
  'PARALLAX_GEMINI_TEST_URL',
])
  delete env[key]
const pid = Number(
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$app=Start-Process -FilePath $env:PARALLAX_START_LINK -WindowStyle Normal -PassThru; $app.Id',
    ],
    { env, encoding: 'utf8', windowsHide: true },
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
try {
  for (let i = 0; i < 400; i++) {
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
  const state = () =>
    page.evaluate(async () => {
      const id = localStorage.getItem('parallax-coding-session')
      return (await fetch('/api/coding/sessions/' + id)).json()
    })
  const before = await state()
  expect(before.id).toBe(proof.session)
  expect(before.providerRuns.at(-1).id).toBe(proof.run.id)
  await page.getByLabel('Additional agent rounds', { exact: true }).fill('6')
  await page.getByRole('button', { name: 'Continue AI with 6 more rounds', exact: true }).click()
  await expect.poll(async () => (await state()).providerRuns.at(-1).continuations).toBe(1)
  let s
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    s = await state()
    if (s.approval) {
      await expect(page.getByRole('region', { name: 'Command approval' })).toContainText(
        s.approval.cwd,
      )
      await page.getByRole('button', { name: 'Approve command', exact: true }).click()
    }
    if (!s.busy) break
    await page.waitForTimeout(250)
  }
  if (s.busy) {
    await page.getByRole('button', { name: 'Cancel turn', exact: true }).click()
    await expect.poll(async () => (await state()).busy).toBe(false)
    s = await state()
  }
  proof.run = s.providerRuns.at(-1)
  proof.checks = s.checks
  proof.files = s.candidates[0].files.map((f) => f.path)
  proof.maxToolRounds = 10
  proof.manualAdditionalRounds = 6
  proof.sameSessionResumed = true
  proof.status =
    proof.run.status === 'completed' && s.checks.some((c) => c.status === 'passed')
      ? 'passed'
      : 'blocked'
  proof.reason = proof.status === 'passed' ? undefined : s.error || proof.run.recovery?.message
  await page.screenshot({ path: join(latest.artifact, 'live-gemini-continued.png') })
  await writeFile(join(latest.artifact, 'session.json'), JSON.stringify(s, null, 2))
  await writeFile(join(latest.artifact, 'proof.json'), JSON.stringify(proof, null, 2))
  await writeFile(
    'artifacts/desktop/gemini-latest.json',
    JSON.stringify(
      {
        artifact: latest.artifact,
        data: latest.data,
        status: proof.status,
        model: proof.model,
        actualModel: proof.run.actualModel,
        reason: proof.reason,
      },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify({
      status: proof.status,
      model: proof.model,
      actualModel: proof.run.actualModel,
      rounds: proof.run.rounds,
      files: proof.files,
      checks: s.checks.map((c) => ({ command: c.command, status: c.status })),
      reason: proof.reason,
    }),
  )
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
