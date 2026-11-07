import { mkdir, access, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { git } from '../../runner/process.ts'
import type { ReplayScenario } from '../../shared/project-replay.ts'

export const reportBaseline = `let active = '';
const list = document.querySelector('#report');
function render(rows) { list.replaceChildren(...rows.map(text => { const li = document.createElement('li'); li.textContent = text; return li; })); }
function choose(team) {
  active = team;
  document.querySelector('#active').textContent = team;
  fetch('/report?team=' + team).then(r => r.json()).then(data => render(data.rows));
}
document.querySelectorAll('[data-team]').forEach(button => button.addEventListener('click', () => choose(button.dataset.team)));
`
export const reportGuard = reportBaseline
  .replace("let active = '';", "let active = '';\nlet generation = 0;")
  .replace('function choose(team) {', 'function choose(team) {\n  const ticket = ++generation;')
  .replace('data => render(data.rows)', 'data => { if (ticket === generation) render(data.rows); }')
export const reportKeyed = reportBaseline
  .replace("let active = '';", "let active = '';\nconst byTeam = new Map();")
  .replace(
    'data => render(data.rows)',
    'data => { byTeam.set(team, data.rows); render(byTeam.get(active) || []); }',
  )
export const greetingTask =
  'Inspect AGENTS.md, greet.cjs and greet.test.cjs. Update greet(name) to trim whitespace, use friend for an empty/whitespace name, and return Hello, Ada! for Ada. Add tests for these cases to greet.test.cjs without dropping existing cases. Inspect the diff and run node --test greet.test.cjs through run_command. Do not commit, push, install dependencies, or edit unrelated files.'
export const greetingFollowup =
  'Continue from your existing greet.cjs edit. Add an optional second argument {uppercase:true} that uppercases the whole greeting. Preserve trimming, the friend fallback, and default behavior. Add tests to greet.test.cjs, inspect the diff, and rerun node --test greet.test.cjs through run_command. Do not install dependencies or change other files.'
export const replayTask =
  'Investigate report.js: choosing Old then Current lets the older team response overwrite the active team report. Keep both outgoing requests, HTML controls, URLs, fixtures and assertion unchanged. Generate two materially distinct fixes: Candidate A should use a latest-generation guard; Candidate B should store results by team and render only the active team. Do not cancel or omit requests. Read the actual saved scenario and baseline evidence, inspect the diff, and run node --check report.js. No dependency installation or commits.'
export const geminiScenario: ReplayScenario = {
  name: 'Old team response overwrites the current team report',
  app: {
    executable: 'node',
    args: ['report-server.cjs', '{PORT}'],
    cwd: '.',
    origin: 'http://127.0.0.1:{PORT}',
    page: '/',
    readyPath: '/health',
    prepare: { executable: 'node', args: ['--check', 'report.js'] },
  },
  actions: [
    {
      id: 'choose-old',
      label: 'Choose Old',
      kind: 'click',
      selector: '[data-team="old"]',
      waitForRequest: 'old',
    },
    {
      id: 'choose-current',
      label: 'Choose Current',
      kind: 'click',
      selector: '[data-team="current"]',
      waitForRequest: 'current',
    },
  ],
  requests: [
    {
      id: 'old',
      label: 'Old team',
      method: 'GET',
      url: '/report?team=old',
      postData: null,
      status: 200,
      json: { rows: ['Old team: 12 tickets'] },
    },
    {
      id: 'current',
      label: 'Current team',
      method: 'GET',
      url: '/report?team=current',
      postData: null,
      status: 200,
      json: { rows: ['Current team: 45 tickets'] },
    },
  ],
  order: ['current', 'old'],
  expected: {
    description: 'Current team report survives the later old-team response.',
    selector: '#report li',
    texts: ['Current team: 45 tickets'],
    afterRequest: 'current',
  },
  settleMs: 80,
  timeoutMs: 4000,
}
export async function createGeminiAcceptanceRepo(dir: string) {
  await mkdir(dir, { recursive: true })
  const seed = resolve('artifacts/step2-seed')
  if (
    !(await access(join(seed, '.git')).then(
      () => true,
      () => false,
    ))
  )
    await git(process.cwd(), [
      'clone',
      '--depth',
      '1',
      '--',
      'https://github.com/jonschlinkert/is-number.git',
      seed,
    ])
  const repo = join(dir, 'gemini test repo')
  await git(process.cwd(), ['clone', '--shared', '--', seed, repo])
  const files = {
    'AGENTS.md':
      'Use only Node built-ins. For greeting tasks edit greet.cjs and greet.test.cjs, read both first, and request node --test greet.test.cjs. For replay tasks edit only report.js and request node --check report.js. Preserve both report requests, selectors and DOM assertion. Candidate A: latest generation guard. Candidate B: results keyed by active team. No commits, pushes or dependency installs.\n',
    'greet.cjs': "module.exports = (name) => 'Hello, ' + name + '!';\n",
    'greet.test.cjs':
      "const {test}=require('node:test');const assert=require('node:assert/strict');const greet=require('./greet.cjs');test('existing greeting',()=>assert.equal(greet('Ada'),'Hello, Ada!'));\n",
    'report.js': reportBaseline,
    'report.html':
      '<!doctype html><html><head><meta charset="utf-8"><title>Team report</title></head><body><h1>Team dashboard</h1><button data-team="old">Old</button><button data-team="current">Current</button><p>Active: <span id="active"></span></p><ul id="report"></ul><script src="/report.js"></script></body></html>',
    'report-server.cjs':
      "const http=require('node:http'),fs=require('node:fs');http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/health'){res.end('ready');return}if(u.pathname==='/report'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({rows:[u.searchParams.get('team')==='current'?'Current team: 45 tickets':'Old team: 12 tickets']}));return}const file=u.pathname==='/report.js'?'report.js':'report.html';res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file))}).listen(Number(process.argv[2]),'127.0.0.1');\n",
  }
  for (const [path, text] of Object.entries(files)) await writeFile(join(repo, path), text)
  return repo
}
