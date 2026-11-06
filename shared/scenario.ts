import type { RequestId, Schedule } from './investigation.ts'

export const scenario = {
  A: { query: 'Col', items: ['Colpetty Market', 'College Avenue', 'Colombo 03 Post Office'] },
  B: {
    query: 'Colombo',
    items: ['Colombo Fort Railway Station', 'Colombo City Centre', 'Colombo National Hospital'],
  },
} as const
export const EXPECTED_ITEMS = [...scenario.B.items]
export function parseSchedule(value: unknown): Schedule {
  if (!Array.isArray(value) || value.length !== 2 || !value.includes('A') || !value.includes('B')) {
    throw new Error(
      'Schedule must contain A and B exactly once. The requested schedule cannot be executed.',
    )
  }
  return [...value] as Schedule
}
export const queryToId = (query: string): RequestId => {
  if (query === scenario.A.query) return 'A'
  if (query === scenario.B.query) return 'B'
  throw new Error(`Unexpected request query: ${query}`)
}
