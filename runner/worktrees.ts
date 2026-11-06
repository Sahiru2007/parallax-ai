import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { git } from './process.ts'

export const HOOK_PATH = 'fixtures/pickup-search/src/useAddressSearch.ts'
export function inside(root: string, file: string) {
  const target = resolve(root, file)
  const rel = relative(root, target)
  if (
    !rel ||
    rel.startsWith('..') ||
    isAbsolute(rel) ||
    /(^|[\\/])(\.git|node_modules|\.env[^\\/]*|artifacts)([\\/]|$)/i.test(file)
  ) {
    throw new Error(
      'File access must stay inside the worktree source; credentials and Git metadata are excluded.',
    )
  }
  return target
}
export async function safeRead(root: string, file: string) {
  const path = inside(root, file)
  const actual = await realpath(path)
  if (actual !== path && relative(root, actual).startsWith('..'))
    throw new Error('Symlink access outside the worktree is not permitted.')
  const data = await readFile(path)
  if (data.length > 200_000) throw new Error('File exceeds the agent read limit.')
  return data.toString('utf8')
}
export interface Snapshot {
  revision: string
  dirty: boolean
  digest: string
  files: Map<string, Buffer>
  headFiles: string[]
}
export async function captureSnapshot(root: string): Promise<Snapshot> {
  const revision = (await git(root, ['rev-parse', 'HEAD'])).trim()
  const dirty = Boolean(await git(root, ['status', '--porcelain']))
  const listed = (await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean)
  const headFiles = (await git(root, ['ls-tree', '-r', '--name-only', '-z', revision]))
    .split('\0')
    .filter(Boolean)
  const files = new Map<string, Buffer>()
  const hash = createHash('sha256')
  let size = 0
  for (const file of [...new Set(listed)].sort()) {
    // Never materialize a tracked credential override into candidate environments.
    if (/(^|\/)\.env($|\.)/.test(file) && file !== '.env.example') continue
    const source = resolve(root, file)
    let stat
    try {
      stat = await lstat(source)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue
    if (stat.size > 5_000_000 || (size += stat.size) > 25_000_000)
      throw new Error('Repository snapshot exceeds the local demo source limit (25 MB).')
    const data = await readFile(source)
    hash.update(file).update('\0').update(data).update('\0')
    files.set(file, data)
  }
  if (!files.has(HOOK_PATH))
    throw new Error('The pickup-search fixture is missing from the working-copy snapshot.')
  return { revision, dirty, digest: hash.digest('hex'), files, headFiles }
}
export async function createWorktree(
  root: string,
  target: string,
  snapshot: Snapshot,
  signal: AbortSignal,
) {
  // Git creates detached worktrees; neither the current branch nor index is changed.
  await git(root, ['worktree', 'add', '--detach', target, snapshot.revision], signal)
  for (const file of snapshot.headFiles) {
    if (!snapshot.files.has(file)) await rm(inside(target, file), { force: true })
  }
  for (const [file, contents] of snapshot.files) {
    signal.throwIfAborted()
    const destination = resolve(target, file)
    const rel = relative(target, destination)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid snapshot path.')
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, contents)
  }
  // Reuse installed dependencies, not a second installation. Writes remain source-scoped.
  await symlink(
    join(root, 'node_modules'),
    join(target, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}
export async function candidateDiff(worktree: string, baselineHook: Buffer, artifactDir: string) {
  const contents = await readFile(join(worktree, HOOK_PATH))
  // git diff --no-index compares the dirty snapshot, not just HEAD (the fixture is new).
  const before = join(artifactDir, 'before', HOOK_PATH)
  const after = join(artifactDir, 'after', HOOK_PATH)
  await mkdir(dirname(before), { recursive: true })
  await mkdir(dirname(after), { recursive: true })
  await writeFile(before, baselineHook)
  await writeFile(after, contents)
  const { command } = await import('./process.ts')
  const diff = await command(artifactDir, 'git', [
    'diff',
    '--no-index',
    '--no-ext-diff',
    '--',
    `before/${HOOK_PATH}`,
    `after/${HOOK_PATH}`,
  ])
  if (diff.exitCode > 1) throw new Error(diff.output)
  return diff.output
    .replaceAll(`a/before/${HOOK_PATH}`, `a/${HOOK_PATH}`)
    .replaceAll(`b/after/${HOOK_PATH}`, `b/${HOOK_PATH}`)
}
