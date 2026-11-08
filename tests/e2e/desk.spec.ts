import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

test('graphite desk: responsive entry, keyboard focus, provider dialog and retained composer draft', async ({
  page,
}) => {
  await mkdir(resolve('artifacts/layout'), { recursive: true })
  await page.goto('/')
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Coding task', exact: true })
    .fill('Retain this task across layout changes.\nA second line.')
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 780, height: 860 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({
      path: resolve(`artifacts/layout/initial-${size.width}.png`),
      fullPage: false,
    })
  }
  await page.getByRole('button', { name: 'Collapse session rail', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Session rail' })).toBeHidden()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Coding task', exact: true })).toHaveValue(
    'Retain this task across layout changes.\nA second line.',
  )
  await expect(page.getByRole('navigation', { name: 'Session rail' })).toBeHidden()
  await page.getByRole('button', { name: 'Expand session rail', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByRole('button', { name: 'Manage providers', exact: true })).toBeEnabled()
  await page.getByRole('link', { name: 'Parallax workspace', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Manage providers', exact: true })).toBeFocused()
  const focus = await page
    .getByRole('button', { name: 'Manage providers', exact: true })
    .evaluate((el) => {
      const s = getComputedStyle(el)
      return { width: s.outlineWidth, style: s.outlineStyle }
    })
  expect(focus).toEqual({ width: '2px', style: 'solid' })
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Manage providers' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Close provider settings', exact: true }),
  ).toBeFocused()
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size)
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1)
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1)
    if (size.width >= 1280) {
      for (const name of [
        'Save API key',
        'Test connection',
        'Run coding-agent check',
        'Use model for new sessions',
      ])
        await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
      await expect(dialog.getByLabel('Available model')).toBeInViewport({ ratio: 1 })
    }
    await page.screenshot({ path: resolve(`artifacts/layout/providers-${size.width}.png`) })
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Manage providers', exact: true })).toBeFocused()
  expect(
    await page
      .getByRole('button', { name: 'Manage providers', exact: true })
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe('0s')
  await expect(page.getByRole('textbox', { name: 'Coding task', exact: true })).toHaveValue(
    'Retain this task across layout changes.\nA second line.',
  )
})
