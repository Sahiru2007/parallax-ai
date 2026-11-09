import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve, dirname, relative } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

const exe = process.env.PARALLAX_INSTALLED_EXE
const evidence = process.env.PARALLAX_REPAIR_EVIDENCE
if (!exe || !evidence) throw Error('Set PARALLAX_INSTALLED_EXE and PARALLAX_REPAIR_EVIDENCE.')
const id = randomUUID(),
  artifact = resolve(evidence, 'controlled-app', id)
const repo = resolve(evidence, 'test-repos', id.slice(0, 8), 'repo with spaces')
const data = join(process.env.LOCALAPPDATA, 'dev.parallax-ai.desktop', 'repair-verification-' + id)
const git = join(dirname(exe), 'resources/desktop/git/cmd/git.exe')
const node = join(dirname(exe), 'resources/desktop/node/node.exe')
const deep =
  'tests/fixtures/config-file/extends-chain/node_modules/eslint-config-a/node_modules/eslint-config-b/ordinary.json'
const original = "exports.greet = name => 'Hello ' + name;\n"
const implementations = {
  A:
    original +
    "// A_PRIVATE_PATCH\nexports.shout = name => exports.greet(name).toUpperCase() + '!';\n",
  B:
    original +
    "// B_PRIVATE_PATCH\nexports.shout = name => ['HELLO', name.toUpperCase()].join(' ') + '!';\n",
}
const baseTest =
  "const{test}=require('node:test'),assert=require('node:assert/strict');test('existing greeting',()=>assert.equal(require('./implementation.cjs').greet('Ada'),'Hello Ada'));test('runner secrets absent',()=>{assert.equal(process.env.GEMINI_API_KEY,undefined);assert.equal(process.env.PARALLAX_DESKTOP_SECRET,undefined)});\n"
const featureTest =
  "const{test}=require('node:test'),assert=require('node:assert/strict');test('new shout',()=>assert.equal(require('./implementation.cjs').shout('Ada'),'HELLO ADA!'));\n"
const initialFiles = new Map([
  ['implementation.cjs', original],
  ['base.test.cjs', baseTest],
  [deep, '{"ordinaryFixture":true}\n'],
  [
    'package.json',
    JSON.stringify(
      {
        name: 'parallax-controlled-repair-verification',
        private: true,
        scripts: { test: 'node --test' },
      },
      null,
      2,
    ) + '\n',
  ],
  ['.gitignore', 'node_modules/\n'],
])
const sha = (value) => createHash('sha256').update(value).digest('hex')
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cleanEnv = { ...process.env, PATH: [dirname(node), dirname(git), process.env.PATH].join(';') }
for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'PARALLAX_DESKTOP_SECRET'])
  delete cleanEnv[key]
function command(cwd, executable, args) {
  const result = spawnSync(executable, args, {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    env: cleanEnv,
    timeout: 120000,
    maxBuffer: 20_000_000,
  })
  return {
    executable,
    args,
    cwd,
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message,
  }
}
function gitRun(cwd, args) {
  const result = command(cwd, git, ['-c', 'core.longpaths=true', ...args])
  if (result.exitCode !== 0) throw Error('Git command failed: ' + JSON.stringify(result))
  return result.stdout.trim()
}
async function tree(path) {
  const result = {}
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const file = join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile())
        result[relative(path, file).replaceAll('\\', '/')] = sha(await readFile(file))
    }
  }
  await walk(path)
  return result
}
await mkdir(artifact, { recursive: true })
await mkdir(repo, { recursive: true })
for (const [name, contents] of initialFiles) {
  await mkdir(dirname(join(repo, name)), { recursive: true })
  await writeFile(join(repo, name), contents)
}
gitRun(repo, ['init', '--initial-branch=main'])
gitRun(repo, ['add', '--force', '--all'])
gitRun(repo, [
  '-c',
  'user.name=Repair Verification',
  '-c',
  'user.email=verification@parallax.invalid',
  'commit',
  '-m',
  'Exact controlled baseline',
])
const baseline = gitRun(repo, ['rev-parse', 'HEAD'])
const baselineTree = await tree(repo)
const baselineCheck = command(repo, node, ['--test'])
await save(join(artifact, 'baseline-tests.json'), baselineCheck)
expect(baselineCheck.exitCode).toBe(0)

// Reproduce both original faults with per-invocation settings, never global configuration.
const oldWorktree = join(artifact, 'old-worktree-repro', 'long-parent-'.repeat(6), 'candidate')
await mkdir(dirname(oldWorktree), { recursive: true })
const oldCheckout = command(repo, git, [
  '-c',
  'core.longpaths=false',
  'worktree',
  'add',
  '--detach',
  oldWorktree,
  baseline,
])
await save(join(artifact, 'original-worktree-failure.json'), oldCheckout)
expect(oldCheckout.exitCode).not.toBe(0)
expect(oldCheckout.stderr).toMatch(/Filename too long/)
const diffRoot = join(artifact, 'old-export-repro', 'long-parent-'.repeat(6))
for (const side of ['before', 'after'])
  for (const [name, contents] of initialFiles) {
    await mkdir(dirname(join(diffRoot, side, name)), { recursive: true })
    await writeFile(
      join(diffRoot, side, name),
      side === 'after' && name === 'implementation.cjs' ? implementations.A : contents,
    )
  }
const oldDiff = command(diffRoot, git, [
  '-c',
  'core.longpaths=false',
  'diff',
  '--no-index',
  '--no-ext-diff',
  '--',
  'before',
  'after',
])
await save(join(artifact, 'original-export-failure.json'), oldDiff)
expect(oldDiff.exitCode).toBe(1)
expect(oldDiff.stderr).toMatch(/Could not access/)
const fixedDiff = command(diffRoot, git, [
  '-c',
  'core.longpaths=true',
  'diff',
  '--no-index',
  '--no-ext-diff',
  '--',
  'before',
  'after',
])
await save(join(artifact, 'longpath-diff-control.json'), fixedDiff)
expect(fixedDiff.exitCode).toBe(1)
expect(fixedDiff.stdout).toContain('exports.shout')
expect(fixedDiff.stderr).not.toMatch(/error:|fatal:/)

const requests = [],
  violations = [],
  counters = new Map()
const model = 'models/repair-verification-double'
const double = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) {
    res.setHeader('Content-Type', 'application/json')
    return res.end(
      JSON.stringify({
        models: [{ name: model, supportedGenerationMethods: ['generateContent'] }],
      }),
    )
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw),
    declarations = body.tools?.[0]?.functionDeclarations ?? []
  const call = (name, args) => ({
    thoughtSignature: 'controlled-repair-signature',
    functionCall: { name, args },
  })
  let parts
  if (declarations.some((t) => t.name === 'parallax_probe')) {
    parts = body.contents.some((c) => c.parts.some((p) => p.functionResponse))
      ? [{ text: 'parallax-acknowledged' }]
      : [call('parallax_probe', { value: 'parallax-ready' })]
  } else {
    const candidate =
      /Candidate: Approach ([AB])\./.exec(body.systemInstruction.parts[0].text)?.[1] ?? 'A'
    const peer = candidate === 'A' ? 'B' : 'A'
    const kind = raw.includes('CONTROLLED_SINGLE') ? 'single' : 'compare'
    const turn = raw.includes('CONTROLLED_FOLLOWUP') ? 2 : 1
    const key = `${kind}-${candidate}-${turn}`,
      step = (counters.get(key) ?? 0) + 1
    counters.set(key, step)
    if (raw.includes(peer + '_PRIVATE_'))
      violations.push({
        candidate,
        kind,
        turn,
        step,
        reason: 'Peer private context appeared in provider request',
      })
    requests.push({ candidate, kind, turn, step, body }) // No request headers or credential values.
    if (turn === 1) {
      parts =
        step === 1
          ? [call('read_instructions', {}), call('read_file', { path: 'implementation.cjs' })]
          : step === 2
            ? [
                call('run_command', {
                  executable: 'node',
                  args: ['-e', `console.log('${candidate}_PRIVATE_TOOL_RESULT')`],
                  cwd: '.',
                }),
              ]
            : step === 3
              ? [
                  call('write_file', {
                    path: 'implementation.cjs',
                    content: implementations[candidate],
                  }),
                  call('write_file', { path: 'feature.test.cjs', content: featureTest }),
                ]
              : step === 4
                ? [call('inspect_diff', {})]
                : step === 5
                  ? [call('run_command', { executable: 'npm', args: ['run', 'test'], cwd: '.' })]
                  : [
                      {
                        text: `${candidate}_PRIVATE_CONVERSATION_1 — controlled provider; real files and tests.`,
                      },
                    ]
    } else {
      parts =
        step === 1
          ? [call('read_file', { path: 'implementation.cjs' })]
          : step === 2
            ? [
                call('write_file', {
                  path: 'README.md',
                  content: `${candidate}_PRIVATE_DOCUMENTATION\nshout preserves greet and adds an uppercase greeting.\n`,
                }),
              ]
            : step === 3
              ? [call('run_command', { executable: 'npm', args: ['run', 'test'], cwd: '.' })]
              : [{ text: `${candidate}_PRIVATE_CONVERSATION_2 — controlled follow-up complete.` }]
    }
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.end(
    `data: ${JSON.stringify({ modelVersion: 'controlled-repair-double-no-live-model', candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } })}\n\n`,
  )
})
double.listen(0, '127.0.0.1')
await once(double, 'listening')
const endpoint = 'http://127.0.0.1:' + double.address().port
let app, browser, page
const proof = {
  artifact,
  data,
  exe,
  repo,
  baseline,
  provider: 'Controlled Gemini protocol double; NO live inference',
  exports: [],
  requests: 0,
  originalFailuresReproduced: true,
}
async function start() {
  const env = {
    ...process.env,
    PARALLAX_DESKTOP_TEST: '1',
    PARALLAX_DESKTOP_DATA_DIR: data,
    PARALLAX_ENABLE_TEST_PROVIDER: '1',
    PARALLAX_GEMINI_TEST_URL: endpoint,
    PARALLAX_CREDENTIAL_TARGET: 'PARALLAX AI/Test/' + id,
    GEMINI_API_KEY: 'inert-repair-fixture-' + id,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      '--remote-debugging-port=9232 --remote-debugging-address=127.0.0.1',
  }
  for (const key of [
    'GOOGLE_API_KEY',
    'OPENAI_API_KEY',
    'PARALLAX_TEST_PROVIDER_FILE',
    'PARALLAX_OPENAI_TEST_URL',
  ])
    delete env[key]
  app = spawn(exe, [], { env, cwd: process.env.TEMP, windowsHide: false })
  for (let i = 0; i < 450; i++) {
    if (app.exitCode !== null) throw Error('Installed app exited before connection')
    if (
      await fetch('http://127.0.0.1:9232/json/version').then(
        (r) => r.ok,
        () => false,
      )
    )
      break
    await sleep(100)
  }
  browser = await chromium.connectOverCDP('http://127.0.0.1:9232')
  for (let i = 0; i < 150; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('parallax.localhost'))
    if (page) break
    await sleep(100)
  }
  await expect(page.getByText('Runner connected', { exact: true })).toBeVisible({ timeout: 45000 })
}
async function stop() {
  if (!app || app.exitCode !== null) return
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`,
    ],
    { windowsHide: true },
  )
  for (let i = 0; i < 150 && app.exitCode === null; i++) await sleep(100)
  if (app.exitCode === null) throw Error('Owned verification app did not exit normally')
  await browser?.close().catch(() => {})
}
async function state() {
  return page.evaluate(async () => {
    const id = localStorage.getItem('parallax-coding-session')
    return id ? (await fetch('/api/coding/sessions/' + id)).json() : null
  })
}
async function configure() {
  await page.getByRole('button', { name: 'Manage providers', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Manage providers' })
  await settings.getByRole('tab', { name: 'Google Gemini', exact: true }).click()
  const connection = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/providers') &&
      r.request().method() === 'POST' &&
      r.request().postDataJSON()?.action === 'connection',
  )
  await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
  await connection
  await settings.getByLabel('Available model', { exact: true }).selectOption(model)
  const probe = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/providers') &&
      r.request().method() === 'POST' &&
      r.request().postDataJSON()?.action === 'agent-check',
  )
  await settings.getByRole('button', { name: 'Run coding-agent check', exact: true }).click()
  const configured = await (await probe).json()
  expect(configured.gemini.checks[model].ok).toBe(true)
  await settings.getByRole('button', { name: 'Use model for new sessions', exact: true }).click()
  await settings.getByRole('button', { name: 'Close provider settings', exact: true }).click()
}
async function finish() {
  const deadline = Date.now() + 180000,
    approvals = new Set()
  while (Date.now() < deadline) {
    const s = await state()
    if (s?.approval && !approvals.has(s.approval.id)) {
      expect(s.approval.cwd.startsWith(join(data, 'sessions'))).toBe(true)
      approvals.add(s.approval.id)
      await expect(page.getByRole('region', { name: 'Command approval' })).toContainText(
        s.approval.cwd,
      )
      await page.getByRole('button', { name: 'Approve command', exact: true }).click()
    }
    if (s && !s.busy) {
      expect(s.status, s.error).toBe('ready')
      return s
    }
    await sleep(150)
  }
  throw Error('Controlled task did not finish in three minutes')
}
async function begin(compare) {
  await page.getByRole('button', { name: 'New coding session', exact: true }).click()
  await page.getByLabel('Local repository path', { exact: true }).fill(repo)
  await page.getByRole('button', { name: 'Open repository', exact: true }).click()
  await expect(page.locator('.coding-baseline')).toContainText(baseline.slice(0, 12))
  await page.getByRole('checkbox', { name: 'Compare approaches', exact: true }).setChecked(compare)
  if (compare)
    await page.getByRole('checkbox', { name: 'Generate A, then B manually', exact: true }).check()
  await page
    .getByLabel('Coding task', { exact: true })
    .fill(
      `${compare ? 'CONTROLLED_COMPARE' : 'CONTROLLED_SINGLE'} Add shout(name) returning an uppercase Hello greeting with !, preserve greet, add a feature test and run the project tests. This is a controlled repair verification.`,
    )
  const submitted = page.waitForResponse(
    (r) => r.url().endsWith('/api/coding/sessions') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Start coding', exact: true }).click()
  const initial = await (await submitted).json()
  await expect.poll(async () => (await state())?.id, { timeout: 45000 }).toBe(initial.id)
  return finish()
}
async function exportAndVerify(s, candidateId, label) {
  await page
    .getByRole('tablist', { name: 'Coding implementations' })
    .getByRole('tab', {
      name: candidateId === 'b' ? /^Approach B/ : /^(Approach A|Implementation)/,
    })
    .click()
  await page.getByRole('button', { name: 'Refresh review', exact: true }).click()
  await sleep(500)
  s = await state()
  const c = s.candidates.find((candidate) => candidate.id === candidateId)
  const patchFile = join(artifact, label + '.patch')
  const waiting = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export patch', exact: true }).click()
  await (await waiting).saveAs(patchFile)
  expect(sha(await readFile(patchFile))).toBe(sha(c.patch))
  const target = join(artifact, label + ' clean checkout')
  // A clean copy must reproduce the captured baseline bytes, including line endings.
  gitRun(dirname(repo), [
    'clone',
    '--no-local',
    '--config',
    'core.autocrlf=false',
    '--',
    repo,
    target,
  ])
  expect(gitRun(target, ['rev-parse', 'HEAD'])).toBe(baseline)
  expect(await tree(target)).toEqual(baselineTree)
  gitRun(target, ['apply', '--check', '--', patchFile])
  gitRun(target, ['apply', '--', patchFile])
  const actualTree = await tree(c.worktree),
    appliedTree = await tree(target)
  expect(appliedTree).toEqual(actualTree)
  const tests = command(target, node, ['--test'])
  expect(tests.exitCode, tests.stderr + tests.stdout).toBe(0)
  const acceptance = command(target, node, [
    '-e',
    "const a=require('node:assert/strict'),v=require('./implementation.cjs');a.equal(v.greet('Ada'),'Hello Ada');a.equal(v.shout('Ada'),'HELLO ADA!');a.equal(v.shout('Lin'),'HELLO LIN!')",
  ])
  expect(acceptance.exitCode).toBe(0)
  await save(join(artifact, label + '-tests.json'), { tests, acceptance })
  await save(join(artifact, label + '-tree.json'), {
    candidate: actualTree,
    independentlyApplied: appliedTree,
  })
  await page.screenshot({ path: join(artifact, label + '-review.png') })
  proof.exports.push({
    label,
    session: s.id,
    candidate: candidateId,
    baseline,
    digest: c.digest,
    patchFile,
    patchSha256: sha(await readFile(patchFile)),
    target,
    allFilesMatch: true,
    independentTestsPassed: true,
    fixturePathLength: join(c.worktree, deep).length,
  })
  return s
}
try {
  await start()
  await configure()
  let s = await begin(true)
  const sharedSession = s.id
  expect(await readFile(join(s.candidates[1].worktree, 'implementation.cjs'), 'utf8')).toBe(
    original,
  )
  await page
    .getByRole('button', { name: 'Generate Candidate B from same baseline', exact: true })
    .click()
  await expect
    .poll(async () => (await state()).providerRuns.some((r) => r.candidate === 'b'))
    .toBe(true)
  s = await finish()
  for (const name of ['Approach A', 'Approach B'])
    await expect(page.getByRole('tab', { name: new RegExp('^' + name) })).toBeVisible()
  for (const name of ['A', 'B'])
    await expect(
      page.locator('.coding-message').filter({ hasText: name + '_PRIVATE_CONVERSATION_1' }),
    ).toBeVisible()
  expect(s.candidates[0].patch).not.toBe(s.candidates[1].patch)
  for (const c of s.candidates) {
    expect(gitRun(c.worktree, ['rev-parse', 'HEAD'])).toBe(baseline)
    expect(join(c.worktree, deep).length).toBeGreaterThan(260)
  }
  await exportAndVerify(s, 'a', 'compare-A-initial')
  await exportAndVerify(s, 'b', 'compare-B-initial')
  await stop()
  await start()
  await configure()
  expect((await state()).id).toBe(sharedSession)
  await page
    .getByLabel('Follow-up instruction', { exact: true })
    .fill(
      'CONTROLLED_FOLLOWUP Document shout in README, preserve your existing implementation and rerun tests.',
    )
  const continued = page.waitForResponse(
    (r) => r.url().endsWith('/followup') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Continue session', exact: true }).click()
  await continued
  s = await finish()
  await page
    .getByRole('button', { name: 'Generate Candidate B from same baseline', exact: true })
    .click()
  await expect
    .poll(async () => (await state()).providerRuns.filter((r) => r.candidate === 'b').length)
    .toBe(2)
  s = await finish()
  await exportAndVerify(s, 'a', 'compare-A-followup')
  await exportAndVerify(s, 'b', 'compare-B-followup')
  for (const name of ['A', 'B'])
    await expect(
      page.locator('.coding-message').filter({ hasText: name + '_PRIVATE_CONVERSATION_2' }),
    ).toBeVisible()
  await save(join(artifact, 'comparison-session.json'), s)
  s = await begin(false)
  await exportAndVerify(s, 'a', 'single-fresh-export')
  await save(join(artifact, 'single-session.json'), s)
  expect(violations).toEqual([])
  expect(await tree(repo)).toEqual(baselineTree)
  expect(gitRun(repo, ['status', '--porcelain'])).toBe('')
  proof.requests = requests.length
  proof.sourceRepoPreserved = true
  proof.sameBaseline = true
  proof.bothCandidatesVisible = true
  proof.followupIsolationAfterRestart = true
  proof.contextViolations = violations
  proof.status = 'passed'
  await save(join(artifact, 'provider-requests.json'), requests)
  await save(join(artifact, 'proof.json'), proof)
  await save(resolve(evidence, 'controlled-app/latest.json'), { artifact, data, exe })
  console.log(
    JSON.stringify({
      status: proof.status,
      artifact,
      exports: proof.exports.length,
      provider: proof.provider,
    }),
  )
} catch (error) {
  proof.status = 'failed'
  proof.error = String(error)
  await save(join(artifact, 'proof.json'), proof)
  await save(join(artifact, 'provider-requests.json'), requests)
  await page?.screenshot({ path: join(artifact, 'verification-error.png') }).catch(() => {})
  throw error
} finally {
  await stop()
  double.close()
}
