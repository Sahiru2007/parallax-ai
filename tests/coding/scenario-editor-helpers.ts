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
