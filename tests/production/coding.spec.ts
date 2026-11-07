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
  await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
  const providers = page.getByRole('dialog', { name: 'Manage providers' })
  await providers.getByRole('tab', { name: 'Google Gemini', exact: true }).click()
  await expect(providers.getByLabel('Gemini API key', { exact: true })).toHaveAttribute(
    'type',
    'password',
  )
  await providers.getByRole('tab', { name: 'OpenAI', exact: true }).click()
  await expect(providers.getByLabel('OpenAI API key', { exact: true })).toHaveAttribute(
    'type',
    'password',
  )
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(providers).toBeVisible()
    expect(await providers.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  }
  await providers.getByRole('tab', { name: 'Ollama', exact: true }).click()
  await expect(providers.getByLabel('Ollama server')).toHaveValue('http://127.0.0.1:11434')
  await page.keyboard.press('Escape')
  await expect(providers).toHaveCount(0)
  expect(errors).toEqual([])
})
