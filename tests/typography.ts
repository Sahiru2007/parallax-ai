import { expect, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
export async function verifyTypography(page: Page, variant: string) {
  const external: string[] = []
  const fontResponses: string[] = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      external.push(route.request().url())
      await route.abort()
      return
    }
    await route.continue()
  })
  page.on('response', (response) => {
    if (response.request().resourceType() === 'font' && response.ok())
      fontResponses.push(new URL(response.url()).pathname)
  })
  await page.goto('/')
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
  const faces = await page.evaluate(async () => {
    const requests = [
      ['Barlow', 400],
      ['Barlow', 500],
      ['Barlow Condensed', 500],
      ['IBM Plex Mono', 400],
      ['IBM Plex Mono', 500],
    ] as const
    return Promise.all(
      requests.map(async ([family, weight]) => {
        const faces = await document.fonts.load(
          `${weight} 15px "${family}"`,
          'Parallax 0123456789 →',
        )
        return {
          family,
          weight,
          loaded:
            faces.length > 0 &&
            faces.every((f) => f.status === 'loaded' && f.weight === String(weight)),
        }
      }),
    )
  })
  expect(faces.every((face) => face.loaded)).toBe(true)
  const fontProof = await page.evaluate(() => {
    const style = (selector: string) => {
      const s = getComputedStyle(document.querySelector(selector)!)
      return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight }
    }
    return {
      interface: style('.coding-entry > p'),
      heading: style('.coding-entry h1'),
      wordmark: style('.coding-logo strong'),
      technical: style('.coding-baseline code'),
    }
  })
  expect(fontProof.interface).toMatchObject({ family: 'Barlow, sans-serif', size: '15px' })
  expect(fontProof.heading).toMatchObject({
    family: '"Barlow Condensed", sans-serif',
    size: '28px',
    weight: '500',
  })
  expect(fontProof.technical.family).toContain('IBM Plex Mono')
  const colors = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement)
    return Object.fromEntries(
      [
        'graphite-base',
        'graphite-panel',
        'silver-text',
        'silver-muted',
        'citron',
        'citron-ink',
        'status-success',
        'status-failure',
        'status-stale',
        'status-interrupted',
      ].map((k) => [k, s.getPropertyValue('--' + k).trim()]),
    )
  })
  function lum(hex: string) {
    const c = hex
      .replace('#', '')
      .match(/../g)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
  }
  const contrast = [
    ['body', 'silver-text', 'graphite-base'],
    ['muted', 'silver-muted', 'graphite-panel'],
    ['primary', 'citron-ink', 'citron'],
    ['success', 'status-success', 'graphite-panel'],
    ['failure', 'status-failure', 'graphite-panel'],
    ['stale', 'status-stale', 'graphite-panel'],
    ['interrupted', 'status-interrupted', 'graphite-panel'],
  ].map(([name, fg, bg]) => {
    const a = lum(colors[fg]),
      b = lum(colors[bg])
    return { name, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
  })
  for (const pair of contrast) expect(pair.ratio, pair.name).toBeGreaterThanOrEqual(4.5)
  expect(external).toEqual([])
  expect(new Set(fontResponses.filter((path) => path.startsWith('/fonts/'))).size).toBe(5)
  await mkdir(resolve('artifacts/graphite'), { recursive: true })
  await writeFile(
    resolve(`artifacts/graphite/${variant}-font-and-contrast-proof.json`),
    JSON.stringify({ faces, fontProof, fontResponses, external, contrast }, null, 2),
  )
}
