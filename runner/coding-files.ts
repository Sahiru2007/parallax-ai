import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { command, git, type CommandResult } from './process.ts'
import { captureSnapshot, inside, type Snapshot } from './worktrees.ts'
import type { CodingRepo, FileChange } from '../shared/coding.ts'

export async function inspectRepo(path: string): Promise<CodingRepo> {
  const root = await realpath(resolve(path))
  const top = await realpath(await git(root, ['rev-parse', '--show-toplevel']))
  if (root !== top) throw new Error('Select the Git checkout root, not a nested directory.')
  return {
    id: createHash('sha256').update(root).digest('hex').slice(0, 24),
    path: root,
    name: basename(root),
    branch: (await git(root, ['branch', '--show-current'])) || '(detached)',
    revision: await git(root, ['rev-parse', 'HEAD']),
    dirty: Boolean(await git(root, ['status', '--porcelain'])),
  }
}
export async function sourceSnapshot(root: string, signal?: AbortSignal) {
  const snapshot = await captureSnapshot(root, signal, { requirePickup: false })
  for (const file of snapshot.files.keys())
    if (/(^|\/)(\.npmrc|\.pypirc|\.netrc|\.git-credentials)$|\.(pem|key)$/i.test(file))
      snapshot.files.delete(file)
  const hash = createHash('sha256')
  for (const [path, data] of snapshot.files)
    hash.update(path).update('\0').update(data).update('\0')
  snapshot.digest = hash.digest('hex')
  return snapshot
}
export async function writablePath(root: string, file: string) {
  const target = inside(root, file)
  if (
    /[\r\n\0:]/.test(file) ||
    /(^|[\\/])(\.npmrc|\.pypirc|\.netrc|\.git-credentials)([\\/]|$)|\.(pem|key)$/i.test(file)
  )
    throw new Error('Credential files and control characters are excluded.')
  let ancestor = target
  while (!(await lstat(ancestor).catch(() => null))) ancestor = dirname(ancestor)
  const rel = relative(await realpath(root), await realpath(ancestor))
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Linked paths outside the worktree are excluded.')
  if ((await lstat(target).catch(() => null))?.isSymbolicLink())
    throw new Error('Editing linked files is excluded.')
  return target
}
export async function saveTree(dir: string, files: Map<string, Buffer>) {
  await mkdir(dir, { recursive: true })
  for (const [file, data] of files) {
    const target = resolve(dir, file)
    const rel = relative(dir, target)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid source path.')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }
}
export async function loadTree(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name)
      if (entry.isDirectory()) await walk(target)
      else if (entry.isFile())
        files.set(relative(dir, target).replaceAll('\\', '/'), await readFile(target))
    }
  }
  await walk(dir)
  return files
}
export function checkedDiffOutput(result: CommandResult, changedFiles: number) {
  const source = result.stdout ?? result.output
  if (
    result.exitCode > 1 ||
    /(^|\n)(?:error|fatal):/i.test(result.stderr ?? '') ||
    (changedFiles > 0 && !source.trim()) ||
    source.length >= 149_000
  )
    throw new Error(
      `Diff failed, returned no patch for changed files, or exceeded the 150 KB review limit.${result.stderr ? ` ${result.stderr.trim().slice(0, 3000)}` : ''}`,
    )
  return source
}
export async function diffSnapshot(baseline: Map<string, Buffer>, current: Snapshot, dir: string) {
  const files: FileChange[] = []
  for (const path of [...new Set([...baseline.keys(), ...current.files.keys()])].sort()) {
    const before = baseline.get(path),
      after = current.files.get(path)
    if (before && after && before.equals(after)) continue
    files.push({ path, status: !before ? 'added' : !after ? 'deleted' : 'modified', patch: '' })
  }
  if (!files.length) return { patch: '', files }
  // A fresh directory per diff prevents deleted files surviving from an earlier comparison.
  await saveTree(join(dir, 'before'), baseline)
  await saveTree(join(dir, 'after'), current.files)
  const result = await command(dir, 'git', [
    '-c',
    'core.quotePath=false',
    ...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []),
    'diff',
    '--no-index',
    '--no-ext-diff',
    '--no-renames',
    '--binary',
    '--',
    'before',
    'after',
  ])
  const source = checkedDiffOutput(result, files.length)
  let header = true
  const patch = source
    .split('\n')
    .map((line) => {
      if (line.startsWith('diff --git ')) header = true
      if (line.startsWith('@@ ') || line === 'GIT binary patch') header = false
      return header && /^(diff --git |--- |\+\+\+ )/.test(line)
        ? line.replaceAll(/([ab])\/(before|after)\//g, '$1/')
        : line
    })
    .join('\n')
  const blocks = patch.split(/(?=^diff --git )/m)
  for (const file of files)
    file.patch =
      blocks.find((block) => {
        const lines = block.split('\n')
        const body = lines.findIndex(
          (line) => line.startsWith('@@ ') || line === 'GIT binary patch',
        )
        return lines.slice(0, body < 0 ? undefined : body).some((line) => {
          if (!line.startsWith('+++ ') && !line.startsWith('--- ')) return false
          let value = line.slice(4).replace(/\t$/, '')
          if (value.startsWith('"')) {
            try {
              value = JSON.parse(value) as string
            } catch {
              return false
            }
          }
          return value === `a/${file.path}` || value === `b/${file.path}`
        })
      }) ?? 'Binary change; inspect the exported binary patch.'
  return { patch, files }
}
export async function applyCandidate(options: {
  target: string
  revision: string
  baseline: Map<string, Buffer>
  current: Snapshot
  patch: string
  files: FileChange[]
  patchPath: string
}) {
  const repo = await inspectRepo(options.target)
  if (repo.revision !== options.revision)
    throw new Error('Apply conflict: checkout HEAD differs from this session baseline.')
  if (!options.patch || !options.files.length) throw new Error('There is no patch to apply.')
  const backup = new Map<string, Buffer | undefined>()
  for (const file of options.files) {
    const target = await writablePath(repo.path, file.path)
    const stat = await lstat(target).catch(() => null)
    if (stat && !stat.isFile())
      throw new Error(`Apply conflict: ${file.path} is not a regular file.`)
    const actual = stat ? await readFile(target) : undefined
    const before = options.baseline.get(file.path)
    if (before ? !actual?.equals(before) : actual !== undefined)
      throw new Error(
        `Apply conflict: ${file.path} changed in the checkout. Existing files and staged changes were preserved.`,
      )
    backup.set(file.path, actual)
  }
  await writeFile(options.patchPath, options.patch)
  await git(repo.path, ['apply', '--check', '--whitespace=nowarn', options.patchPath])
  try {
    // Git's default apply is atomic; never use --reject, --index, or --cached.
    await git(repo.path, ['apply', '--whitespace=nowarn', options.patchPath])
  } catch (error) {
    for (const [path, original] of backup) {
      const target = await writablePath(repo.path, path)
      const actual = await readFile(target).catch(() => undefined)
      const proposed = options.current.files.get(path)
      const unchanged = original ? actual?.equals(original) : !actual
      if (unchanged) continue
      if (proposed ? !actual?.equals(proposed) : actual !== undefined)
        throw new Error(
          `Apply stopped; external changes detected in ${path}. No rollback overwrote that file.`,
        )
      if (original) {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, original)
      } else await rm(target, { force: true })
    }
    throw error
  }
  return repo.path
}
