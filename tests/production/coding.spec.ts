import { test, expect } from '@playwright/test'

test('everyday coding entry obeys production CSP and fits desktop and narrow screens', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'self'")
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Coding task', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Compare approaches' })).not.toBeChecked()
  await page.getByRole('button', { name: 'Open repository', exact: true }).click()
  await expect(page.locator('.coding-baseline')).toContainText('Branch:')
  await expect(page.locator('.coding-baseline')).toContainText('Baseline:')
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: `artifacts/coding-entry-production-${width}.png`,
      animations: 'disabled',
    })
  }
  expect(errors).toEqual([])
})
