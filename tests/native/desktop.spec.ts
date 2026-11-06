import { chromium, expect, test } from '@playwright/test'

test('native Tauri window preserves all frontend interactions', async () => {
  const endpoint = process.env.PARALLAX_CDP_URL ?? 'http://127.0.0.1:9222'
  const address = new URL(endpoint)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) {
    throw new Error('Native verification requires a loopback-only WebView2 debugger.')
  }
  const browser = await chromium.connectOverCDP(endpoint)
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => /127\.0\.0\.1:1420|tauri\.localhost|^tauri:/.test(candidate.url()))
  if (!page) {
    await browser.close()
    throw new Error('No PARALLAX Tauri WebView2 page was found. Start the native app first.')
  }
  const saved = await page.evaluate(() => localStorage.getItem('parallax-phase1'))
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  try {
    await test.step('Confirm Tauri runtime and the native main window', async () => {
      const windowLabel = await page.evaluate(() => {
        const runtime = (
          window as unknown as {
            __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } }
          }
        ).__TAURI_INTERNALS__
        return runtime?.metadata?.currentWindow?.label
      })
      expect(windowLabel).toBe('main')
      await expect(page).toHaveTitle('PARALLAX AI — Development Multiverse')
      await page.evaluate(() => localStorage.removeItem('parallax-phase1'))
      await page.reload()
      await expect(page.locator('.react-flow__node-future')).toHaveCount(3)
    })
    await test.step('Render all seven screens through sidebar navigation', async () => {
      for (const screen of [
        'Dashboard',
        'Behavioral Contracts',
        'Mission Control',
        'Development Timeline',
        'Evidence Inspector',
        'Settings',
        'Future Explorer',
      ]) {
        await page.getByRole('button', { name: screen, exact: true }).click()
        await expect(page.locator('main h1')).toBeVisible()
        const heading = page.locator('.section-heading')
        if (await heading.count()) await expect(heading).toHaveCSS('opacity', '1')
        await page.screenshot({
          path: `artifacts/native-${screen.toLowerCase().replaceAll(' ', '-')}.png`,
          animations: 'disabled',
        })
      }
    })
    await test.step('Select, zoom, inspect, and prefer a future', async () => {
      const inspector = page.getByRole('complementary', { name: 'Future inspector' })
      await page.locator('.react-flow__node[data-id="sessions"]').click()
      await expect(inspector.getByRole('heading', { name: 'Server-Side Sessions' })).toBeVisible()
      const viewport = page.locator('.react-flow__viewport')
      const initial = await viewport.getAttribute('style')
      await page.getByRole('button', { name: 'Zoom In', exact: true }).click()
      await expect(viewport).not.toHaveAttribute('style', initial!)
      await page.getByRole('button', { name: 'Fit all futures in view' }).click()
      await inspector.getByRole('tab', { name: 'Tests (5)' }).click()
      await expect(inspector.locator('.example-test')).toHaveCount(5)
      await page.getByRole('button', { name: 'Next future', exact: true }).click()
      await expect(inspector.getByRole('heading', { name: 'Managed Authentication' })).toBeVisible()
      await page.getByRole('button', { name: 'Mark as preferred', exact: true }).click()
      await page.reload()
      await expect(
        page.getByRole('button', { name: 'Preferred future', exact: true }),
      ).toBeVisible()
    })
    await test.step('Edit and persist a behavioral contract', async () => {
      await page.getByRole('button', { name: 'Behavioral Contracts', exact: true }).click()
      await page.getByRole('button', { name: 'Edit condition', exact: true }).first().click()
      await page
        .getByRole('textbox', { name: 'Acceptance condition for Preserve existing accounts' })
        .fill('Native verification: existing account IDs remain unchanged.')
      await page.getByRole('button', { name: 'Save condition', exact: true }).click()
      await page.reload()
      await page.getByRole('button', { name: 'Behavioral Contracts', exact: true }).click()
      await expect(
        page.getByText('Native verification: existing account IDs remain unchanged.', {
          exact: true,
        }),
      ).toBeVisible()
    })
    await test.step('Compare evidence, files, and dependencies', async () => {
      await page.getByRole('button', { name: 'Evidence Inspector', exact: true }).click()
      await expect(page.locator('.comparison-table .test-status.failed')).toHaveCount(2)
      await page.getByRole('tab', { name: 'Changed files', exact: true }).click()
      await page.getByLabel('Select changed file').selectOption('1')
      await expect(page.locator('.code-diff pre')).toHaveCount(2)
      await page.getByRole('tab', { name: 'Dependencies', exact: true }).click()
      await expect(page.locator('.dependency-comparison')).toContainText('express-session')
    })
    await test.step('Persist preferences and collapse application panels', async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('switch', { name: 'Canvas grid' }).uncheck()
      await page.getByRole('switch', { name: 'Reduce motion' }).check()
      await page.getByRole('switch', { name: 'Compact navigation' }).check()
      await page.reload()
      await expect(page.locator('.react-flow__node-future')).toHaveCount(3)
      await expect(page.locator('.react-flow__background')).toHaveCount(0)
      await expect(page.locator('.reduce-motion')).toBeVisible()
      await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
      await page.getByRole('button', { name: 'Collapse activity panel' }).click()
      await expect(page.locator('.activity-content')).toHaveCount(0)
      await page.getByRole('button', { name: 'Hide future inspector' }).click()
      await expect(page.locator('.inspector')).toHaveCount(0)
    })
    expect(errors).toEqual([])
  } finally {
    await page.evaluate((original) => {
      if (original === null) localStorage.removeItem('parallax-phase1')
      else localStorage.setItem('parallax-phase1', original)
    }, saved)
    await page.reload()
    await browser.close()
  }
})
