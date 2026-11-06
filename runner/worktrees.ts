import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
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
  const rel = relative(root, actual)
  if (rel.startsWith('..') || isAbsolute(rel))
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
export async function captureSnapshot(
  root: string,
  signal?: AbortSignal,
  options: { requirePickup?: boolean } = {},
): Promise<Snapshot> {
  const top = await git(root, ['rev-parse', '--show-toplevel'], signal)
  if ((await realpath(root)) !== (await realpath(top)))
    throw new Error('Repository path must be the Git checkout root.')
  const revision = (await git(root, ['rev-parse', 'HEAD'], signal)).trim()
  const dirty = Boolean(await git(root, ['status', '--porcelain'], signal))
  const listed = (
    await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], signal)
  )
    .split('\0')
    .filter(Boolean)
  const headFiles = (await git(root, ['ls-tree', '-r', '--name-only', '-z', revision], signal))
    .split('\0')
    .filter(Boolean)
  const files = new Map<string, Buffer>()
  const hash = createHash('sha256')
  let size = 0
  for (const file of [...new Set(listed)].sort()) {
    signal?.throwIfAborted()
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
  if (options.requirePickup !== false && !files.has(HOOK_PATH))
    throw new Error('The pickup-search fixture is missing from the working-copy snapshot.')
  return { revision, dirty, digest: hash.digest('hex'), files, headFiles }
}
export async function createWorktree(
  root: string,
  target: string,
  snapshot: Snapshot,
  signal: AbortSignal,
  options: { linkDependencies?: boolean } = {},
) {
  // Git creates detached worktrees; neither the current branch nor index is changed.
  await git(root, ['worktree', 'add', '--detach', target, snapshot.revision], signal)
  for (const file of snapshot.headFiles) {
    if (!snapshot.files.has(file)) {
      const destination = resolve(target, file)
      const rel = relative(target, destination)
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid snapshot path.')
      await rm(destination, { force: true })
    }
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
  if (
    options.linkDependencies !== false &&
    (await lstat(join(root, 'node_modules')).catch(() => null))
  )
    await symlink(
      join(root, 'node_modules'),
      join(target, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
}

/** Remove only a session-owned detached worktree; retain all evidence and source checkout. */
export async function removeCandidateWorktree(root: string, dir: string, id: string) {
  if (!['baseline', 'a', 'b'].includes(id)) throw new Error('Invalid candidate cleanup target.')
  const relativeDir = relative(resolve(root, 'artifacts/investigations'), resolve(dir))
  if (!/^[a-f0-9-]{36}$/.test(relativeDir))
    throw new Error('Cleanup must stay inside the session directory.')
  const target = resolve(dir, 'worktrees', id)
  const registered = (await git(root, ['worktree', 'list', '--porcelain', '-z']))
    .split('\0')
    .some((line) => line.startsWith('worktree ') && resolve(line.slice(9)) === target)
  const exists = await lstat(target).catch(() => null)
  if (!exists) {
    if (registered) await git(root, ['worktree', 'remove', '--force', target])
    return
  }
  if (exists.isSymbolicLink()) throw new Error('Refusing a linked worktree cleanup target.')
  const expected = join(
    await realpath(root),
    'artifacts/investigations',
    relativeDir,
    'worktrees',
    id,
  )
  if ((await realpath(target)) !== expected)
    throw new Error('Refusing cleanup through a linked parent directory.')
  if (!registered) {
    if (await lstat(join(target, '.git')).catch(() => null))
      throw new Error('Refusing to remove an unregistered repository during candidate cleanup.')
    // A cancelled `worktree add` can leave a partial directory. Its resolved absolute
    // path was checked above against this session's exact owned candidate path.
    await rm(target, { recursive: true, force: true })
    return
  }
  const expectedCommon = await realpath(
    await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  )
  const common = await realpath(
    await git(target, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  )
  if (common !== expectedCommon) throw new Error('Cleanup target belongs to another repository.')
  const link = join(target, 'node_modules')
  if ((await lstat(link).catch(() => null))?.isSymbolicLink()) await unlink(link)
  await git(root, ['worktree', 'remove', '--force', target])
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
  const patch = diff.stdout ?? diff.output
  if (patch.length >= 149_000) throw new Error('Patch exceeds the review limit.')
  return patch
    .replaceAll(`a/before/${HOOK_PATH}`, `a/${HOOK_PATH}`)
    .replaceAll(`b/after/${HOOK_PATH}`, `b/${HOOK_PATH}`)
}
