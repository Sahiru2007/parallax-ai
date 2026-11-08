import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function captureDesk(page: Page, name: string, fullPage = false) {
  const dir = resolve('artifacts/layout')
  await mkdir(dir, { recursive: true })
  await page.screenshot({ path: resolve(dir, `${name}-viewport.png`) })
  if (fullPage) await page.screenshot({ path: resolve(dir, `${name}-full.png`), fullPage: true })
}

export async function verifyDeskLayout(page: Page, kind: 'coding' | 'comparison') {
  const original = page.viewportSize()!
  const fullTask = page.locator('.desk-full-task > summary')
  await fullTask.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.desk-full-task > div')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('.desk-full-task > div')).toBeHidden()
  await page.setViewportSize({ width: 1920, height: 1080 })
  const divider = page.getByRole('separator', { name: 'Resize conversation pane' })
  await divider.focus()
  const width = Number(await divider.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowLeft')
  await expect(divider).toHaveAttribute('aria-valuenow', String(Math.max(280, width - 16)))
  await page.keyboard.press('ArrowRight')
  await page.evaluate(() => window.scrollTo(0, 0))
  const box = (await divider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 80)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + 80)
  await page.mouse.up()
  await expect(divider).toHaveAttribute('aria-valuenow', String(width + 32))
  const draft = page.getByRole('textbox', { name: 'Follow-up instruction' })
  await draft.fill('Keep this draft while the desk updates.\nPreserve the selected text.')
  await draft.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(5, 17))
  const transcript = page.getByLabel('Conversation and tool activity')
  await transcript.evaluate((el) => {
    el.scrollTop = 40
  })
  const scrollTop = await transcript.evaluate((el) => el.scrollTop)
  await page.waitForTimeout(1100)
  await expect(draft).toHaveValue(
    'Keep this draft while the desk updates.\nPreserve the selected text.',
  )
  expect(
    await draft.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]),
  ).toEqual([5, 17])
  expect(await transcript.evaluate((el) => el.scrollTop)).toBe(scrollTop)
  await page.reload()
  await expect(divider).toHaveAttribute('aria-valuenow', String(width + 32))
  await expect(draft).toHaveValue(
    'Keep this draft while the desk updates.\nPreserve the selected text.',
  )
  await draft.fill('')
  if (kind === 'comparison') {
    const recorded = await page.getByRole('img', { name: /Captured browser/ }).getAttribute('src')
    const playheadBefore = await page.getByTestId('shared-playhead').getAttribute('style')
    await page.getByRole('tab', { name: 'Code', exact: true }).click()
    await expect(page.getByLabel('Selected file diff')).toBeVisible()
    await page.getByRole('tab', { name: 'Replay', exact: true }).click()
    await expect(page.getByRole('img', { name: /Captured browser/ })).toHaveAttribute(
      'src',
      recorded!,
    )
    expect(await page.getByTestId('shared-playhead').getAttribute('style')).toBe(playheadBefore)
    await page.reload()
    await expect(page.getByRole('tab', { name: 'Replay', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.evaluate(() => document.fonts.ready)
    await verifyReplayViewport(page)
    await captureDesk(page, 'comparison-agent-1920', true)
    await page.getByRole('button', { name: 'Focus replay', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Session rail' })).toBeHidden()
    await expect(page.locator('.coding-conversation')).toBeHidden()
    const detail = page.getByRole('separator', { name: 'Resize event detail pane' })
    await detail.focus()
    await page.keyboard.press('ArrowRight')
    await expect(detail).toHaveAttribute('aria-valuenow', '316')
    const versions = page.getByRole('tablist', { name: 'Replay versions' })
    await versions.getByRole('tab', { name: /Approach A/ }).click()
    await page.getByRole('button', { name: 'First unexpected state', exact: true }).isEnabled()
    const playhead = await page.getByTestId('shared-playhead').getAttribute('style')
    await versions.getByRole('tab', { name: /Approach B/ }).focus()
    await page.keyboard.press('Enter')
    expect(await page.getByTestId('shared-playhead').getAttribute('style')).toBe(playhead)
    if (
      !(await page.locator('.project-relevant-diff').evaluate((el: HTMLDetailsElement) => el.open))
    )
      await page.locator('.project-relevant-diff summary').click()
    await expect(page.locator('.project-relevant-diff pre')).not.toBeEmpty()
    await page.getByRole('button', { name: 'Browser at actual size', exact: true }).click()
    await expect(page.locator('.project-browser-frame')).toHaveClass(/frame-native/)
    await page.getByRole('button', { name: 'Fit browser frame', exact: true }).click()
    await captureDesk(page, 'comparison-detail-1920', true)
    await page.locator('.project-relevant-diff summary').click()
  }
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 780, height: 860 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size)
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await captureDesk(page, `${kind}-${size.width}`, true)
  }
  if (kind === 'comparison') {
    const networkLabel = page.locator('.project-track > strong').nth(1)
    await networkLabel.scrollIntoViewIfNeeded()
    await expect(networkLabel).toBeInViewport()
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.getByRole('button', { name: 'Show activity', exact: true }).click()
    await page.getByRole('button', { name: 'Expand session rail', exact: true }).click()
    await page
      .getByRole('tablist', { name: 'Replay versions' })
      .getByRole('tab', { name: /Approach A/ })
      .click()
  }
  await page.setViewportSize(original)
}

async function verifyReplayViewport(page: Page) {
  const versions = page.getByRole('tablist', { name: 'Replay versions' })
  const splitter = page.getByRole('separator', { name: 'Resize browser and timeline' })
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(size.height)
    for (const selector of [
      '.project-version-tabs',
      '.project-browser',
      '.project-timeline',
      '.project-scrubber',
    ]) {
      const box = (await page.locator(selector).boundingBox())!
      expect(box.y, selector).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height, selector).toBeLessThanOrEqual(size.height + 1)
    }
    for (const label of await page.locator('.project-track > strong').all())
      await expect(label).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'Replay all', exact: true })).toBeInViewport({
      ratio: 1,
    })
    if (size.width === 1920)
      await expect(
        page.getByRole('complementary', { name: 'Replay checkpoint inspector' }),
      ).toBeInViewport({ ratio: 1 })
    else {
      const close = page.getByRole('button', { name: 'Close event detail', exact: true })
      if (await close.isVisible()) await close.click()
      await expect(
        page.getByRole('complementary', { name: 'Replay checkpoint inspector' }),
      ).toBeHidden()
      await page.getByRole('button', { name: 'Show event detail', exact: true }).click()
      await expect(
        page.getByRole('button', { name: 'Close event detail', exact: true }),
      ).toBeInViewport({ ratio: 1 })
      await captureDesk(page, 'replay-compact-detail-1280', true)
      await page.getByRole('button', { name: 'Close event detail', exact: true }).click()
    }
    await splitter.focus()
    await page.keyboard.press('Home')
    const small = (await page.locator('.project-browser').boundingBox())!.height
    await page.keyboard.press('End')
    const large = (await page.locator('.project-browser').boundingBox())!.height
    expect(large).toBeGreaterThan(small + 10)
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowDown')
    await expect(splitter).toHaveAttribute('aria-valuenow', '32')
    const box = (await splitter.boundingBox())!
    await page.mouse.move(box.x + Math.min(100, box.width / 2), box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + Math.min(100, box.width / 2), box.y + box.height / 2 + 30)
    await page.mouse.up()
    const moved = Number(await splitter.getAttribute('aria-valuenow'))
    expect(moved).toBeGreaterThan(32)
    const scrubber = page.getByRole('slider', { name: 'Replay playhead' })
    await scrubber.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    const key = await page.locator('.project-clip.selected > button').getAttribute('aria-label')
    await versions.getByRole('tab', { name: /Approach A/ }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.project-clip.selected > button')).toHaveAttribute(
      'aria-label',
      key!,
    )
    await versions.getByRole('tab', { name: /Approach B/ }).click()
    await expect(page.locator('.project-clip.selected > button')).toHaveAttribute(
      'aria-label',
      key!,
    )
    await scrubber.focus()
    await page.keyboard.press('End')
    await captureDesk(page, `replay-fit-${size.width}`, true)
    await page.reload()
    await expect(
      page.getByRole('separator', { name: 'Resize browser and timeline' }),
    ).toHaveAttribute('aria-valuenow', String(Math.round(moved)))
  }
  await page.setViewportSize({ width: 1920, height: 1080 })
  // Restore the default preferred share through keyboard controls, preserving later interaction checks.
  await splitter.focus()
  await page.keyboard.press('End')
  for (let i = 70; i > 55; i -= 5) await page.keyboard.press('Shift+ArrowUp')
}
