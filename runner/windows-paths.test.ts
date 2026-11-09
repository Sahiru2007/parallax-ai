import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { git } from './process.ts'
import { checkedDiffOutput, diffSnapshot, sourceSnapshot } from './coding-files.ts'

test('diff validation rejects Git exit-one access errors and missing patch output', () => {
  assert.throws(
    () =>
      checkedDiffOutput(
        {
          exitCode: 1,
          output: '',
          stdout: '',
          stderr: "error: Could not access 'before/deep/fixture.json'",
        },
        1,
      ),
    /Could not access/,
  )
  assert.throws(
    () =>
      checkedDiffOutput(
        {
          exitCode: 1,
          output: 'partial',
          stdout: 'partial',
          stderr: 'fatal: directory unreadable',
        },
        1,
      ),
    /directory unreadable/,
  )
  assert.throws(
    () => checkedDiffOutput({ exitCode: 1, output: '', stdout: '', stderr: '' }, 1),
    /no patch/,
  )
  assert.equal(
    checkedDiffOutput(
      { exitCode: 1, output: 'patch', stdout: 'patch', stderr: 'warning: line endings' },
      1,
    ),
    'patch',
  )
})

test(
  'Windows snapshots and exported source/test diffs support paths beyond MAX_PATH',
  { skip: process.platform !== 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parallax-long-path-'))
    const repo = join(dir, 'source')
    await mkdir(repo)
    const deep = 'deep-fixtures/'.repeat(18) + 'ordinary.json'
    assert(join(repo, deep).length > 260)
    const values = new Map([
      [deep, '{"fixture":true}\n'],
      ['lib/value.js', 'module.exports=0;\n'],
      [
        'test/value.test.js',
        "const assert=require('node:assert');assert.equal(require('../lib/value'),0);\n",
      ],
    ])
    for (const [name, value] of values) {
      await mkdir(dirname(join(repo, name)), { recursive: true })
      await writeFile(join(repo, name), value)
    }
    await git(repo, ['init', '--initial-branch=main'])
    await git(repo, ['add', '.'])
    await git(repo, [
      '-c',
      'user.name=Path Test',
      '-c',
      'user.email=paths@parallax.invalid',
      'commit',
      '-m',
      'Source baseline',
    ])
    const baseline = await sourceSnapshot(repo)
    assert(baseline.files.has(deep))
    await writeFile(join(repo, 'lib/value.js'), 'module.exports=1;\n')
    await writeFile(
      join(repo, 'test/value.test.js'),
      "const assert=require('node:assert');assert.equal(require('../lib/value'),1);\n",
    )
    const current = await sourceSnapshot(repo)
    const diff = await diffSnapshot(baseline.files, current, join(dir, 'retained-diff'))
    assert.deepEqual(
      diff.files.map((file) => file.path),
      ['lib/value.js', 'test/value.test.js'],
    )
    assert.match(diff.patch, /diff --git a\/lib\/value.js b\/lib\/value.js/)
    assert.match(diff.patch, /diff --git a\/test\/value.test.js b\/test\/value.test.js/)
    assert(diff.files.every((file) => file.patch.includes('@@')))
  },
)
