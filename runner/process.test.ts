import { test } from 'node:test'
import assert from 'node:assert/strict'
import { command } from './process.ts'
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

test('commands enforce a deadline and a subsequent command starts cleanly', async () => {
  await assert.rejects(
    command(process.cwd(), process.execPath, ['-e', 'setTimeout(() => {}, 500)'], undefined, {
      timeoutMs: 50,
    }),
    /timed out/,
  )
  const result = await command(process.cwd(), process.execPath, ['-e', 'console.log("retry")'])
  assert.equal(result.exitCode, 0)
  assert.equal(result.output.trim(), 'retry')
})

test('machine-readable stdout stays separate from interleaved command diagnostics', async () => {
  const result = await command(process.cwd(), process.execPath, [
    '-e',
    'process.stdout.write("patch-data\\n");process.stderr.write("warning: diagnostics\\n")',
  ])
  assert.equal(result.stdout, 'patch-data\n')
  assert.equal(result.stderr, 'warning: diagnostics\n')
  assert.match(result.output, /patch-data/)
  assert.match(result.output, /warning/)
})

test('cancelling an active command kills descendants before releasing its run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'parallax-cancel-'))
  const marker = join(dir, 'late-write.txt')
  const started = join(dir, 'started.txt')
  const child = join(dir, 'child.cjs')
  await writeFile(
    child,
    `require('node:fs').writeFileSync(${JSON.stringify(started)}, String(process.pid)); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'leaked'), 1000); setTimeout(() => {}, 10000);`,
  )
  const abort = new AbortController()
  const running = command(
    dir,
    process.execPath,
    [
      '-e',
      `require('node:child_process').spawn(process.execPath, [${JSON.stringify(child)}], {stdio: 'inherit'}); setTimeout(() => {}, 10000)`,
    ],
    abort.signal,
  )
  // Attach immediately so a test failure cannot leave an unhandled rejection.
  const stopped = assert.rejects(running, /cancelled/)
  for (let i = 0; i < 100; i++) {
    if (
      await access(started).then(
        () => true,
        () => false,
      )
    )
      break
    await delay(20)
  }
  const descendant = Number(await readFile(started, 'utf8'))
  abort.abort()
  await stopped
  assert.throws(() => process.kill(descendant, 0))
  await delay(1100)
  await assert.rejects(access(marker))
})
