import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { inside, removeCandidateWorktree } from './worktrees.ts'
import { command } from './process.ts'
import { git } from './process.ts'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, access } from 'node:fs/promises'

test('agent file access rejects traversal, metadata, dependencies, and credential files', () => {
  const root = resolve('artifacts/isolated-test-root')
  for (const file of [
    '../outside.ts',
    '.git/config',
    'node_modules/package.json',
    '.env',
    '.env.production',
    'artifacts/token.json',
  ]) {
    assert.throws(() => inside(root, file), /inside the worktree/)
  }
  assert.equal(inside(root, 'src/search.ts'), resolve(root, 'src/search.ts'))
})

test('cleanup rejects the source checkout and paths outside session ownership', async () => {
  for (const dir of [process.cwd(), resolve('artifacts'), resolve('../outside')]) {
    await assert.rejects(removeCandidateWorktree(process.cwd(), dir, 'a'), /session directory/)
  }
  await assert.rejects(
    removeCandidateWorktree(process.cwd(), process.cwd(), '../..'),
    /Invalid candidate/,
  )
})

test('cleanup refuses an unrelated repository occupying an owned candidate path', async () => {
  const root = process.cwd()
  const dir = resolve('artifacts/investigations', randomUUID())
  const target = join(dir, 'worktrees/a')
  await mkdir(join(dir, 'worktrees'), { recursive: true })
  await git(root, ['clone', '--shared', '--no-checkout', '--', root, target])
  await assert.rejects(removeCandidateWorktree(root, dir, 'a'), /unregistered repository/)
  await access(join(target, '.git'))
})
test('candidate command tools do not inherit provider credentials', async () => {
  const original = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-placeholder-not-a-key'
  try {
    const result = await command(process.cwd(), process.execPath, [
      '-e',
      'console.log(Boolean(process.env.OPENAI_API_KEY))',
    ])
    assert.equal(result.exitCode, 0)
    assert.equal(result.output.trim(), 'false')
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = original
  }
})
