import type { Page } from '@playwright/test'

export async function scenarioView(page: Page, mode: 'guided' | 'json') {
  const editor = page.locator('.replay-editor')
  if (!(await editor.evaluate((e) => (e as HTMLDetailsElement).open)))
    await editor.locator(':scope > summary').click()
  const tab = editor.getByRole('tab', {
    name: mode === 'json' ? 'Advanced JSON' : 'Guided editor',
    exact: true,
  })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  return editor
}

export async function replayTools(page: Page) {
  const tools = page.locator('.layout-replay-tools')
  if (!(await tools.evaluate((e: HTMLDetailsElement) => e.open)))
    await tools.locator(':scope > summary').click()
}

export async function eventDetails(page: Page) {
  const show = page.getByRole('button', { name: 'Show event detail', exact: true })
  if (await show.isVisible()) await show.click()
}
export async function closeCompactDetails(page: Page) {
  const close = page.getByRole('button', { name: 'Close event detail', exact: true })
  if (await close.isVisible()) await close.click()
}
