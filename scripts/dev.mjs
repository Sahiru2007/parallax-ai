import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const children = []
let ending = false
function stop(code = 0) {
  if (ending) return
  ending = true
  for (const child of children) child.kill()
  process.exitCode = code
}
function start(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  children.push(child)
  child.once('error', (error) => {
    console.error(error.message)
    stop(1)
  })
  child.once('exit', (code) => stop(code ?? 0))
  return child
}
process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
process.once('exit', () => {
  for (const child of children) child.kill()
})
start(['--env-file-if-exists=.env', 'runner/server.ts'])
// Do not expose an apparently ready frontend while credentials/session recovery is still starting.
let ready = false
for (let attempt = 0; attempt < 300 && !ending; attempt++) {
  ready = await fetch(`http://127.0.0.1:${process.env.PARALLAX_RUNNER_PORT ?? 4317}/api/health`, {
    signal: AbortSignal.timeout(1000),
  }).then(
    (response) => response.ok,
    () => false,
  )
  if (ready) break
  await delay(100)
}
if (!ending && ready)
  start([
    'node_modules/vite/bin/vite.js',
    ...(process.argv.includes('--preview') ? ['preview'] : []),
  ])
else if (!ending) {
  console.error('Local runner did not become ready within the startup deadline.')
  stop(1)
}
