import { fixtureServer } from '../runner/replay.ts'
import { resolve } from 'node:path'
const worktree = resolve(process.env.PICKUP_WORKTREE ?? '.')
const fixture = await fixtureServer(worktree)
console.log(`Pickup fixture: ${fixture.url}\nPICKUP_BASE_URL=${fixture.url}`)
async function close() {
  await fixture.server.close()
  process.exit(0)
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
