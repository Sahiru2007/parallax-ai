import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runner = spawn(process.execPath, ['--env-file-if-exists=.env', 'runner/server.ts'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
})
const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', ...(process.argv.includes('--preview') ? ['preview'] : [])],
  { cwd: root, stdio: 'inherit', windowsHide: true },
)
const children = [runner, vite]
let ending = false
function stop(code = 0) {
  if (ending) return
  ending = true
  for (const child of children) child.kill()
  process.exitCode = code
}
for (const child of children) {
  child.once('error', (error) => {
    console.error(error.message)
    stop(1)
  })
  child.once('exit', (code) => stop(code ?? 0))
}
process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
process.once('exit', () => {
  for (const child of children) child.kill()
})
