import type { ProviderId, RecoveryInfo } from '../shared/providers.ts'
import { RecoveryRequired, type Continuation } from './continuation.ts'

export const retryBounds = { maxRetries: 2, maxWaitMs: 60000 }
function retryDelay(response: Response, details: Record<string, unknown>[]) {
  let retryAfterMs: number | undefined
  const header = response.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    const value =
      Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(header) - Date.now()
    if (Number.isFinite(value) && value >= 0) retryAfterMs = value
  }
  for (const detail of details) {
    if (
      String(detail['@type']).endsWith('/google.rpc.RetryInfo') &&
      typeof detail.retryDelay === 'string' &&
      /^\d+(\.\d+)?s$/.test(detail.retryDelay)
    ) {
      const value = parseFloat(detail.retryDelay) * 1000
      if (Number.isFinite(value)) retryAfterMs = Math.max(retryAfterMs ?? 0, value)
    }
  }
  return {
    retryAfterMs,
    retryAt: retryAfterMs === undefined ? undefined : Date.now() + retryAfterMs,
  }
}
export async function serviceUnavailableInfo(
  provider: ProviderId,
  response: Response,
): Promise<RecoveryInfo> {
  let details: Record<string, unknown>[] = []
  try {
    const payload = await response.json()
    if (Array.isArray(payload.error?.details)) details = payload.error.details
  } catch {
    /* Non-JSON errors can still provide Retry-After guidance. */
  }
  return {
    kind: 'unavailable',
    message: `${provider} is temporarily unavailable (HTTP 503). Retry preserves the same model, worktree and completed tools.`,
    ...retryDelay(response, details),
  }
}
export async function rateLimitInfo(
  provider: ProviderId,
  response: Response,
): Promise<RecoveryInfo> {
  let payload: { error?: Record<string, unknown> } = {}
  try {
    payload = await response.json()
  } catch {
    /* A header may still provide guidance. */
  }
  const error = payload.error ?? {},
    details = Array.isArray(error.details) ? (error.details as Record<string, unknown>[]) : []
  const codes = [error.code, error.type, error.status, ...details.map((d) => d.reason)]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase()
  const violations = details.flatMap((d) =>
    Array.isArray(d.violations) ? (d.violations as Record<string, unknown>[]) : [],
  )
  const metrics = violations
    .map((v) => `${v.quotaId ?? ''} ${v.quotaMetric ?? ''}`)
    .join(' ')
    .toLowerCase()
  const exhausted =
    /insufficient_quota|quota_exceeded|credit_balance_exhausted|spend_limit|usage_limit/.test(
      codes,
    ) ||
    /perday|per_day|permonth|per_month|daily|billing|spend/.test(metrics) ||
    violations.some((v) => v.quotaValue === 0 || v.quotaValue === '0')
  const guidance = retryDelay(response, details)
  const { retryAfterMs } = guidance
  const temporary =
    !exhausted &&
    (/rate_limit|too_many_requests|slow_down/.test(codes) ||
      /perminute|per_minute|persecond|per_second/.test(metrics) ||
      retryAfterMs !== undefined)
  return {
    kind: exhausted ? 'quota' : temporary ? 'rate-limit' : 'unknown-429',
    message: exhausted
      ? `${provider} quota, credits, or account limit is exhausted (HTTP 429). Check the provider account before resuming; no automatic retry.`
      : temporary
        ? `${provider} temporarily rate limited this request (HTTP 429).`
        : `${provider} returned HTTP 429 without enough information to distinguish a temporary rate limit from exhausted quota. Inspect provider usage before resuming.`,
    ...guidance,
  }
}
async function wait(ms: number, signal: AbortSignal) {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
export async function providerRequest(
  provider: ProviderId,
  send: (signal: AbortSignal) => Promise<Response>,
  signal: AbortSignal,
  c?: Continuation,
) {
  let retrying = false
  let lastInfo: RecoveryInfo | undefined
  while (true) {
    signal.throwIfAborted()
    if (retrying && c && c.state.retry.allowanceWaitMs >= retryBounds.maxWaitMs)
      throw new RecoveryRequired({
        ...lastInfo!,
        waiting: false,
        message: lastInfo!.message + ' The retry wait budget was reached; resume explicitly later.',
      })
    if (c) {
      c.state.requests++
      await c.save()
    }
    const start = Date.now()
    let response: Response
    try {
      const remaining = retryBounds.maxWaitMs - (c?.state.retry.allowanceWaitMs ?? 0)
      response = await send(
        retrying
          ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.floor(remaining)))])
          : signal,
      )
    } catch (error) {
      signal.throwIfAborted()
      if (retrying && lastInfo)
        throw new RecoveryRequired({
          ...lastInfo,
          waiting: false,
          message:
            lastInfo.message + ' The bounded retry waiting window ended; resume explicitly later.',
        })
      throw error
    } finally {
      if (retrying && c) {
        const elapsed = Date.now() - start
        c.state.retry.allowanceWaitMs += elapsed
        c.state.retry.totalWaitMs += elapsed
        await c.save()
      }
    }
    if (response.status !== 429 && response.status !== 503) {
      if (retrying && lastInfo && response.ok) {
        c?.onRecovery?.({
          ...lastInfo,
          waiting: false,
          retryAt: undefined,
          message: `${provider} recovered after a bounded retry. Continuing with the retained context and completed tools.`,
        })
        await c?.save()
      }
      return response
    }
    const reading = Date.now()
    const info =
      response.status === 503
        ? await serviceUnavailableInfo(provider, response)
        : await rateLimitInfo(provider, response)
    if (retrying && c) {
      const elapsed = Date.now() - reading
      c.state.retry.allowanceWaitMs += elapsed
      c.state.retry.totalWaitMs += elapsed
    }
    lastInfo = info
    if (!c) throw new RecoveryRequired(info)
    const retry = c.state.retry
    const delay = Math.max(
      info.retryAfterMs ?? 0,
      1000 * 2 ** retry.attempts + Math.floor(Math.random() * 200),
    )
    retry.notBefore = info.retryAt
    if (
      !['rate-limit', 'unavailable'].includes(info.kind) ||
      retry.attempts >= retryBounds.maxRetries ||
      retry.allowanceWaitMs + delay > retryBounds.maxWaitMs
    ) {
      const stopped = {
        ...info,
        message: !['rate-limit', 'unavailable'].includes(info.kind)
          ? info.message
          : info.message +
            (retry.attempts >= retryBounds.maxRetries
              ? ` Automatic retry limit (${retryBounds.maxRetries}) reached; resume explicitly later.`
              : ' The reported delay or remaining waiting budget exceeds the bounded retry window; resume explicitly later.'),
      }
      c.onRecovery?.({
        ...stopped,
        waiting: false,
        maxRetries: retryBounds.maxRetries,
        maxWaitMs: retryBounds.maxWaitMs,
      })
      await c.save()
      throw new RecoveryRequired({
        ...stopped,
        maxRetries: retryBounds.maxRetries,
        maxWaitMs: retryBounds.maxWaitMs,
      })
    }
    retry.attempts++
    retry.totalAttempts++
    const waiting: RecoveryInfo = {
      ...info,
      waiting: true,
      retryAt: Date.now() + delay,
      attempt: retry.attempts,
      ...retryBounds,
    }
    retry.notBefore = waiting.retryAt
    c.onRecovery?.(waiting)
    await c.save()
    const started = Date.now()
    try {
      await wait(delay, signal)
    } finally {
      const elapsed = Date.now() - started
      retry.allowanceWaitMs += elapsed
      retry.totalWaitMs += elapsed
      await c.save()
    }
    retry.notBefore = undefined
    c.onRecovery?.({ ...waiting, waiting: false })
    await c.save()
    retrying = true
  }
}
