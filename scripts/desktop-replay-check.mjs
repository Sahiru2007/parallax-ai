import { expect } from '@playwright/test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  scenarioView,
  replayTools,
  closeCompactDetails,
} from '../tests/coding/scenario-editor-helpers.ts'

export async function checkInstalledReplay({ page, state, finish, data, artifact, provider, exe }) {
  const repo = join(data, 'dashboard repo with spaces')
  await mkdir(repo, { recursive: true })
  const source = `let activePeriod = 'none';
const list = document.querySelector('#metric-list');
function render(rows) { list.replaceChildren(...rows.map(text => { const li = document.createElement('li'); li.textContent = text; return li; })); }
function choose(period) {
  activePeriod = period;
  document.querySelector('#active-period').textContent = period;
  fetch('/metrics/snapshot?period=' + period).then(response => response.json()).then(data => { render(data.rows); });
}
document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => choose(button.dataset.period)));
`
  const guard = source
    .replace("let activePeriod = 'none';", "let activePeriod = 'none';\nlet generation = 0;")
    .replace('function choose(period) {', 'function choose(period) {\nconst ticket = ++generation;')
    .replace('render(data.rows);', 'if (ticket === generation) render(data.rows);')
  const keyed = source
    .replace(
      "let activePeriod = 'none';",
      "let activePeriod = 'none';\nconst resultsByPeriod = new Map();",
    )
    .replace(
      'render(data.rows);',
      'resultsByPeriod.set(period, data.rows); render(resultsByPeriod.get(activePeriod) || []);',
    )
  await writeFile(join(repo, 'dashboard.js'), source)
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'desktop-dashboard-verification', private: true, type: 'module' }),
  )
  await writeFile(
    join(repo, 'dashboard.html'),
    '<!doctype html><html><head><title>Desktop revenue dashboard</title><style>body{font:20px system-ui;padding:32px;background:#edf1f4;color:#152838}button{padding:10px 18px;margin-right:12px}li{padding:12px}</style></head><body><h1>Revenue dashboard</h1><button data-period="week">Week</button><button data-period="month">Month</button><p>Active period: <strong id="active-period">none</strong></p><ul id="metric-list"></ul><script src="/dashboard.js"></script></body></html>',
  )
  await writeFile(
    join(repo, 'dashboard.cjs'),
    "const http=require('node:http'),fs=require('node:fs'),path=require('node:path');http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return}if(req.url.startsWith('/metrics/')){res.setHeader('content-type','application/json');res.end(JSON.stringify({rows:[]}));return}const file=req.url==='/dashboard.js'?'dashboard.js':'dashboard.html';res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(__dirname,file)))}).listen(Number(process.argv[2]),'127.0.0.1',()=>console.log('Desktop dashboard ready'));\n",
  )
  const git = join(exe, '..', 'resources/desktop/git/cmd/git.exe'),
    runGit = (args) => execFileSync(git, args, { cwd: repo, windowsHide: true, encoding: 'utf8' })
  runGit(['init', '--initial-branch=main'])
  runGit(['add', '.'])
  runGit([
    '-c',
    'user.name=Desktop Replay Verification',
    '-c',
    'user.email=desktop@parallax.invalid',
    'commit',
    '-m',
    'Desktop dashboard seed',
  ])
  const recipe = (content, label) => ({
    calls: [
      { name: 'read_instructions', args: {} },
      { name: 'read_file', args: { path: 'dashboard.js' } },
      { name: 'write_file', args: { path: 'dashboard.js', content } },
      { name: 'inspect_diff', args: {} },
      {
        name: 'run_command',
        args: { executable: 'node', args: ['--check', 'dashboard.js'], cwd: '.' },
      },
    ],
    message: 'CONTROLLED PROVIDER — ' + label + '; real browser checks determine behavior.',
  })
  const fixes = {
    calls: [],
    message: 'CONTROLLED PROVIDER — separate fixes.',
    candidates: {
      a: recipe(guard, 'generation guard'),
      b: recipe(keyed, 'results keyed by active period'),
    },
  }
  await writeFile(
    provider,
    JSON.stringify({
      turns: [{ calls: [], message: 'CONTROLLED PROVIDER — investigation ready.' }, fixes, fixes],
    }),
  )
  await page.goto('http://parallax.localhost/')
  await page.getByRole('button', { name: 'New coding session', exact: true }).click()
  await page.getByLabel('Local repository path').fill(repo)
  await page.getByRole('button', { name: 'Open repository', exact: true }).click()
  await expect(page.locator('.coding-baseline')).toContainText(repo)
  await page.getByLabel('Coding provider', { exact: true }).selectOption('test')
  await page.getByRole('checkbox', { name: 'Investigate browser behavior', exact: true }).check()
  await page
    .getByLabel('Coding task', { exact: true })
    .fill(
      'Controlled desktop dashboard investigation: compare two distinct fixes for a previous-period response overwriting the active month.',
    )
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Project browser replay' })).toBeVisible()
  await finish()
  const scenario = {
    name: 'Desktop dashboard previous period overwrites active month',
    app: {
      executable: 'node',
      args: ['dashboard.cjs', '{PORT}'],
      cwd: '.',
      origin: 'http://127.0.0.1:{PORT}',
      page: '/dashboard',
      readyPath: '/health',
    },
    requests: [
      {
        id: 'week',
        label: 'Weekly metrics',
        method: 'GET',
        url: '/metrics/snapshot?period=week',
        postData: null,
        status: 200,
        json: { rows: ['Weekly revenue $12,000'] },
      },
      {
        id: 'month',
        label: 'Monthly metrics',
        method: 'GET',
        url: '/metrics/snapshot?period=month',
        postData: null,
        status: 200,
        json: { rows: ['Monthly revenue $45,000'] },
      },
    ],
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
    order: ['month', 'week'],
    expected: {
      description: 'Active monthly metrics survive the older response.',
      selector: '#metric-list li',
      texts: ['Monthly revenue $45,000'],
      afterRequest: 'month',
    },
    settleMs: 80,
    timeoutMs: 4000,
  }
  await scenarioView(page, 'json')
  await page
    .getByRole('textbox', { name: 'Replay scenario JSON' })
    .fill(JSON.stringify(scenario, null, 2))
  await page.getByRole('button', { name: 'Save scenario', exact: true }).click()
  await expect
    .poll(async () => (await state()).projectReplay?.saved?.scenario.name)
    .toBe(scenario.name)
  const replay = async (version) => {
    await closeCompactDetails(page)
    if (version !== 'all')
      await page
        .getByRole('tablist', { name: 'Replay versions' })
        .getByRole('tab', { name: version === 'baseline' ? /Baseline/ : /Approach A/ })
        .click()
    await page
      .getByRole('button', {
        name:
          version === 'all'
            ? 'Replay all'
            : version === 'baseline'
              ? 'Replay Baseline'
              : 'Replay Approach A',
        exact: true,
      })
      .click()
    return await finish()
  }
  let s = await replay('baseline')
  expect(s.projectReplay.runs.at(-1).status).toBe('failed')
  await page.getByRole('link', { name: 'Open full frame', exact: true }).click()
  let popup
  for (let attempt = 0; attempt < 150; attempt++) {
    popup = page
      .context()
      .browser()
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate !== page && candidate.url().includes('/frames/'))
    if (popup) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!popup)
    throw Error(
      'Native full-frame window unavailable: ' +
        JSON.stringify(
          page
            .context()
            .browser()
            .contexts()
            .flatMap((context) => context.pages())
            .map((candidate) => candidate.url()),
        ),
    )
  await expect(popup.locator('img')).toBeVisible()
  await popup.screenshot({ path: join(artifact, 'full-frame-native.png') })
  await popup.close()
  await closeCompactDetails(page)
  await page.getByRole('button', { name: 'Move response week earlier', exact: true }).click()
  s = await replay('baseline')
  expect(s.projectReplay.runs.at(-1).status).toBe('passed')
  await replayTools(page)
  await page.getByRole('button', { name: 'Generate two fixes', exact: true }).click()
  s = await finish()
  expect(s.candidates).toHaveLength(2)
  expect(s.candidates[0].patch).not.toBe(s.candidates[1].patch)
  s = await replay('all')
  expect(s.projectReplay.runs.slice(-3).map((r) => r.status)).toEqual([
    'passed',
    'passed',
    'passed',
  ])
  await closeCompactDetails(page)
  await page.getByRole('button', { name: 'Move response week later', exact: true }).click()
  s = await replay('all')
  expect(s.projectReplay.runs.slice(-3).map((r) => r.status)).toEqual([
    'failed',
    'passed',
    'passed',
  ])
  await page
    .getByRole('tablist', { name: 'Replay versions' })
    .getByRole('tab', { name: /Approach B/ })
    .click()
  await page.screenshot({ path: join(artifact, 'main-replay-comparison.png') })
  await replayTools(page)
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 })
  await page.getByRole('link', { name: 'Export regression test', exact: true }).click()
  const download = await downloadPromise
  await download.saveAs(join(artifact, 'desktop-regression.spec.ts'))
  expect(await readFile(join(artifact, 'desktop-regression.spec.ts'), 'utf8')).toContain(
    scenario.name,
  )
  const result = {
    session: s.id,
    provider: 'Scripted controlled provider — no live model',
    runs: s.projectReplay.runs.map((r) => ({
      version: r.version,
      order: r.order,
      status: r.status,
    })),
    fullFrameOpened: true,
    regressionDownloaded: true,
    sourcePreserved: runGit(['status', '--porcelain']) === '',
  }
  await writeFile(join(artifact, 'main-replay-proof.json'), JSON.stringify(result, null, 2))
  return result
}
