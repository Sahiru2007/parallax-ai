import type { Page, Request, Route } from '@playwright/test'
import type { ReplayScenario, ReplayEvent, RequestCoverage } from '../shared/project-replay.ts'

/** Closure-free: this exact driver is embedded into the standalone export. */
export async function driveProjectReplay(
  page: Page,
  scenario: ReplayScenario,
  order: string[],
  baseURL: string,
  checkpoint: (event: ReplayEvent) => Promise<void> = async () => {},
) {
  const started = Date.now(),
    events: ReplayEvent[] = [],
    problems: string[] = []
  const coverage: RequestCoverage = {
    seen: [],
    cancelled: [],
    missing: [],
    unexpected: [],
    different: false,
  }
  const normalize = (value: string) => {
    const url = new URL(value, baseURL)
    url.searchParams.sort()
    return url.href
  }
  const port = new URL(baseURL).port
  const configured = scenario.requests.map((r) => ({ ...r, url: r.url.replaceAll('{PORT}', port) }))
  const matches = (request: Request) =>
    configured.filter(
      (r) =>
        r.method === request.method() &&
        normalize(r.url) === normalize(request.url()) &&
        (r.postData === null || r.postData === (request.postData() ?? '')),
    )
  const gates = new Map<string, { route: Route; release: () => void; deliver: boolean }>()
  const emit = async (event: Omit<ReplayEvent, 'atMs'>) => {
    const record = { ...event, atMs: Date.now() - started }
    events.push(record)
    await checkpoint(record)
  }
  const wait = async (check: () => boolean | Promise<boolean>, message: string) => {
    const deadline = Date.now() + scenario.timeoutMs
    while (!(await check())) {
      if (problems.length) throw new Error(problems[0])
      if (Date.now() > deadline) throw new Error(message)
      await page.waitForTimeout(20)
    }
    if (problems.length) throw new Error(problems[0])
  }
  const failed = (request: Request) => {
    for (const match of matches(request))
      if (/abort|cancel/i.test(request.failure()?.errorText ?? '')) {
        if (!coverage.cancelled.includes(match.id)) coverage.cancelled.push(match.id)
      }
  }
  const pageError = (error: Error) => {
    if (!/AbortError|aborted/i.test(error.message))
      problems.push(`Browser script error: ${error.message}`)
  }
  let finalTexts: string[] = [],
    executionError: string | undefined
  page.on('requestfailed', failed)
  page.on('pageerror', pageError)
  page.setDefaultTimeout(scenario.timeoutMs)
  try {
    await page.addInitScript(
      ({ requests, origin }) => {
        const state = window as unknown as { __parallaxReplay: { handled: string[] } }
        state.__parallaxReplay = { handled: [] }
        const normalize = (value: string) => {
          const url = new URL(value, origin)
          url.searchParams.sort()
          return url.href
        }
        const identify = (url: string, method: string, body: string | null) =>
          requests.find(
            (r) =>
              r.method === method &&
              normalize(r.url) === normalize(url) &&
              (r.postData === null || r.postData === body),
          )?.id
        const handled = (id: string | undefined) => {
          if (id)
            requestAnimationFrame(() =>
              requestAnimationFrame(() => state.__parallaxReplay.handled.push(id)),
            )
        }
        const originalFetch = window.fetch.bind(window)
        window.fetch = async (input, init) => {
          const method = (
            init?.method ?? (input instanceof Request ? input.method : 'GET')
          ).toUpperCase()
          const url = input instanceof Request ? input.url : String(input)
          const body =
            typeof init?.body === 'string'
              ? init.body
              : input instanceof Request
                ? await input.clone().text()
                : null
          const id = identify(url, method, body)
          const response = await originalFetch(input, init)
          const wrap = (target: Response): Response => {
            for (const name of ['json', 'text', 'arrayBuffer', 'blob', 'formData'] as const) {
              const original = target[name].bind(target)
              Object.defineProperty(target, name, {
                value: async () => {
                  const value = await original()
                  handled(id)
                  return value
                },
                configurable: true,
              })
            }
            const clone = target.clone.bind(target)
            Object.defineProperty(target, 'clone', {
              value: () => wrap(clone()),
              configurable: true,
            })
            return target
          }
          return wrap(response)
        }
        const open = XMLHttpRequest.prototype.open,
          send = XMLHttpRequest.prototype.send
        const info = new WeakMap<XMLHttpRequest, { method: string; url: string }>()
        XMLHttpRequest.prototype.open = function (
          method: string,
          url: string | URL,
          ...rest: unknown[]
        ) {
          info.set(this, { method: method.toUpperCase(), url: String(url) })
          return Reflect.apply(open, this, [method, url, ...rest])
        }
        XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
          const request = info.get(this)
          const id = request
            ? identify(request.url, request.method, typeof body === 'string' ? body : null)
            : undefined
          this.addEventListener(
            'loadend',
            () => {
              if (this.status > 0) handled(id)
            },
            { once: true },
          )
          return send.call(this, body)
        }
      },
      { requests: configured, origin: baseURL },
    )
    await page.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url())
      if (request.method() === 'OPTIONS') {
        const requestedMethod = request.headers()['access-control-request-method']
        if (
          configured.some(
            (fixture) =>
              normalize(fixture.url) === normalize(request.url()) &&
              (!requestedMethod || fixture.method === requestedMethod.toUpperCase()),
          )
        ) {
          await route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': new URL(baseURL).origin,
              'access-control-allow-credentials': 'true',
              'access-control-allow-methods': requestedMethod ?? 'GET,POST,PUT,PATCH,DELETE',
              'access-control-allow-headers':
                request.headers()['access-control-request-headers'] ?? 'content-type',
            },
          })
          return
        }
      }
      if (!['fetch', 'xhr'].includes(request.resourceType())) {
        if (url.origin === new URL(baseURL).origin) return route.continue()
        return route.abort('blockedbyclient')
      }
      const found = matches(request)
      if (found.length !== 1) {
        const detail = found.length ? 'Ambiguous request match' : 'Unmatched HTTP request'
        coverage.unexpected.push(`${request.method()} ${request.url()}`)
        problems.push(
          `${detail}: ${request.method()} ${request.url()}. Add or disambiguate a URL/method/postData fixture.`,
        )
        await route.abort()
        return
      }
      const fixture = found[0]
      if (gates.has(fixture.id)) {
        problems.push(
          `Ambiguous repeated match for ${fixture.id}: this fixture matched more than once. Use unique query parameters or exact postData for each request.`,
        )
        coverage.unexpected.push(`Duplicate ${fixture.id}`)
        await route.abort()
        return
      }
      coverage.seen.push(fixture.id)
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const gate = { route, release, deliver: false }
      gates.set(fixture.id, gate)
      await held
      try {
        if (!gate.deliver) {
          await route.abort()
          return
        }
        await route.fulfill({
          status: fixture.status,
          contentType: 'application/json',
          headers: {
            'access-control-allow-origin': new URL(baseURL).origin,
            'access-control-allow-credentials': 'true',
          },
          body: JSON.stringify(fixture.json),
        })
      } catch (error) {
        if (!coverage.cancelled.includes(fixture.id))
          problems.push(`Could not deliver ${fixture.id}: ${String(error)}`)
      }
    })
    await page.goto(new URL(scenario.app.page.replaceAll('{PORT}', port), baseURL).href, {
      waitUntil: 'domcontentloaded',
    })
    await emit({
      key: 'navigate',
      track: 'action',
      label: 'Open page',
      detail: scenario.app.page,
      texts: await page
        .locator(scenario.expected.selector)
        .filter({ visible: true })
        .allTextContents(),
    })
    for (const action of scenario.actions) {
      const locator = page.locator(action.selector)
      await locator.first().waitFor({ state: 'visible' })
      if ((await locator.count()) !== 1)
        throw new Error(
          `Action ${action.id}: selector must match exactly one element (${action.selector}).`,
        )
      if (action.kind === 'click') await locator.click()
      if (action.kind === 'fill') await locator.fill(action.value ?? '')
      if (action.kind === 'select') await locator.selectOption(action.value ?? '')
      if (action.waitForRequest)
        await wait(
          () => gates.has(action.waitForRequest!),
          `Missing request ${action.waitForRequest} after action ${action.id}. Check its URL, method/body, or changed request coverage.`,
        )
      await emit({
        key: `action:${action.id}`,
        track: 'action',
        label: action.label,
        requestId: action.waitForRequest,
        detail: `${action.kind} ${action.selector}${action.value !== undefined ? ` = ${action.value}` : ''}`,
        texts: await page
          .locator(scenario.expected.selector)
          .filter({ visible: true })
          .allTextContents(),
      })
    }
    await wait(
      () => configured.every((r) => gates.has(r.id)),
      'Missing controlled request. Ensure the fixed actions trigger every configured gate.',
    )
    let assertCheckpoints = false
    for (const id of order) {
      const gate = gates.get(id)
      if (!gate) throw new Error(`Missing release gate ${id}. The selected order cannot execute.`)
      const fixture = configured.find((r) => r.id === id)!
      const cancelled = coverage.cancelled.includes(id)
      await emit({
        key: `response:${id}`,
        track: 'response',
        label: cancelled ? `${fixture.label} cancelled` : `Deliver ${fixture.label}`,
        requestId: id,
        delivery: cancelled ? 'cancelled' : undefined,
        detail: `${fixture.method} ${fixture.url}`,
      })
      gate.deliver = !cancelled
      gate.release()
      if (!cancelled)
        await wait(
          async () =>
            coverage.cancelled.includes(id) ||
            (await page.evaluate(
              (requestId) =>
                (
                  window as unknown as { __parallaxReplay: { handled: string[] } }
                ).__parallaxReplay.handled.includes(requestId),
              id,
            )),
          `Response ${id} was released but consumption was not observed. Supported checkpoints require fetch body consumption or XHR loadend; streams/workers are outside this harness.`,
        )
      const released = events.find((event) => event.key === `response:${id}`)!
      released.delivery = coverage.cancelled.includes(id) ? 'cancelled' : 'delivered'
      if (released.delivery === 'cancelled') released.label = `${fixture.label} cancelled`
      // An observed body-consumption barrier, two paint frames, and the configured settle
      // interval precede this real DOM read. This is an observation, not inferred model state.
      await page.waitForTimeout(scenario.settleMs)
      if (id === scenario.expected.afterRequest && !coverage.cancelled.includes(id))
        assertCheckpoints = true
      const texts = await page
        .locator(scenario.expected.selector)
        .filter({ visible: true })
        .allTextContents()
      const unexpected =
        assertCheckpoints && JSON.stringify(texts) !== JSON.stringify(scenario.expected.texts)
      await emit({
        key: `ui:${id}`,
        track: 'ui',
        label: unexpected
          ? 'Unexpected UI state'
          : assertCheckpoints
            ? 'Expected UI state'
            : 'Observed UI state',
        requestId: id,
        texts,
        checked: assertCheckpoints,
        unexpected,
        delivery: coverage.cancelled.includes(id) ? 'cancelled' : 'delivered',
      })
    }
    finalTexts = await page
      .locator(scenario.expected.selector)
      .filter({ visible: true })
      .allTextContents()
    await emit({
      key: 'final',
      track: 'ui',
      label:
        JSON.stringify(finalTexts) === JSON.stringify(scenario.expected.texts)
          ? 'Final assertion passed'
          : 'Final assertion failed',
      texts: finalTexts,
      checked: true,
      unexpected: JSON.stringify(finalTexts) !== JSON.stringify(scenario.expected.texts),
    })
    if (problems.length) throw new Error(problems[0])
  } catch (error) {
    executionError = error instanceof Error ? error.message : String(error)
  } finally {
    page.removeListener('requestfailed', failed)
    page.removeListener('pageerror', pageError)
    for (const gate of gates.values()) gate.release()
    coverage.missing = configured.filter((r) => !coverage.seen.includes(r.id)).map((r) => r.id)
    coverage.different = Boolean(
      coverage.missing.length || coverage.cancelled.length || coverage.unexpected.length,
    )
  }
  return {
    events,
    coverage,
    finalTexts,
    executionError,
    firstUnexpected: events.find((e) => e.unexpected)?.key,
    passed: !executionError && !events.some((e) => e.unexpected),
    durationMs: Date.now() - started,
  }
}
