import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { inside } from './worktrees.ts'
import { command } from './process.ts'

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
