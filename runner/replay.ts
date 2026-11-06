import { chromium, expect, type Page, type Route } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { EXPECTED_ITEMS, parseSchedule, queryToId, scenario } from '../shared/scenario.ts'
import type {
  ReplayResult,
  RequestId,
  Schedule,
  TraceEvent,
  VersionId,
} from '../shared/investigation.ts'

export async function fixtureServer(
  worktree: string,
): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    configFile: false,
    root: join(worktree, 'fixtures/pickup-search'),
    plugins: [react()],
    cacheDir: join(dirname(worktree), '.vite-pickup-' + randomUUID().slice(0, 8)),
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [worktree] },
      watch: { ignored: ['**/node_modules/**'] },
    },
    logLevel: 'error',
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string')
    throw new Error('Fixture server did not bind to a local port.')
  return { server, url: `http://127.0.0.1:${address.port}` }
}

/** Instrument response handling outside candidate code. The recorded state is read from the DOM. */
export async function instrument(page: Page) {
  await page.addInitScript(() => {
    const tracked = window as unknown as { __parallaxHandled: string[] }
    tracked.__parallaxHandled = []
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      const query = new URL(response.url).searchParams.get('q')
      const originalJson = response.json.bind(response)
      response.json = async () => {
        const payload: unknown = await originalJson()
        // The promise continuation runs before the animation frames; React commits its UI.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (query) tracked.__parallaxHandled.push(query)
          }),
        )
        return payload
      }
      return response
    }
  })
}

export async function replay(options: {
  version: VersionId
  order: Schedule
  url: string
  artifactDir: string
  publicPrefix: string
  signal: AbortSignal
  onEvent?: (event: TraceEvent) => void
}): Promise<ReplayResult> {
  const order = parseSchedule(options.order)
  const started = performance.now()
  const id = randomUUID()
  const events: TraceEvent[] = []
  const output: string[] = [
    `Playwright Chromium | ${options.version} | release ${order.join(' → ')}`,
    'User actions: fill("Col"), fill("Colombo"). Payloads and final assertion are fixed.',
  ]
  const result: ReplayResult = {
    id,
    version: options.version,
    schedule: order,
    status: 'error',
    events,
    finalItems: [],
    expectedItems: EXPECTED_ITEMS,
    durationMs: 0,
    output: '',
    command: `Playwright Chromium API: replay(${options.version}, [${order.join(',')}])`,
  }
  options.signal.throwIfAborted()
  const browser = await chromium.launch({ headless: true })
  const cancel = () => {
    void browser.close().catch(() => {})
  }
  options.signal.addEventListener('abort', cancel, { once: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 610 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    })
    const runtimeErrors: string[] = []
    page.on('pageerror', (error) => runtimeErrors.push(error.message))
    await instrument(page)
    const gates = new Map<RequestId, { route: Route; release: () => void }>()
    let scheduleError: string | undefined
    const allowedOrigin = new URL(options.url).origin
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== allowedOrigin) return route.abort('blockedbyclient')
      if (url.pathname !== '/api/places') return route.continue()
      let requestId: RequestId
      try {
        requestId = queryToId(url.searchParams.get('q') ?? '')
      } catch (error) {
        scheduleError = String(error)
        await route.abort()
        return
      }
      if (gates.has(requestId)) {
        scheduleError = `Duplicate request ${requestId}; schedule cannot be executed.`
        await route.abort()
        return
      }
      await new Promise<void>((release) => gates.set(requestId, { route, release }))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [...scenario[requestId].items] }),
      })
    })
    const emit = (event: Omit<TraceEvent, 'atMs'> & { atMs?: number }) => {
      const record = { ...event, atMs: event.atMs ?? Math.round(performance.now() - started) }
      events.push(record)
      options.onEvent?.(record)
    }
    const capture = async (name: string) => {
      await mkdir(options.artifactDir, { recursive: true })
      await page.screenshot({
        path: join(options.artifactDir, `${id}-${name}.png`),
        animations: 'disabled',
      })
      return `${options.publicPrefix}/${id}-${name}.png`
    }
    await page.goto(options.url)
    for (const requestId of ['A', 'B'] as const) {
      await page.getByRole('textbox', { name: 'Pickup address' }).fill(scenario[requestId].query)
      await expect
        .poll(() => gates.has(requestId), {
          timeout: 5000,
          message: `Request ${requestId} was not intercepted; schedule cannot be executed.`,
        })
        .toBe(true)
      output.push(
        `Intercepted request ${requestId}: GET /api/places?q=${scenario[requestId].query}`,
      )
      emit({
        id: `action-${requestId}`,
        atMs: Math.round(performance.now() - started),
        kind: 'action',
        requestId,
        query: scenario[requestId].query,
        label: `Type “${scenario[requestId].query}”`,
        screenshot: await capture(`action-${requestId}`),
      })
    }
    let previous: string[] = []
    for (const requestId of order) {
      options.signal.throwIfAborted()
      const gate = gates.get(requestId)
      if (!gate)
        throw new Error(`Missing gate ${requestId}; requested schedule cannot be executed.`)
      emit({
        id: `response-${requestId}`,
        kind: 'response',
        requestId,
        query: scenario[requestId].query,
        label: `Response ${requestId} · ${scenario[requestId].query}`,
        payload: [...scenario[requestId].items],
      })
      gate.release()
      await page.waitForFunction(
        (query) =>
          (window as unknown as { __parallaxHandled: string[] }).__parallaxHandled.includes(query),
        scenario[requestId].query,
        { timeout: 5000 },
      )
      const items = await page.getByTestId('place-name').allTextContents()
      const changed = JSON.stringify(items) !== JSON.stringify(previous)
      const currentQuery = await page.getByRole('textbox', { name: 'Pickup address' }).inputValue()
      output.push(
        `Handled ${requestId}; active query=${currentQuery}; observed DOM=${JSON.stringify(items)}`,
      )
      emit({
        id: `state-${requestId}`,
        atMs: Math.round(performance.now() - started),
        kind: 'state',
        requestId,
        query: currentQuery,
        label: changed
          ? `Render ${requestId === 'A' ? 'Col' : 'Colombo'} suggestions`
          : 'Visible suggestions unchanged',
        items,
        changed,
        causedBy: `response-${requestId}`,
        screenshot: await capture(`state-${requestId}`),
      })
      previous = items
    }
    result.finalItems = await page.getByTestId('place-name').allTextContents()
    if (scheduleError || runtimeErrors.length)
      throw new Error(scheduleError ?? runtimeErrors.join('\n'))
    try {
      await expect(
        page.getByTestId('place-name'),
        'After BOTH deliveries, suggestions must match the ACTIVE query Colombo.',
      ).toHaveText(EXPECTED_ITEMS, { timeout: 750 })
      result.status = 'passed'
      output.push(
        'PASS: final suggestions match the active query after both responses were handled.',
      )
    } catch (error) {
      result.status = 'failed'
      result.error = error instanceof Error ? error.message : String(error)
      output.push(`FAIL: ${result.error}`)
    }
  } catch (error) {
    options.signal.throwIfAborted()
    result.status = 'error'
    result.error = `Schedule could not be executed: ${error instanceof Error ? error.message : String(error)}`
    output.push(result.error)
  } finally {
    options.signal.removeEventListener('abort', cancel)
    await browser.close()
  }
  result.durationMs = Math.round(performance.now() - started)
  result.output = output.join('\n')
  return result
}
