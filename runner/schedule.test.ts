import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXPECTED_ITEMS, parseSchedule, queryToId, scenario } from '../shared/scenario.ts'

test('both schedules preserve the same actions, payloads, and final assertion', () => {
  for (const order of [
    ['A', 'B'],
    ['B', 'A'],
  ]) {
    assert.deepEqual(new Set(parseSchedule(order)), new Set(['A', 'B']))
    assert.deepEqual(EXPECTED_ITEMS, scenario.B.items)
  }
  assert.equal(queryToId('Col'), 'A')
  assert.equal(queryToId('Colombo'), 'B')
})
test('impossible or incomplete schedules are rejected explicitly', () => {
  for (const order of [null, [], ['A'], ['A', 'A'], ['A', 'B', 'A'], ['B', 'C']]) {
    assert.throws(() => parseSchedule(order), /cannot be executed/)
  }
})
