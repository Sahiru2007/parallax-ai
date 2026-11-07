import { spawn } from 'node:child_process'
// Uses the running app and its runner-side key. Never reads or accepts an API key here.
const child = spawn(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'playwright.coding.config.ts',
    'tests/coding/gemini.spec.ts',
    '--grep',
    'LIVE Gemini',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, PARALLAX_VERIFY_GEMINI_LIVE: '1' },
  },
)
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
child.on('error', () => {
  console.error('Could not start Gemini acceptance. Run it from the PARALLAX repository.')
  process.exitCode = 1
})
