import { scenario } from '../shared/scenario.ts'
import type { Schedule } from '../shared/investigation.ts'

/** Standalone Playwright test: no imports from the runner or candidate implementation. */
export function regressionSource(order: Schedule) {
  return `// PARALLAX reproducible regression. Delivery order: ${order.join(' -> ')}
// Start a pickup fixture server, then set PICKUP_BASE_URL to its URL.
// Put this file in ./regression-export and run:
// npx playwright test --config ./regression-export pickup-regression.spec.ts --output ./regression-export/results
import { test, expect } from '@playwright/test'

test('latest pickup query survives both completed responses', async ({ page }) => {
  const payloads = ${JSON.stringify(scenario, null, 2)}
  const order = ${JSON.stringify(order)} as const
  const gates = new Map<string, () => void>()
  await page.addInitScript(() => {
    const tracked = window as unknown as { handled: string[] }
    tracked.handled = []
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      const query = new URL(response.url).searchParams.get('q')
      const originalJson = response.json.bind(response)
      response.json = async () => {
        const value: unknown = await originalJson()
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (query) tracked.handled.push(query)
        }))
        return value
      }
      return response
    }
  })
  await page.route('**/api/places?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q')
    const id = query === payloads.A.query ? 'A' : query === payloads.B.query ? 'B' : null
    if (!id || gates.has(id)) throw new Error('Requested schedule cannot be executed: unexpected or duplicate query.')
    await new Promise<void>((resolve) => gates.set(id, resolve))
    await route.fulfill({ json: { items: payloads[id].items } })
  })
  await page.goto(process.env.PICKUP_BASE_URL ?? 'http://127.0.0.1:4179')
  for (const id of ['A', 'B'] as const) {
    await page.getByRole('textbox', { name: 'Pickup address' }).fill(payloads[id].query)
    await expect.poll(() => gates.has(id), { timeout: 5000, message: 'Requested request gate never opened.' }).toBe(true)
  }
  for (const id of order) {
    const release = gates.get(id)
    if (!release) throw new Error('Requested schedule cannot be executed: missing gate ' + id)
    release()
    await page.waitForFunction((query) => (window as unknown as { handled: string[] }).handled.includes(query), payloads[id].query)
  }
  await expect(page.getByRole('textbox', { name: 'Pickup address' })).toHaveValue('Colombo')
  await expect(page.getByTestId('place-name'), 'After both deliveries, show only results for the active query.').toHaveText(payloads.B.items)
})
`
}
