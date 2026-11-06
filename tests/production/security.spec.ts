import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
  app: { security: { csp: string } }
}

test('production assets obey the desktop CSP across screens and window sizes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const response = await route.fetch()
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': config.app.security.csp },
    })
  })
  await page.goto('/')
  await expect(page.locator('.react-flow__node-future')).toHaveCount(3)
  await expect(page.locator('animateMotion')).toHaveCount(0)
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390) {
      await page.getByRole('button', { name: 'Hide future inspector', exact: true }).click()
    }
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
      const dimensions = await page.locator('main > div').evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }))
      expect(dimensions.scroll, `${screen} at ${width}px should fit its panel`).toBeLessThanOrEqual(
        dimensions.client + 1,
      )
      if (width === 1440) {
        await page.screenshot({
          path: `artifacts/production-${screen.toLowerCase().replaceAll(' ', '-')}.png`,
          animations: 'disabled',
        })
      }
    }
  }
  await page.evaluate(() => document.fonts.ready)
  expect(errors).toEqual([])
})
