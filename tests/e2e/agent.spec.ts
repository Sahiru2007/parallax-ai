import { test, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Investigation, RunnerConfig } from '../../shared/investigation.ts'
import { captureSnapshot } from '../../runner/worktrees.ts'
import { EXPECTED_ITEMS, scenario } from '../../shared/scenario.ts'

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)
let completedSession: string | null = null
test.afterEach(async ({ page, request }, info) => {
  if (info.status === info.expectedStatus) return
  const id = await page
    .evaluate(() => localStorage.getItem('parallax-investigation'))
    .catch(() => null)
  if (!id) return
  const config = (await (await request.get('/api/config')).json()) as RunnerConfig
  await request.post(`/api/sessions/${id}/cancel`, {
    headers: { 'X-Parallax-Token': config.token },
  })
  await expect
    .poll(
      async () => ((await (await request.get(`/api/sessions/${id}`)).json()) as Investigation).busy,
    )
    .toBe(false)
})

test('investigate, edit timing, compare real worktrees, export a checked patch and regression', async ({
  page,
  request,
}) => {
  const initialHook = await readFile('fixtures/pickup-search/src/useAddressSearch.ts', 'utf8')
  const initialSnapshot = await captureSnapshot(process.cwd())
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1050 })
  await page.goto('/')
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Coding task' })).toBeVisible()
  await page.screenshot({ path: 'artifacts/agent-entry.png' })
  await page.getByRole('button', { name: /Fix the pickup-search race/ }).click()
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Steer this investigation' })).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Steer this investigation' })
    .fill('Keep the same request payloads and final assertion for every version.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.cut-agent-status')).toContainText('Investigation ready for review', {
    timeout: 100_000,
  })
  const id = await page.evaluate(() => localStorage.getItem('parallax-investigation'))
  expect(id).toBeTruthy()
  const state = (await (await request.get(`/api/sessions/${id}`)).json()) as Investigation
  expect(state.status).toBe('ready')
  completedSession = state.id
  expect(state.revision).toBe(revision)
  expect(state.dirty).toBe(initialSnapshot.dirty)
  expect(state.snapshot).toMatch(/^[a-f0-9]{64}$/)
  expect(state.candidates.map((item) => item.worktree)).toHaveLength(3)
  for (const candidate of state.candidates) {
    expect(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: candidate.worktree,
        encoding: 'utf8',
      }).trim(),
    ).toBe(revision)
  }
  expect(state.runs.map((run) => [run.version, run.schedule.join(','), run.status])).toEqual([
    ['baseline', 'B,A', 'failed'],
    ['baseline', 'A,B', 'passed'],
    ['a', 'B,A', 'passed'],
    ['a', 'A,B', 'passed'],
    ['b', 'B,A', 'passed'],
    ['b', 'A,B', 'passed'],
  ])
  expect(state.checks).toHaveLength(8)
  expect(state.checks.every((check) => check.exitCode === 0)).toBe(true)
  for (const run of state.runs) {
    expect(
      run.events.filter((event) => event.kind === 'action').map((event) => event.query),
    ).toEqual(['Col', 'Colombo'])
    expect(
      run.events
        .filter((event) => event.kind === 'response')
        .map((event) => [event.requestId, event.payload]),
    ).toEqual(run.schedule.map((id) => [id, [...scenario[id].items]]))
    expect(run.expectedItems).toEqual(EXPECTED_ITEMS)
  }
  expect(
    state.events.some(
      (event) => event.kind === 'read' && event.detail.includes('setResults(payload.items)'),
    ),
  ).toBe(true)
  expect(state.steering).toContain(
    'Keep the same request payloads and final assertion for every version.',
  )
  await expect(page.locator('.cut-assertion')).toContainText('Stale response overwrote')
  await expect(page.locator('.cut-browser-stage img')).toBeVisible()
  await page.getByRole('button', { name: /Inspect response A:/ }).click()
  await expect(page.getByRole('complementary', { name: 'Selected event evidence' })).toContainText(
    'Colpetty Market',
  )
  await page.screenshot({ path: 'artifacts/agent-baseline-failure.png' })
  await page.getByRole('tab', { name: /Candidate A/ }).click()
  await expect(page.locator('.cut-assertion')).toContainText('Latest query preserved')
  await expect(page.locator('.cut-order-pill')).toHaveText('BA')
  await page.getByRole('tab', { name: /Candidate B/ }).click()
  await expect(page.locator('.cut-assertion')).toContainText('Latest query preserved')
  await page.getByRole('tab', { name: /Baseline/ }).click()
  await page.getByTestId('response-B').dragTo(page.getByTestId('response-A'))
  await expect(page.locator('.cut-order-pill')).toHaveText('AB')
  await expect(page.locator('.cut-assertion')).toContainText('Stale evidence')
  await expect(page.getByRole('tab', { name: /Baseline/ })).toContainText('STALE')
  await page.reload()
  await expect(page.locator('.cut-assertion')).toContainText('Stale evidence')
  await expect(page.locator('.cut-order-pill')).toHaveText('AB')
  await page.getByRole('button', { name: 'Replay all versions', exact: true }).click()
  await expect(page.locator('.cut-agent-status')).toContainText('Replay complete', {
    timeout: 60_000,
  })
  await expect(page.locator('.cut-assertion')).toContainText('Latest query preserved')
  await page.getByRole('button', { name: 'Move response B earlier', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.cut-order-pill')).toHaveText('BA')
  await expect(page.locator('.cut-assertion')).toContainText('Stale evidence')
  await page.getByRole('button', { name: 'Replay all versions', exact: true }).click()
  await expect(page.locator('.cut-agent-status')).toContainText('Replay complete', {
    timeout: 60_000,
  })
  await expect(page.locator('.cut-assertion')).toContainText('Stale response overwrote')
  await page.getByRole('tab', { name: /Candidate A/ }).click()
  await page.getByRole('button', { name: 'Review patch', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Candidate patch drawer' })).toBeVisible()
  await expect(page.locator('.cut-diff-code')).toContainText('latestRequest')
  const patchDownload = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export this patch', exact: true }).click()
  await mkdir('artifacts/e2e-exports', { recursive: true })
  const patchPath = resolve('artifacts/e2e-exports/candidate-a.patch')
  await (await patchDownload).saveAs(patchPath)
  execFileSync('git', ['apply', '--check', patchPath], { cwd: state.candidates[0].worktree })
  await page.screenshot({ path: 'artifacts/agent-patch-review.png' })
  await page.getByRole('button', { name: 'Close patch drawer' }).click()
  const regressionDownload = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Save regression test', exact: true }).click()
  const regressionPath = resolve('artifacts/e2e-exports/pickup-regression.spec.ts')
  await (await regressionDownload).saveAs(regressionPath)
  const checkedSource = await readFile(
    `artifacts/investigations/${id}/exports/a/pickup-regression.spec.ts`,
    'utf8',
  )
  expect(await readFile(regressionPath, 'utf8')).toBe(checkedSource)
  const checkedConfig = await readFile(
    `artifacts/investigations/${id}/exports/a/playwright.config.mjs`,
    'utf8',
  )
  const fixtureUrl = JSON.parse(checkedConfig.match(/PICKUP_BASE_URL=("[^"]+")/)![1]) as string
  const downloadedTestOutput = execFileSync(
    process.execPath,
    [
      resolve('node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      resolve('artifacts/e2e-exports'),
      'pickup-regression.spec.ts',
      '--output',
      resolve('artifacts/e2e-exports/results'),
    ],
    { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PICKUP_BASE_URL: fixtureUrl } },
  )
  expect(downloadedTestOutput).toContain('1 passed')
  expect(checkedSource).toContain('After both deliveries, show only results for the active query.')
  const updated = (await (await request.get(`/api/sessions/${id}`)).json()) as Investigation
  expect(updated.runs).toHaveLength(12)
  expect(updated.runs.at(-3)?.status).toBe('failed')
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Steer this investigation' })).toBeVisible()
  await expect(page.locator('.cut-order-pill')).toHaveText('BA')
  expect(await readFile('fixtures/pickup-search/src/useAddressSearch.ts', 'utf8')).toBe(initialHook)
  expect(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(revision)
  expect((await captureSnapshot(process.cwd())).digest).toBe(initialSnapshot.digest)
  expect(errors).toEqual([])
  await page.getByRole('tab', { name: /Candidate B/ }).click()
  await page.screenshot({ path: 'artifacts/agent-candidate-success.png' })
})

test('a delayed response from an older session cannot replace a retry or its reload target', async ({
  page,
}) => {
  if (!completedSession) throw new Error('Completed session is required')
  await page.goto('/pickup')
  await page.evaluate((id) => localStorage.setItem('parallax-investigation', id), completedSession)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Steer this investigation' })).toBeVisible()
  let release!: () => void
  let captured!: () => void
  const held = new Promise<void>((r) => {
    release = r
  })
  const intercepted = new Promise<void>((r) => {
    captured = r
  })
  await page.route(`**/api/sessions/${completedSession}/steer`, async (route) => {
    const response = await route.fetch()
    const json = await response.json()
    captured()
    await held
    await route.fulfill({ json })
  })
  await page
    .getByRole('textbox', { name: 'Steer this investigation' })
    .fill('Hold this response to reproduce a network race')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await intercepted
  await page.getByRole('button', { name: 'New investigation', exact: true }).click()
  await page.getByRole('button', { name: /Fix the pickup-search race/ }).click()
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cancel active run', exact: true })).toBeVisible()
  const fresh = await page.evaluate(() => localStorage.getItem('parallax-investigation'))
  expect(fresh).toBeTruthy()
  expect(fresh).not.toBe(completedSession)
  const delivered = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/${completedSession}/steer`) &&
      response.request().method() === 'POST',
  )
  release()
  await delivered
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('parallax-investigation')))
    .toBe(fresh)
  await page.getByRole('button', { name: 'Cancel active run', exact: true }).click()
  await expect(page.locator('.cut-agent-status')).toContainText('Run cancelled')
  await page.reload()
  await expect(page.locator('.cut-agent-status')).toContainText('Run cancelled')
  expect(await page.evaluate(() => localStorage.getItem('parallax-investigation'))).toBe(fresh)
  await page.getByRole('button', { name: 'Clean up candidate worktrees', exact: true }).click()
})

test('cancel active tools and reject invalid schedules and foreign requests', async ({
  page,
  request,
}) => {
  const config = (await (await request.get('/api/config')).json()) as RunnerConfig
  const headers = { 'X-Parallax-Token': config.token }
  const rejected = await request.post('/api/sessions', {
    data: { repo: 'current', task: 'test', mode: 'sample' },
  })
  expect(rejected.status()).toBe(403)
  const foreign = await request.post('/api/sessions', {
    headers: { ...headers, Origin: 'https://untrusted.example' },
    data: { repo: 'current', task: 'test', mode: 'sample' },
  })
  expect(foreign.status()).toBe(403)
  const invalidRepo = await request.post('/api/sessions', {
    headers,
    data: { repo: 'missing-repository', task: 'test', mode: 'sample' },
  })
  expect(invalidRepo.status()).toBe(400)
  await page.goto('/')
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Fix the pickup-search race/ }).click()
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel active run', exact: true }).click()
  await expect(page.locator('.cut-agent-status')).toContainText('Run cancelled', {
    timeout: 15_000,
  })
  const id = await page.evaluate(() => localStorage.getItem('parallax-investigation'))
  const cancelled = (await (await request.get(`/api/sessions/${id}`)).json()) as Investigation
  expect(cancelled.status).toBe('cancelled')
  expect(cancelled.busy).toBe(false)
  const invalid = await request.post(`/api/sessions/${id}/replay`, {
    headers,
    data: { order: ['A', 'A'] },
  })
  expect(invalid.status()).toBe(400)
  // An impossible schedule is rejected before a new browser run starts.
  expect((await invalid.json()).error).toMatch(
    /cannot be executed|Wait for all candidate worktrees/,
  )
  if (!completedSession)
    throw new Error(
      'The completed investigation is required for browser cancellation verification.',
    )
  const beforeReplay = (await (
    await request.get(`/api/sessions/${completedSession}`)
  ).json()) as Investigation
  await request.post(`/api/sessions/${completedSession}/replay`, {
    headers,
    data: { order: ['B', 'A'] },
  })
  await expect
    .poll(
      async () => {
        const current = (await (
          await request.get(`/api/sessions/${completedSession}`)
        ).json()) as Investigation
        return current.events
          .slice(beforeReplay.events.length)
          .some((event) => event.title.includes('observed UI after response'))
      },
      { timeout: 15_000 },
    )
    .toBe(true)
  await request.post(`/api/sessions/${completedSession}/cancel`, { headers, data: {} })
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/sessions/${completedSession}`)).json()) as Investigation)
          .status,
      { timeout: 15_000 },
    )
    .toBe('cancelled')
  const previous = id
  await page.getByRole('button', { name: 'Retry investigation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cancel active run', exact: true })).toBeVisible()
  const retryId = await page.evaluate(() => localStorage.getItem('parallax-investigation'))
  expect(retryId).not.toBe(previous)
  await page.getByRole('button', { name: 'Cancel active run', exact: true }).click()
  await expect(page.locator('.cut-agent-status')).toContainText('Run cancelled')
  await page.getByRole('button', { name: 'Clean up candidate worktrees', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Clean up candidate worktrees', exact: true }),
  ).toHaveCount(0)
  const cleaned = (await (await request.get(`/api/sessions/${retryId}`)).json()) as Investigation
  expect(cleaned.cleanedAt).toBeTruthy()
  expect(cleaned.runs).toEqual([])
  expect((await (await request.get(`/api/sessions/${previous}`)).json()).status).toBe('cancelled')
})
