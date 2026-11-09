import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { InvestigationEngine } from './engine.ts'
import { git } from './process.ts'
import { providerState } from './provider.ts'
import { regressionSource } from './regression.ts'
import { parseSchedule } from '../shared/scenario.ts'
import type { Investigation } from '../shared/investigation.ts'
import { CodingEngine } from './coding-engine.ts'
import { inspectRepo } from './coding-files.ts'
import { testProviderConfigured } from './coding-provider.ts'
import { exportedProjectTest } from './project-replay-engine.ts'
import { ProviderSettingsStore } from './provider-settings.ts'
import { WindowsCredentialStore } from './credentials.ts'
import { redactSecrets } from './provider-secrets.ts'
import type { ModelSelection } from '../shared/providers.ts'
import { replaySuggestions } from './replay-suggestions.ts'
import { desktopAsset } from './desktop-http.ts'

const root = resolve(
  process.env.PARALLAX_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'),
)
const token = randomBytes(32).toString('hex')
const engine = new InvestigationEngine(root)
await engine.restore()
const stateDir = resolve(
  process.env.PARALLAX_STATE_DIR ?? resolve(homedir(), '.parallax/coding-sessions'),
)
const testTarget =
  process.env.PARALLAX_ENABLE_TEST_PROVIDER === '1' &&
  /^PARALLAX AI\/Test\/[a-f0-9-]+$/.test(process.env.PARALLAX_CREDENTIAL_TARGET ?? '')
    ? process.env.PARALLAX_CREDENTIAL_TARGET
    : undefined
const providers = new ProviderSettingsStore(
  join(stateDir, 'providers.json'),
  new WindowsCredentialStore(testTarget),
  new WindowsCredentialStore(testTarget ? testTarget + '/Gemini' : 'PARALLAX AI/Gemini'),
)
await providers.restore()
const coding = new CodingEngine(stateDir, providers)
await coding.restore()
const port = Number(process.env.PARALLAX_RUNNER_PORT ?? 4317)
const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(redactSecrets(JSON.stringify(value)))
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let value = ''
  for await (const chunk of request) {
    value += String(chunk)
    if (value.length > 64_000) throw new Error('Request exceeds 64 KB.')
  }
  return JSON.parse(value || '{}') as Record<string, unknown>
}
const server = createServer(async (request, response) => {
  try {
    if (
      process.env.PARALLAX_DESKTOP_SECRET &&
      request.headers['x-parallax-desktop'] !== process.env.PARALLAX_DESKTOP_SECRET
    )
      return json(response, 403, { error: 'Native application connection required.' })
    const host = request.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
      return json(response, 403, { error: 'Local runner only.' })
    const origin = request.headers.origin
    const extraOrigins = (process.env.PARALLAX_BROWSER_ORIGINS ?? '').split(',').filter(Boolean)
    if (
      origin &&
      !/^http:\/\/(127\.0\.0\.1|localhost):(1420|1421|4317)$/.test(origin) &&
      !extraOrigins.includes(origin)
    )
      return json(response, 403, { error: 'Foreign origins cannot access this local runner.' })
    const url = new URL(request.url ?? '/', `http://${host}`)
    if (
      request.method === 'GET' &&
      !url.pathname.startsWith('/api/') &&
      process.env.PARALLAX_DESKTOP_STATIC_DIR
    )
      return await desktopAsset(process.env.PARALLAX_DESKTOP_STATIC_DIR, url.pathname, response)
    if (
      request.method === 'POST' &&
      url.pathname === '/api/desktop/shutdown' &&
      process.env.PARALLAX_DESKTOP_SECRET
    ) {
      json(response, 200, { stopping: true })
      void shutdown()
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/config')
      return json(response, 200, {
        token,
        repo: {
          id: 'current',
          name: 'parallax-ai / pickup-search',
          path: root,
          revision: await git(root, ['rev-parse', 'HEAD']),
          dirty: Boolean(await git(root, ['status', '--porcelain'])),
        },
        live: providerState(),
      })
    if (request.method === 'GET' && url.pathname === '/api/health')
      return json(response, 200, { ready: true })
    if (request.method !== 'GET' && request.headers['x-parallax-token'] !== token)
      return json(response, 403, { error: 'Missing local runner token.' })
    if (request.method === 'GET' && url.pathname === '/api/coding/config')
      return json(response, 200, {
        token,
        live: providerState(),
        testProvider: testProviderConfigured(),
        providers: providers.snapshot(),
        defaultRepo: await inspectRepo(root).catch(() => null),
      })
    if (request.method === 'POST' && url.pathname === '/api/providers')
      return json(response, 200, await providers.handle(await body(request)))
    if (request.method === 'POST' && url.pathname === '/api/coding/repos') {
      const data = await body(request)
      if (typeof data.path !== 'string' || !data.path.trim())
        throw new Error('Enter an existing local Git checkout path.')
      return json(response, 200, await inspectRepo(data.path))
    }
    if (request.method === 'GET' && url.pathname === '/api/coding/sessions')
      return json(response, 200, coding.list())
    if (request.method === 'POST' && url.pathname === '/api/coding/sessions') {
      if (engine.active()) throw new Error('Wait for the active pickup investigation to stop.')
      const data = await body(request)
      if (
        typeof data.path !== 'string' ||
        typeof data.task !== 'string' ||
        !data.task.trim() ||
        data.task.length > 8000
      )
        throw new Error('Provide a repository path and a task under 8000 characters.')
      if (data.provider !== 'live' && data.provider !== 'test')
        throw new Error('Choose live or test provider.')
      let selection: ModelSelection | undefined
      if (data.provider === 'live') {
        const chosen = data.modelSelection as ModelSelection | undefined
        selection =
          chosen &&
          (chosen.provider === 'gemini' ||
            chosen.provider === 'openai' ||
            chosen.provider === 'ollama')
            ? providers.selectionFrom(chosen.provider, chosen.model)
            : (providers.state.selection ?? undefined)
        if (!selection && data.investigate !== true)
          throw new Error(
            'Connect a provider and choose a model in Manage providers. No demo fallback is used.',
          )
        if (selection && data.investigate !== true) providers.assertReady(selection)
      }
      if (data.provider === 'test' && !testProviderConfigured())
        throw new Error('The scripted test provider is not enabled.')
      return json(
        response,
        201,
        await coding.start(
          data.path,
          data.task.trim(),
          data.provider,
          data.compare === true,
          data.investigate === true,
          selection,
          data.sequential === true,
        ),
      )
    }
    const codingMatch = /^\/api\/coding\/sessions\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(url.pathname)
    if (codingMatch) {
      const [, id, action] = codingMatch
      const state = coding.state(id)
      const checkOutput = /^checks\/([a-f0-9-]{36})\/output$/.exec(action ?? '')
      if (request.method === 'GET' && checkOutput) {
        const file = await coding.checkOutputFile(id, checkOutput[1])
        response.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="check-${checkOutput[1]}.log"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        createReadStream(file)
          .on('error', () => response.destroy())
          .pipe(response)
        return
      }
      if (request.method === 'GET' && action === 'replay/suggestions')
        return json(response, 200, {
          baseline: state.baseline.digest,
          suggestions: replaySuggestions(coding.sessions.get(id)!.baseline),
        })
      if (request.method === 'POST' && action === 'replay/scenario') {
        const data = await body(request)
        if (
          'baseDigest' in data &&
          data.baseDigest !== (state.projectReplay?.saved?.digest ?? null)
        )
          throw new Error(
            'The saved scenario changed in another view. Your draft is retained; review the latest revision before saving.',
          )
        return json(response, 200, await coding.saveReplay(id, data.scenario))
      }
      if (request.method === 'POST' && action === 'replay/run') {
        if (engine.active()) throw new Error('Wait for the active pickup investigation to stop.')
        const data = await body(request)
        if (typeof data.version !== 'string') throw new Error('Select a replay version or all.')
        return json(response, 202, await coding.replay(id, data.order, data.version))
      }
      if (request.method === 'POST' && action === 'replay/fixes') {
        if (state.provider === 'live' && !state.modelSelection && providers.state.selection)
          state.modelSelection = structuredClone(providers.state.selection)
        if (state.provider === 'live' && !state.modelSelection && !providerState().configured)
          throw new Error(
            'Configure the live provider before generating fixes. Baseline replay remains available without a key.',
          )
        const data = await body(request)
        return json(response, 202, await coding.generateReplayFixes(id, data.sequential === true))
      }
      if (request.method === 'POST' && action === 'replay/propose') {
        if (state.provider === 'live' && !state.modelSelection && providers.state.selection)
          state.modelSelection = structuredClone(providers.state.selection)
        if (state.provider === 'live' && !state.modelSelection && !providerState().configured)
          throw new Error(
            'Configure a provider to propose a scenario. You can configure and run one manually without a key.',
          )
        return json(response, 202, await coding.proposeReplay(id))
      }
      if (request.method === 'GET' && action === 'replay/export') {
        const saved = state.projectReplay?.saved
        if (!saved) throw new Error('Save a scenario before exporting a regression.')
        const order = url.searchParams.get('order')?.split(',') ?? state.projectReplay!.order
        const source = exportedProjectTest(saved, order)
        response.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="parallax-regression.spec.ts"',
          'Cache-Control': 'no-store',
        })
        response.end(source)
        return
      }
      if (
        request.method === 'GET' &&
        /^replay\/frames\/[a-f0-9-]{36}-\d+\.png$/.test(action ?? '')
      ) {
        const runtime = coding.sessions.get(id)!
        const png = await readFile(join(runtime.dir, 'replay-frames', action!.split('/')[2]))
        response.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        })
        response.end(png)
        return
      }
      if (request.method === 'GET' && !action) return json(response, 200, state)
      if (request.method === 'GET' && action === 'events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
        const send = (value: unknown) =>
          response.write(`event: state\ndata: ${redactSecrets(JSON.stringify(value))}\n\n`)
        send(state)
        coding.updates.on(id, send)
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 10_000)
        request.on('close', () => {
          clearInterval(heartbeat)
          coding.updates.off(id, send)
        })
        return
      }
      if (request.method === 'POST' && action === 'followup') {
        if (engine.active()) throw new Error('Wait for the active pickup investigation to stop.')
        const data = await body(request)
        if (typeof data.message !== 'string' || !data.message.trim() || data.message.length > 8000)
          throw new Error('Enter a follow-up under 8000 characters.')
        if (state.provider === 'live' && !state.modelSelection && providers.state.selection)
          state.modelSelection = structuredClone(providers.state.selection)
        await coding.followup(id, data.message.trim())
        return json(response, 202, coding.state(id))
      }
      if (
        request.method === 'POST' &&
        ['resume', 'resolve-tool', 'generate-next'].includes(action ?? '')
      ) {
        if (engine.active()) throw new Error('Wait for the active pickup investigation to stop.')
        const data = await body(request)
        if (action === 'generate-next') {
          if (data.candidate !== 'a' && data.candidate !== 'b')
            throw new Error('Select the queued candidate.')
          return json(response, 202, await coding.generateNext(id, data.candidate))
        }
        if (typeof data.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.runId))
          throw new Error('Select the interrupted AI turn.')
        if (action === 'resume') {
          if (data.additional !== undefined && typeof data.additional !== 'number')
            throw new Error('Additional rounds must be a number.')
          return json(
            response,
            202,
            await coding.resume(id, data.runId, data.additional as number | undefined),
          )
        }
        if (
          typeof data.callId !== 'string' ||
          (data.decision !== 'skip' && data.decision !== 'rerun')
        )
          throw new Error('Choose an inspected tool and recovery action.')
        return json(
          response,
          200,
          await coding.resolveTool(id, data.runId, data.callId, data.decision),
        )
      }
      if (request.method === 'POST' && action === 'approve') {
        const data = await body(request)
        if (typeof data.requestId !== 'string' || typeof data.approved !== 'boolean')
          throw new Error('Choose approve or deny for this exact command.')
        coding.approve(id, data.requestId, data.approved)
        await coding.checkpoint(id)
        return json(response, 202, coding.state(id))
      }
      if (request.method === 'POST' && action === 'cancel') {
        coding.cancel(id)
        await coding.checkpoint(id)
        return json(response, 202, coding.state(id))
      }
      if (request.method === 'POST' && action === 'review')
        return json(response, 200, await coding.review(id))
      if (request.method === 'POST' && action === 'apply') {
        const data = await body(request)
        if (typeof data.candidate !== 'string' || typeof data.target !== 'string')
          throw new Error('Select the candidate and target checkout.')
        return json(response, 200, await coding.apply(id, data.candidate, data.target))
      }
      const patch = /^patch\/(a|b)$/.exec(action ?? '')
      if (request.method === 'GET' && patch) {
        if (state.busy) throw new Error('Wait for the active turn before exporting its patch.')
        await coding.review(id)
        const candidate = state.candidates.find((c) => c.id === patch[1])
        if (!candidate?.patch) throw new Error('No patch available.')
        response.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="implementation-${candidate.id}.patch"`,
          'Cache-Control': 'no-store',
        })
        response.end(candidate.patch)
        return
      }
      return json(response, 404, { error: 'Coding session action not found.' })
    }
    if (request.method === 'POST' && url.pathname === '/api/sessions') {
      if (coding.active()) throw new Error('Wait for the active coding session to stop.')
      const data = await body(request)
      if (data.repo !== 'current') throw new Error('Choose the registered current repository.')
      if (typeof data.task !== 'string' || !data.task.trim() || data.task.length > 8000)
        throw new Error('Provide a task between 1 and 8000 characters.')
      if (data.mode !== 'sample' && data.mode !== 'live')
        throw new Error('Choose sample or live mode.')
      if (data.mode === 'live' && !providerState().configured)
        return json(response, 409, {
          error:
            'Live mode is not configured. Set OPENAI_API_KEY and PARALLAX_MODEL in the runner environment. Credentials never enter the browser.',
        })
      const state = engine.start(data.task.trim(), data.mode)
      await engine.checkpoint(state.id)
      return json(response, 201, state)
    }
    const match = /^\/api\/sessions\/([a-f0-9-]+)(?:\/(.*))?$/.exec(url.pathname)
    if (!match) return json(response, 404, { error: 'Route not found.' })
    const [, id, action] = match
    const state = engine.state(id)
    if (request.method === 'GET' && !action) return json(response, 200, state)
    if (request.method === 'GET' && action === 'events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const send = (data: Investigation) =>
        response.write(`event: state\ndata: ${JSON.stringify(data)}\n\n`)
      send(state)
      engine.updates.on(id, send)
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000)
      request.on('close', () => {
        clearInterval(heartbeat)
        engine.updates.off(id, send)
      })
      return
    }
    if (request.method === 'POST' && action === 'cancel') {
      engine.cancel(id)
      await engine.checkpoint(id)
      return json(response, 202, engine.state(id))
    }
    if (request.method === 'POST' && action === 'retry') {
      const state = engine.retry(id)
      await engine.checkpoint(state.id)
      return json(response, 201, state)
    }
    if (request.method === 'POST' && action === 'cleanup') {
      await engine.cleanup(id)
      return json(response, 200, engine.state(id))
    }
    if (request.method === 'POST' && action === 'replay') {
      const data = await body(request)
      engine.rerun(id, data.order)
      await engine.checkpoint(id)
      return json(response, 202, engine.state(id))
    }
    if (request.method === 'POST' && action === 'steer') {
      const data = await body(request)
      if (typeof data.message !== 'string' || !data.message.trim() || data.message.length > 4000)
        throw new Error('Provide a steering note between 1 and 4000 characters.')
      engine.steer(id, data.message.trim())
      return json(response, 200, engine.state(id))
    }
    if (request.method === 'GET' && action === 'regression') {
      const order = parseSchedule(
        url.searchParams.get('order')?.split(',') ?? state.selectedSchedule,
      )
      const source = regressionSource(order)
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="pickup-regression.spec.ts"',
        'Cache-Control': 'no-store',
      })
      response.end(source)
      return
    }
    if (request.method === 'GET' && /^patch\/(a|b)$/.test(action ?? '')) {
      const candidate = state.candidates.find((item) => item.id === action!.split('/')[1])
      if (!candidate?.patch) throw new Error('No actual patch is available yet.')
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="candidate-${candidate.id}.patch"`,
        'Cache-Control': 'no-store',
      })
      response.end(candidate.patch)
      return
    }
    if (
      request.method === 'GET' &&
      /^frames\/[a-f0-9-]+-(action|state)-[AB]\.png$/.test(action ?? '')
    ) {
      const name = action!.split('/')[1]
      const png = await readFile(join(engine.getArtifactDir(id), 'frames', name))
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(png)
      return
    }
    json(response, 404, { error: 'Route not found.' })
  } catch (error) {
    if (!response.headersSent)
      json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    else response.end()
  }
})
server.listen(port, '127.0.0.1', () => {
  const bound = server.address()
  if (process.env.PARALLAX_DESKTOP_READY && bound && typeof bound !== 'string')
    void writeFile(
      process.env.PARALLAX_DESKTOP_READY,
      JSON.stringify({ port: bound.port, pid: process.pid }),
    )
  console.log(
    `PARALLAX local runner · http://127.0.0.1:${bound && typeof bound !== 'string' ? bound.port : port} · provider settings ready · pickup OpenAI environment ${providerState().configured ? 'configured' : 'not configured'}`,
  )
})
server.on('error', (error) => {
  console.error(`Runner could not start: ${error.message}`)
  process.exitCode = 1
})
async function shutdown() {
  await coding.close()
  await engine.close()
  server.close()
  process.exit(0)
}
process.once('SIGINT', () => {
  void shutdown()
})
process.once('SIGTERM', () => {
  void shutdown()
})
