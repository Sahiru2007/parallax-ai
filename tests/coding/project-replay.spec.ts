import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { command, git } from '../../runner/process.ts'
import { sourceSnapshot } from '../../runner/coding-files.ts'
import type { CodingSession } from '../../shared/coding.ts'
import type { ReplayScenario } from '../../shared/project-replay.ts'

const root = process.cwd()
async function freePort() {
  const s = createServer()
  s.listen(0, '127.0.0.1')
  await once(s, 'listening')
  const a = s.address()
  if (!a || typeof a === 'string') throw new Error('No port')
  await new Promise<void>((r) => s.close(() => r()))
  return a.port
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const ended = once(child, 'exit')
  if (process.platform === 'win32')
    await command(root, 'taskkill.exe', ['/PID', String(child.pid), '/T', '/F'])
  else process.kill(-child.pid!, 'SIGKILL')
  await ended
}
async function ready(url: string) {
  for (let i = 0; i < 400; i++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return
    await delay(50)
  }
  throw new Error(`Server not ready: ${url}`)
}
test.setTimeout(300_000)

test('configure a real dashboard investigation, reorder and compare, export, invalidate, and recover', async ({
  page,
}) => {
  const dir = resolve('artifacts/step3-acceptance', randomUUID())
  await mkdir(dir, { recursive: true })
  const seed = resolve('artifacts/step2-seed')
  if (
    !(await access(join(seed, '.git')).then(
      () => true,
      () => false,
    ))
  )
    await git(root, [
      'clone',
      '--depth',
      '1',
      '--',
      'https://github.com/jonschlinkert/is-number.git',
      seed,
    ])
  const repo = join(dir, 'operations dashboard repo')
  await git(root, ['clone', '--shared', '--', seed, repo])
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Northstar operations</title><style>body{font:20px system-ui;background:#edf1f4;color:#152838;margin:0}header{background:#132d43;color:white;padding:22px 40px;font-size:16px;letter-spacing:3px}main{margin:45px auto;max-width:780px}button{padding:12px 24px;border:1px solid #9bafbd;background:white;border-radius:6px;font-size:18px;margin-right:10px}h1{font-size:38px}ul{background:white;border:1px solid #ccd6de;padding:25px 45px;border-radius:10px;min-height:80px}li{padding:10px}#active-period{color:#267391;font-weight:bold}</style></head><body><header>NORTHSTAR / OPERATIONS</header><main><h1>Revenue dashboard</h1><p>Choose the reporting period. The active period must retain its metrics.</p><button data-period="week">Week</button><button data-period="month">Month</button><p>Active period: <span id="active-period">none</span></p><ul id="metric-list"></ul><p id="error"></p></main><script src="/dashboard.js"></script></body></html>`
  const baseline = `let activePeriod = 'none';
const list = document.querySelector('#metric-list');
function render(rows) { list.replaceChildren(...rows.map(text => { const li = document.createElement('li'); li.textContent = text; return li; })); }
function choose(period) {
  activePeriod = period;
  document.querySelector('#active-period').textContent = period;
  fetch('/metrics/snapshot?period=' + period).then(response => response.json()).then(data => { render(data.rows); }).catch(error => { if (error.name !== 'AbortError') document.querySelector('#error').textContent = error.message; });
}
document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => choose(button.dataset.period)));
`
  const guard = baseline
    .replace("let activePeriod = 'none';", "let activePeriod = 'none';\nlet generation = 0;")
    .replace(
      'function choose(period) {',
      'function choose(period) {\n  const ticket = ++generation;',
    )
    .replace('render(data.rows);', 'if (ticket === generation) render(data.rows);')
  const keyed = baseline
    .replace(
      "let activePeriod = 'none';",
      "let activePeriod = 'none';\nconst resultsByPeriod = new Map();",
    )
    .replace(
      'render(data.rows);',
      'resultsByPeriod.set(period, data.rows); render(resultsByPeriod.get(activePeriod) || []);',
    )
  const aborting = baseline
    .replace("let activePeriod = 'none';", "let activePeriod = 'none';\nlet controller;")
    .replace(
      'function choose(period) {',
      'function choose(period) {\n  controller?.abort(); controller = new AbortController();',
    )
    .replace(
      "fetch('/metrics/snapshot?period=' + period)",
      "fetch('/metrics/snapshot?period=' + period, { signal: controller.signal })",
    )
  const server = `const http=require('node:http'),fs=require('node:fs'); const path=require('node:path'); const port=Number(process.argv[2]);http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/health'){res.end('ready');return}if(url.pathname==='/metrics/snapshot'){const period=url.searchParams.get('period');setTimeout(()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({rows:period==='month'?['Monthly revenue $45,000','Monthly invoices 310']:['Weekly revenue $12,000','Weekly invoices 72']}))},period==='week'?500:10);return}const file=url.pathname==='/dashboard.js'?'dashboard.js':'dashboard.html';res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(path.join(__dirname,file)))}).listen(port,'127.0.0.1',()=>console.log('Dashboard listening on '+port));`
  await writeFile(join(repo, 'dashboard.html'), html)
  await writeFile(join(repo, 'dashboard.js'), baseline)
  await writeFile(join(repo, 'dashboard.cjs'), server)
  await writeFile(
    join(repo, 'AGENTS.md'),
    'Use the dashboard fixture. Keep the Week and Month action selectors, request URLs, and expected monthly metrics unchanged. Preserve the source checkout. Do not commit or push.\n',
  )
  const original = await sourceSnapshot(repo),
    originalIndex = await git(repo, ['diff', '--cached', '--binary'])
  const scenario: ReplayScenario = {
    name: 'Previous-period metrics overwrite the active month',
    app: {
      executable: 'node',
      args: ['dashboard.cjs', '{PORT}'],
      cwd: '.',
      origin: 'http://127.0.0.1:{PORT}',
      page: '/dashboard',
      readyPath: '/health',
      prepare: { executable: 'node', args: ['--check', 'dashboard.js'] },
    },
    actions: [
      {
        id: 'choose-week',
        label: 'Choose Week',
        kind: 'click',
        selector: '[data-period="week"]',
        waitForRequest: 'week',
      },
      {
        id: 'choose-month',
        label: 'Choose Month',
        kind: 'click',
        selector: '[data-period="month"]',
        waitForRequest: 'month',
      },
    ],
    requests: [
      {
        id: 'week',
        label: 'Weekly metrics',
        method: 'GET',
        url: '/metrics/snapshot?period=week',
        postData: null,
        status: 200,
        json: { rows: ['Weekly revenue $12,000', 'Weekly invoices 72'] },
      },
      {
        id: 'month',
        label: 'Monthly metrics',
        method: 'GET',
        url: '/metrics/snapshot?period=month',
        postData: null,
        status: 200,
        json: { rows: ['Monthly revenue $45,000', 'Monthly invoices 310'] },
      },
    ],
    order: ['month', 'week'],
    expected: {
      description: 'Active monthly metrics must survive every later response.',
      selector: '#metric-list li',
      texts: ['Monthly revenue $45,000', 'Monthly invoices 310'],
      afterRequest: 'month',
    },
    settleMs: 80,
    timeoutMs: 4000,
  }
  const recipe = (content: string, label: string) => ({
    calls: [
      { name: 'read_instructions', args: {} },
      { name: 'read_file', args: { path: 'dashboard.js' } },
      { name: 'inspect_replay', args: {} },
      { name: 'write_file', args: { path: 'dashboard.js', content } },
      { name: 'inspect_diff', args: {} },
      {
        name: 'run_command',
        args: { executable: 'node', args: ['--check', 'dashboard.js'], cwd: '.' },
      },
    ],
    message: `Scripted test provider: ${label}. Real browser replays determine behavior; no model was called.`,
  })
  const provider = join(dir, 'provider.json')
  await writeFile(
    provider,
    JSON.stringify({
      turns: [
        { calls: [], message: 'Investigation preparation only.' },
        {
          calls: [
            { name: 'read_file', args: { path: 'dashboard.cjs' } },
            {
              name: 'propose_replay',
              args: { scenario: JSON.stringify({ ...scenario, settleMs: 60 }) },
            },
          ],
          message:
            'Scripted test provider: proposed a scenario for review, without editing source.',
        },
        {
          calls: [],
          message: 'Compare fixtures',
          candidates: {
            a: recipe(guard, 'latest-generation guard'),
            b: recipe(keyed, 'results keyed by reporting period'),
          },
        },
      ],
    }),
  )
  const runnerPort = await freePort(),
    browserPort = await freePort(),
    runnerURL = `http://127.0.0.1:${runnerPort}`,
    base = `http://127.0.0.1:${browserPort}`
  let logs = ''
  const runner = spawn(process.execPath, ['--env-file-if-exists=.env', 'runner/server.ts'], {
    cwd: root,
    windowsHide: true,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      PARALLAX_RUNNER_PORT: String(runnerPort),
      PARALLAX_STATE_DIR: join(dir, 'sessions'),
      PARALLAX_BROWSER_ORIGINS: base,
      PARALLAX_ENABLE_TEST_PROVIDER: '1',
      PARALLAX_TEST_PROVIDER_FILE: provider,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const vite = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(browserPort),
      '--strictPort',
    ],
    {
      cwd: root,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, PARALLAX_RUNNER_URL: runnerURL },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  for (const child of [runner, vite]) {
    child.stdout!.on('data', (d) => {
      logs += String(d)
    })
    child.stderr!.on('data', (d) => {
      logs += String(d)
    })
  }
  const state = async (): Promise<CodingSession> => {
    const id = await page.evaluate(() => localStorage.getItem('parallax-coding-session'))
    return (await (await fetch(runnerURL + `/api/coding/sessions/${id}`)).json()) as CodingSession
  }
  async function finish() {
    for (let i = 0; i < 1500; i++) {
      const current = await state()
      if (!current.busy) {
        expect(current.status, current.error).toBe('ready')
        return current
      }
      if (current.approval) {
        await expect(page.getByRole('region', { name: 'Command approval' })).toHaveAttribute(
          'data-request-id',
          current.approval.id,
        )
        await expect(page.getByRole('region', { name: 'Command approval' })).toContainText(
          current.approval.cwd,
        )
        await page.getByRole('button', { name: 'Approve command', exact: true }).click()
      }
      await page.waitForTimeout(80)
    }
    throw new Error('Replay did not finish')
  }
  async function save(value: ReplayScenario) {
    const details = page.locator('.replay-editor')
    if (!(await details.evaluate((e) => (e as HTMLDetailsElement).open)))
      await details.locator('summary').click()
    await page
      .getByRole('textbox', { name: 'Replay scenario JSON' })
      .fill(JSON.stringify(value, null, 2))
    await page.getByRole('button', { name: 'Save scenario', exact: true }).click()
    await expect.poll(async () => (await state()).projectReplay?.saved?.scenario).toEqual(value)
  }
  async function replay(version: 'baseline' | 'all' | 'a' = 'baseline') {
    if (version !== 'all')
      await page
        .getByRole('tab', { name: version === 'baseline' ? /Baseline/ : /Candidate A/ })
        .first()
        .click()
    await page
      .getByRole('button', {
        name:
          version === 'all'
            ? 'Replay all'
            : version === 'baseline'
              ? 'Replay Baseline'
              : 'Replay Candidate A',
        exact: true,
      })
      .click()
    return finish()
  }
  const independent: Record<string, unknown> = {}
  try {
    await ready(runnerURL + '/api/health')
    await ready(base)
    await page.goto(base)
    await expect(page.getByText('Runner connected', { exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Local repository path' }).fill(repo)
    await page.getByRole('button', { name: 'Open repository', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Investigate browser behavior' }).check()
    const cfg = await (await fetch(runnerURL + '/api/coding/config')).json(),
      live = cfg.live.configured === true
    await page
      .getByRole('combobox', { name: 'Coding provider' })
      .selectOption(live ? 'live' : 'test')
    await page
      .getByRole('textbox', { name: 'Coding task', exact: true })
      .fill(
        'Investigate dashboard.js: clicking Week then Month lets the slow Week response overwrite active monthly metrics. Reproduce with a saved browser scenario, then compare a latest-generation guard and a results-by-period map. Keep the controls, endpoints, fixtures, and expected monthly metrics unchanged.',
      )
    await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Project browser replay' })).toBeVisible()
    await finish()
    await page.getByRole('button', { name: 'Ask agent for scenario', exact: true }).click()
    await finish()
    expect((await state()).candidates.every((candidate) => candidate.files.length === 0)).toBe(true)
    await page.getByRole('button', { name: 'Review agent proposal', exact: true }).click()
    expect(
      JSON.parse(await page.getByRole('textbox', { name: 'Replay scenario JSON' }).inputValue())
        .settleMs,
    ).toBe(60)
    await save(scenario)
    let current = await replay('baseline')
    expect(current.projectReplay!.runs.at(-1)?.status).toBe('failed')
    await expect(page.locator('.project-run-result')).toContainText('Product bug')
    await page.getByRole('button', { name: 'First unexpected state', exact: true }).click()
    await expect(
      page.getByRole('complementary', { name: 'Replay checkpoint inspector' }),
    ).toContainText('Weekly revenue $12,000')
    expect(
      await page
        .getByRole('button', { name: 'Inspect ui:week', exact: true })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    await page
      .getByTestId('project-response-month')
      .dragTo(page.getByTestId('project-response-week'))
    await expect(page.getByTestId('project-order')).toHaveText('week → month')
    await expect(page.locator('.project-run-result')).toContainText('Stale result')
    current = await replay('baseline')
    expect(current.projectReplay!.runs.at(-1)?.status).toBe('passed')
    // Keyboard-accessible reorder changes only delivery order, not actions or response fixtures.
    await page.getByRole('button', { name: 'Move response month earlier', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('project-order')).toHaveText('month → week')
    current = await replay('baseline')
    expect(current.projectReplay!.runs.at(-1)?.status).toBe('failed')
    await page.getByRole('button', { name: 'Generate two fixes', exact: true }).click()
    current = await finish()
    expect(current.candidates).toHaveLength(2)
    expect(current.candidates[0].patch).not.toBe(current.candidates[1].patch)
    if (!live) {
      expect(current.candidates[0].patch).toContain('generation')
      expect(current.candidates[1].patch).toContain('resultsByPeriod')
    }
    current = await replay('all')
    expect(current.projectReplay!.runs.slice(-3).map((r) => [r.version, r.status])).toEqual([
      ['baseline', 'failed'],
      ['a', 'passed'],
      ['b', 'passed'],
    ])
    await expect(page.getByLabel('Comparison conclusion')).toContainText('Tie')
    await page
      .getByRole('tab', { name: /Candidate A/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Inspect ui:week', exact: true }).click()
    const aligned = await page.getByTestId('shared-playhead').getAttribute('style')
    await expect(
      page.getByRole('complementary', { name: 'Replay checkpoint inspector' }),
    ).toContainText('Monthly revenue $45,000')
    await page
      .getByRole('tab', { name: /Candidate B/ })
      .first()
      .click()
    expect(
      await page
        .getByRole('button', { name: 'Inspect ui:week', exact: true })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(await page.getByTestId('shared-playhead').getAttribute('style')).toBe(aligned)
    const playhead = page.getByRole('slider', { name: 'Replay playhead' })
    await playhead.focus()
    const before = await playhead.inputValue()
    await page.keyboard.press('ArrowLeft')
    expect(await playhead.inputValue()).not.toBe(before)
    await page.getByRole('button', { name: 'Move response month later', exact: true }).click()
    current = await replay('all')
    expect(current.projectReplay!.runs.slice(-3).map((r) => [r.version, r.status])).toEqual([
      ['baseline', 'passed'],
      ['a', 'passed'],
      ['b', 'passed'],
    ])
    for (const run of current.projectReplay!.runs) {
      expect(run.scenarioDigest).toBe(current.projectReplay!.saved!.digest)
      expect(run.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(
        run.events.filter((e) => e.track === 'action' && e.key !== 'navigate').map((e) => e.label),
      ).toEqual(scenario.actions.map((a) => a.label))
    }
    await page.getByRole('button', { name: 'Move response month earlier', exact: true }).click()
    await replay('all')
    await page
      .getByRole('tab', { name: /Candidate A/ })
      .first()
      .click()
    const candidatePath = (await state()).candidates[0].worktree,
      verified = await readFile(join(candidatePath, 'dashboard.js'), 'utf8')
    await writeFile(join(candidatePath, 'dashboard.js'), verified + '\n// Post-verification edit\n')
    await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click()
    await expect(page.locator('.project-run-result')).toContainText('Stale result')
    await writeFile(join(candidatePath, 'dashboard.js'), verified)
    await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click()
    await expect(page.locator('.project-run-result')).toContainText('Scenario passed')
    await page.reload()
    await expect(page.getByRole('region', { name: 'Project browser replay' })).toBeVisible()
    await expect(page.getByTestId('project-order')).toHaveText('month → week')
    current = await state()
    await page
      .getByRole('tab', { name: /Candidate A/ })
      .first()
      .click()
    await page.locator('.project-relevant-diff summary').click()
    await expect(page.locator('.project-relevant-diff pre')).toContainText(
      live ? 'fetch' : 'generation',
    )
    const patchDownload = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Export chosen patch', exact: true }).click()
    const patchPath = join(dir, 'chosen.patch')
    await (await patchDownload).saveAs(patchPath)
    await git(current.projectReplay!.baselineWorktree!, ['apply', '--check', patchPath])
    const exported = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Export regression test', exact: true }).click()
    const exportedDir = join(dir, 'standalone')
    await mkdir(exportedDir, { recursive: true })
    const exportedPath = join(exportedDir, 'parallax-regression.spec.ts')
    await (await exported).saveAs(exportedPath)
    expect(await readFile(exportedPath, 'utf8')).not.toContain("from '../")
    for (const [name, cwd] of [
      ['baseline', current.projectReplay!.baselineWorktree!],
      ['chosen-fix', candidatePath],
    ]) {
      const port = await freePort(),
        app = spawn(process.execPath, ['dashboard.cjs', String(port)], {
          cwd,
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      app.stdout!.on('data', () => {})
      app.stderr!.on('data', () => {})
      try {
        await ready(`http://127.0.0.1:${port}/health`)
        await writeFile(
          join(exportedDir, 'playwright.config.mjs'),
          `process.env.PARALLAX_BASE_URL='http://127.0.0.1:${port}';export default {testDir:'.',outputDir:${JSON.stringify(join(exportedDir, `${name}-results`))},workers:1,reporter:'line'};`,
        )
        const result = await command(exportedDir, process.execPath, [
          resolve('node_modules/@playwright/test/cli.js'),
          'test',
          '--config',
          join(exportedDir, 'playwright.config.mjs'),
        ])
        independent[name] = result
        expect(result.exitCode, result.output).toBe(name === 'baseline' ? 1 : 0)
        expect(result.output).toContain(
          name === 'baseline' ? scenario.expected.description : '1 passed',
        )
      } finally {
        await stop(app)
      }
    }
    await page.screenshot({ path: join(dir, 'comparison-tie.png'), fullPage: true })
    // Coverage changes must not be presented as equivalent fixes.
    await writeFile(join(candidatePath, 'dashboard.js'), aborting)
    await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click()
    current = await replay('a')
    expect(current.projectReplay!.runs.at(-1)?.coverage.cancelled).toContain('week')
    await expect(page.locator('.replay-coverage')).toContainText('Coverage changed')
    await expect(page.getByLabel('Comparison conclusion')).toContainText('Coverage differs')
    await writeFile(join(candidatePath, 'dashboard.js'), verified)
    await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click()
    const bad = structuredClone(scenario)
    bad.requests[0].url = '/metrics/snapshot?period=missing-week'
    await save(bad)
    current = await replay('baseline')
    expect(current.projectReplay!.runs.at(-1)?.status).toBe('error')
    await expect(page.locator('.project-run-result')).toContainText(
      'Execution error — assertion not completed',
    )
    await expect(page.locator('.project-run-result')).toContainText('Unmatched HTTP request')
    await page.screenshot({ path: join(dir, 'execution-error.png'), fullPage: true })
    const cancellable = { ...structuredClone(scenario), settleMs: 1000 }
    await save(cancellable)
    await page.getByRole('button', { name: 'Replay Baseline', exact: true }).click()
    for (let i = 0; i < 200; i++) {
      const current = await state()
      if (current.projectReplay!.runs.at(-1)!.events.some((e) => e.key === 'action:choose-month'))
        break
      if (current.approval) {
        await expect(page.getByRole('region', { name: 'Command approval' })).toHaveAttribute(
          'data-request-id',
          current.approval.id,
        )
        await page.getByRole('button', { name: 'Approve command', exact: true }).click()
      }
      await page.waitForTimeout(50)
    }
    await expect
      .poll(async () =>
        (await state())
          .projectReplay!.runs.at(-1)!
          .events.some((e) => e.key === 'action:choose-month'),
      )
      .toBe(true)
    await page.getByRole('button', { name: 'Cancel replay', exact: true }).click()
    await expect.poll(async () => (await state()).busy).toBe(false)
    expect((await state()).projectReplay!.runs.at(-1)?.status).toBe('cancelled')
    await save(scenario)
    current = await replay('all')
    expect(current.projectReplay!.runs.slice(-3).map((r) => r.status)).toEqual([
      'failed',
      'passed',
      'passed',
    ])
    expect((await sourceSnapshot(repo)).digest).toBe(original.digest)
    expect(await git(repo, ['diff', '--cached', '--binary'])).toBe(originalIndex)
    await writeFile(
      join(dir, 'proof.json'),
      JSON.stringify(
        {
          provider: live ? 'live' : 'scripted test provider — no model',
          repo,
          baseline: current.baseline,
          session: current.id,
          scenario: current.projectReplay!.saved,
          runs: current.projectReplay!.runs,
          independentExports: independent,
          sourcePreserved: true,
          mouseAndKeyboard: true,
          alignedPlayhead: true,
        },
        null,
        2,
      ),
    )
    await writeFile(join(dir, 'scenario.json'), JSON.stringify(scenario, null, 2))
    await writeFile(
      resolve('artifacts/step3-latest.json'),
      JSON.stringify(
        {
          directory: dir,
          repo,
          session: current.id,
          stateDir: join(dir, 'sessions'),
          providerFile: provider,
          scenarioFile: join(dir, 'scenario.json'),
        },
        null,
        2,
      ),
    )
  } finally {
    await stop(runner)
    await stop(vite)
    await writeFile(join(dir, 'server.log'), logs)
  }
})
