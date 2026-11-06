import { test, expect } from '@playwright/test'
import { newScenario } from '../../shared/project-replay.ts'

test('built agent workspace executes a real investigation under its browser CSP', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const navigation = await page.goto('/')
  expect(navigation?.headers()['content-security-policy']).toContain("connect-src 'self'")
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Fix the pickup-search race/ }).click()
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
  await expect(page.locator('.cut-agent-status')).toContainText('Investigation ready for review', {
    timeout: 100_000,
  })
  await expect(page.locator('.cut-assertion')).toContainText('Stale response overwrote')
  await expect(page.locator('.cut-browser-stage img')).toBeVisible()
  await page.getByRole('tab', { name: /Candidate A/ }).click()
  await expect(page.locator('.cut-assertion')).toContainText('Latest query preserved')
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByRole('textbox', { name: 'Steer this investigation' })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: `artifacts/agent-production-${width}.png`,
      animations: 'disabled',
    })
  }
  expect(errors).toEqual([])
})

test('project investigation and scenario editor work under production CSP without a provider call', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Investigate browser behavior' }).check()
  await page
    .getByRole('textbox', { name: 'Coding task', exact: true })
    .fill('Configure a browser investigation; preparation only, no model call.')
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
  await expect(page.locator('.cut-agent-status')).toContainText('Investigation ready', {
    timeout: 20_000,
  })
  await page
    .getByRole('textbox', { name: 'Replay scenario JSON' })
    .fill(JSON.stringify(newScenario))
  await page.getByRole('button', { name: 'Save scenario', exact: true }).click()
  await expect(page.locator('.replay-editor')).toContainText('Replay scenario r1')
  await expect(page.getByRole('button', { name: 'Replay Baseline', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
})
