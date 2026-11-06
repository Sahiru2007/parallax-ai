import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, rm, symlink, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { applyCandidate, diffSnapshot, sourceSnapshot, writablePath } from './coding-files.ts'
import { createWorktree } from './worktrees.ts'
import { git } from './process.ts'

test('general edits reject credential paths, traversal, and linked parent directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'parallax-paths-'))
  const outside = await mkdtemp(join(tmpdir(), 'parallax-outside-'))
  await symlink(outside, join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  for (const path of [
    '../outside',
    '.git/config',
    '.env',
    '.npmrc',
    'private.pem',
    'src/file:stream',
    'linked/new.js',
  ])
    await assert.rejects(writablePath(dir, path))
  assert.equal(await writablePath(dir, 'src/new.js'), join(dir, 'src/new.js'))
})

test('multi-file patches preserve spaces, creations, deletions, binary data, and the target index', async () => {
  const dir = resolve('artifacts/coding-unit', randomUUID()),
    repo = join(dir, 'source repo')
  await mkdir(dir, { recursive: true })
  await git(process.cwd(), ['clone', '--shared', '--', process.cwd(), repo])
  await writeFile(join(repo, 'blob.bin'), Buffer.from([0, 255, 1, 2]))
  const baseline = await sourceSnapshot(repo)
  const candidate = join(dir, 'candidate'),
    target = join(dir, 'target')
  for (const path of [candidate, target])
    await createWorktree(repo, path, baseline, new AbortController().signal, {
      linkDependencies: false,
    })
  const literal = 'New feature\n++ b/after/literal-source-text\n++ b/blob.bin\n'
  await writeFile(join(candidate, 'notes with spaces.txt'), literal)
  await writeFile(
    join(candidate, 'renamed README.md'),
    await readFile(join(candidate, 'README.md')),
  )
  await writeFile(join(candidate, 'blob.bin'), Buffer.from([0, 255, 3, 4, 5]))
  await rm(join(candidate, 'README.md'))
  const current = await sourceSnapshot(candidate)
  const diff = await diffSnapshot(baseline.files, current, join(dir, 'diff'))
  assert(diff.files.some((f) => f.path === 'notes with spaces.txt' && f.status === 'added'))
  assert(diff.files.some((f) => f.path === 'README.md' && f.status === 'deleted'))
  assert.match(diff.files.find((file) => file.path === 'blob.bin')!.patch, /Binary change/)
  await writeFile(join(target, 'local staged note.txt'), 'Preserve the staged note\n')
  await git(target, ['add', 'local staged note.txt'])
  const staged = await git(target, ['diff', '--cached', '--binary'])
  await applyCandidate({
    target,
    revision: baseline.revision,
    baseline: baseline.files,
    current,
    ...diff,
    patchPath: join(dir, 'apply.patch'),
  })
  assert.equal(
    (await readFile(join(target, 'notes with spaces.txt'), 'utf8')).replaceAll('\r\n', '\n'),
    literal,
  )
  assert.deepEqual(await readFile(join(target, 'blob.bin')), Buffer.from([0, 255, 3, 4, 5]))
  await assert.rejects(readFile(join(target, 'README.md')))
  assert.deepEqual(
    await readFile(join(target, 'renamed README.md')),
    await readFile(join(repo, 'README.md')),
  )
  assert.equal(await git(target, ['diff', '--cached', '--binary']), staged)
  assert.equal((await sourceSnapshot(repo)).digest, baseline.digest)
})
