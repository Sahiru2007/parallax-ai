import { cp, mkdir, readFile, access, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git } from './process.ts'
import { linkDesktopDependencies } from './desktop-data.ts'

const payload = dirname(dirname(fileURLToPath(import.meta.url)))
const data = process.env.PARALLAX_DESKTOP_DATA_DIR
if (!data || !process.env.PARALLAX_DESKTOP_SECRET)
  throw new Error('The desktop runner must be started by the native application.')
const repo = join(data, 'demo-repository')
await mkdir(data, { recursive: true })
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
if (!(await exists(join(repo, '.git')))) {
  await cp(join(payload, 'demo-seed'), repo, { recursive: true })
  await git(repo, ['init', '--initial-branch=demo'])
  await git(repo, ['add', '--all'])
  await git(repo, [
    '-c',
    'user.name=Parallax Demo',
    '-c',
    'user.email=demo@parallax.invalid',
    'commit',
    '-m',
    'Bundled pickup demo baseline',
  ])
}
await linkDesktopDependencies(join(repo, 'node_modules'), join(payload, 'node_modules'))
process.env.PARALLAX_REPO_ROOT = repo
process.env.PARALLAX_STATE_DIR = join(data, 'sessions')
process.env.PARALLAX_RUNNER_PORT = '0'
process.env.PARALLAX_DESKTOP_STATIC_DIR = join(payload, 'frontend')
// Test profiles are opt-in and never replace the real credential namespace.
if (process.env.PARALLAX_DESKTOP_TEST !== '1') {
  for (const key of Object.keys(process.env))
    if (/^PARALLAX_.*TEST|^PARALLAX_CREDENTIAL_TARGET$|^PARALLAX_ENABLE_TEST_PROVIDER$/.test(key))
      delete process.env[key]
}
await readFile(join(payload, 'runtime-manifest.json'))
await writeFile(
  join(data, 'runtime-location.json'),
  JSON.stringify({ payload, node: process.execPath }),
)
await import('./server.ts')
