import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { replaceStateFile } from './state-files.ts'

test('transient Windows sharing errors retain acknowledged state until an atomic replacement succeeds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'parallax-state-')),
    source = join(dir, 'pending.json'),
    target = join(dir, 'session.json')
  await writeFile(source, 'next')
  await writeFile(target, 'acknowledged')
  let calls = 0
  await replaceStateFile(
    source,
    target,
    async (a, b) => {
      calls++
      if (calls < 3) {
        assert.equal(await readFile(target, 'utf8'), 'acknowledged')
        throw Object.assign(new Error('sharing violation'), { code: 'EPERM' })
      }
      await rename(a, b)
    },
    'win32',
  )
  assert.equal(calls, 3)
  assert.equal(await readFile(target, 'utf8'), 'next')
})
test('persistent sharing failures are bounded and never delete acknowledged state; other errors fail immediately', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'parallax-state-')),
    source = join(dir, 'pending.json'),
    target = join(dir, 'session.json')
  await writeFile(source, 'next')
  await writeFile(target, 'acknowledged')
  let calls = 0
  await assert.rejects(
    replaceStateFile(
      source,
      target,
      async () => {
        calls++
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      },
      'win32',
    ),
    /busy/,
  )
  assert.equal(calls, 6)
  assert.equal(await readFile(target, 'utf8'), 'acknowledged')
  assert.equal(await readFile(source, 'utf8'), 'next')
  calls = 0
  await assert.rejects(
    replaceStateFile(
      source,
      target,
      async () => {
        calls++
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      },
      'win32',
    ),
    /disk full/,
  )
  assert.equal(calls, 1)
})
