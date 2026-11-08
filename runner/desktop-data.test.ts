import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rmdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { linkDesktopDependencies } from './desktop-data.ts'

test('desktop rebinds a dangling demo dependency junction after reinstalling elsewhere', async () => {
  const root = await mkdtemp(join(tmpdir(), 'parallax-install-path-'))
  const old = join(root, 'Old install with spaces'),
    current = join(root, 'New install with spaces'),
    link = join(root, 'node_modules')
  try {
    await mkdir(old)
    await mkdir(current)
    await linkDesktopDependencies(link, old)
    await rmdir(old)
    await linkDesktopDependencies(link, current)
    assert.equal(await realpath(link), await realpath(current))
    await linkDesktopDependencies(link, current)
    assert.equal(await realpath(link), await realpath(current))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('desktop dependency repair preserves an unexpected real directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'parallax-install-path-'))
  try {
    const link = join(root, 'node_modules'),
      current = join(root, 'runtime')
    await mkdir(link)
    await mkdir(current)
    await writeFile(join(link, 'keep.txt'), 'local work')
    await assert.rejects(linkDesktopDependencies(link, current), /not an app-owned link/)
    assert.equal(await readFile(join(link, 'keep.txt'), 'utf8'), 'local work')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
