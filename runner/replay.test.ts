import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { replay } from './replay.ts'

test('browser startup failure is an execution error, never an assertion failure', async () => {
  const launch = mock.method(chromium, 'launch', async () => {
    throw new Error('Browser executable is unavailable (test double)')
  })
  try {
    const result = await replay({
      version: 'baseline',
      order: ['B', 'A'],
      url: 'http://127.0.0.1:1',
      artifactDir: 'artifacts/reliability/startup-failure',
      publicPrefix: '/frames',
      signal: new AbortController().signal,
    })
    assert.equal(result.status, 'error')
    assert.match(result.error!, /Browser executable is unavailable/)
    assert.deepEqual(result.events, [])
  } finally {
    launch.mock.restore()
  }
})
