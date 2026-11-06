import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/legacy')
  await expect(page.locator('.react-flow__node-future')).toHaveCount(3)
})

test('selects futures by canvas and keyboard; inspector cycles alternatives', async ({ page }) => {
  const inspector = page.getByRole('complementary', { name: 'Future inspector' })
  await page.locator('.react-flow__node[data-id="sessions"]').click()
  await expect(inspector.getByRole('heading', { name: 'Server-Side Sessions' })).toBeVisible()
  await page.getByRole('button', { name: 'Next future', exact: true }).click()
  await expect(inspector.getByRole('heading', { name: 'Managed Authentication' })).toBeVisible()
  await page.locator('.react-flow__node[data-id="jwt"]').focus()
  await page.keyboard.press('Enter')
  await expect(inspector.getByRole('heading', { name: 'JWT Authentication' })).toBeVisible()
  await inspector.getByRole('tab', { name: 'Tests (5)' }).click()
  await inspector.getByRole('button', { name: /Sign-out revokes active access/ }).click()
  await expect(inspector.getByText(/access tokens remain valid until expiry/)).toBeVisible()
})

test('records a local preference and preserves it after reload', async ({ page }) => {
  await page.locator('.react-flow__node[data-id="sessions"]').click()
  await page.getByRole('button', { name: 'Mark as preferred', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Preferred future', exact: true })).toBeVisible()
  await expect(page.locator('.react-flow__node[data-id="sessions"]')).toContainText('Preferred')
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await expect(page.locator('.decision-metric')).toContainText('Future B')
})

test('pans and zooms the canvas, then fits the complete graph', async ({ page }) => {
  const viewport = page.locator('.react-flow__viewport')
  const initial = await viewport.getAttribute('style')
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click()
  await expect(viewport).not.toHaveAttribute('style', initial!)
  const zoomed = await viewport.getAttribute('style')
  await page.locator('.react-flow__pane').hover({ position: { x: 50, y: 50 } })
  await page.mouse.wheel(0, 160)
  await expect(viewport).not.toHaveAttribute('style', zoomed!)
  await page.getByRole('button', { name: 'Fit all futures in view' }).click()
  for (const id of ['jwt', 'sessions', 'managed'])
    await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeInViewport()
})

test('edits and persists acceptance conditions without fabricating new evidence', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Behavioral Contracts', exact: true }).click()
  await page.getByRole('button', { name: 'Edit condition', exact: true }).first().click()
  await page
    .getByRole('textbox', { name: 'Acceptance condition for Preserve existing accounts' })
    .fill('Existing account IDs must remain unchanged after sign-in.')
  await page.getByRole('button', { name: 'Save condition', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Enable Keep account recovery accessible' }).check()
  await page.getByLabel('Filter contracts').selectOption('Security')
  await expect(page.locator('.contract-card')).toHaveCount(3)
  await page.reload()
  await page.getByRole('button', { name: 'Behavioral Contracts', exact: true }).click()
  await expect(
    page.getByText('Existing account IDs must remain unchanged after sign-in.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('checkbox', { name: 'Enable Keep account recovery accessible' }),
  ).toBeChecked()
  await page.getByRole('button', { name: 'Evidence Inspector', exact: true }).click()
  await expect(page.locator('.comparison-table .test-status.failed')).toHaveCount(2)
  await expect(page.locator('.comparison-table .test-status.pending')).toHaveCount(3)
})

test('compares file excerpts and proposed dependencies across alternatives', async ({ page }) => {
  await page.getByRole('button', { name: 'Compare futures', exact: true }).click()
  await page.getByRole('tab', { name: 'Changed files', exact: true }).click()
  await page.getByLabel('Select changed file').selectOption('1')
  await expect(page.locator('.code-diff')).toContainText('issueToken')
  await expect(page.locator('.compare-file')).toContainText('regenerateSession')
  await page.getByLabel('Compare file against another future').selectOption('managed')
  await expect(page.locator('.compare-file')).toContainText('provider.signIn')
  await page.getByRole('tab', { name: 'Dependencies', exact: true }).click()
  await expect(page.locator('.dependency-comparison')).toContainText('express-session')
  await expect(page.locator('.dependency-comparison')).toContainText('not installed')
})

test('explores mission details and filtered hypothetical history', async ({ page }) => {
  await page.getByRole('button', { name: 'Mission Control', exact: true }).click()
  await page.getByRole('button', { name: /Verify each implementation/ }).click()
  await expect(page.locator('.mission-result')).toContainText('No runner exists in Phase 1')
  await page.getByRole('button', { name: 'Development Timeline', exact: true }).click()
  await page.getByRole('button', { name: 'Review & decision', exact: true }).click()
  await expect(page.locator('.timeline-event')).toHaveCount(2)
  await page.locator('.timeline-event').last().click()
  await expect(page.locator('.timeline-detail')).toContainText('The decision stays with you')
  await page.getByRole('button', { name: 'Explore context', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'See the tradeoffs.' })).toBeVisible()
})

test('search navigates by keyboard and closes on Escape', async ({ page }) => {
  await page.getByRole('button', { name: /Search anything/ }).click()
  await page.getByRole('textbox', { name: 'Search screens and futures' }).fill('Future C')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Future inspector' })).toContainText(
    'Managed Authentication',
  )
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Search screens and futures' })
    .fill('no-such-destination')
  await expect(page.getByText(/No destinations match/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('toggles panels and persists display settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Collapse activity panel' }).click()
  await expect(page.locator('.activity-content')).toHaveCount(0)
  await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  await expect(page.getByText('Terminal integration is planned for a future phase.')).toBeVisible()
  await page.getByRole('button', { name: 'Hide future inspector' }).click()
  await expect(page.getByRole('complementary', { name: 'Future inspector' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('switch', { name: 'Canvas grid' }).uncheck()
  await page.getByRole('switch', { name: 'Reduce motion' }).check()
  await page.getByRole('switch', { name: 'Compact navigation' }).check()
  await page.reload()
  await expect(page.locator('.react-flow__background')).toHaveCount(0)
  await expect(page.locator('.reduce-motion')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
})

test('renders every screen without runtime errors or horizontal overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
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
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  expect(errors).toEqual([])
  await page.screenshot({ path: 'artifacts/future-explorer-desktop.png' })
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await expect(page.locator('.section-heading')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'artifacts/dashboard-desktop.png' })
})

test('supports narrow windows with navigation and overlay inspector', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Future inspector' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show future inspector' }).click()
  await expect(page.getByRole('complementary', { name: 'Future inspector' })).toBeVisible()
  await page.getByRole('button', { name: 'Close inspector' }).click()
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
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  await page.screenshot({ path: 'artifacts/future-explorer-narrow.png' })
})
