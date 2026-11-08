import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { desktopAsset, desktopCsp } from './desktop-http.ts'
import { command } from './process.ts'

test('desktop serves only bundled files with CSP, MIME types and SPA entry routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'parallax-desktop-assets-'))
  await writeFile(join(root, 'index.html'), '<main>Bundled production</main>')
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'assets/app.js'), 'export const bundled=true')
  const server = createServer((request, response) => {
    void desktopAsset(root, request.url!, response)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No port')
  const base = `http://127.0.0.1:${address.port}`
  try {
    for (const path of ['/', '/pickup', '/legacy']) {
      const response = await fetch(base + path)
      assert.equal(await response.text(), '<main>Bundled production</main>')
      assert.equal(response.headers.get('content-security-policy'), desktopCsp)
    }
    const script = await fetch(base + '/assets/app.js')
    assert.equal(script.headers.get('content-type'), 'text/javascript')
    assert.equal((await fetch(base + '/missing')).status, 404)
    assert.equal((await fetch(base + '/%2e%2e%5csecret')).status, 403)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    // This exact mkdtemp directory was created by this test only.
    await rm(root, { recursive: true, force: true })
  }
})

test('project commands cannot inherit the native bootstrap secret or ready file', async () => {
  const previous = {
    secret: process.env.PARALLAX_DESKTOP_SECRET,
    ready: process.env.PARALLAX_DESKTOP_READY,
  }
  process.env.PARALLAX_DESKTOP_SECRET = 'desktop-bootstrap-test-secret'
  process.env.PARALLAX_DESKTOP_READY = 'private-native-ready-file'
  try {
    const result = await command(process.cwd(), process.execPath, [
      '-e',
      'process.stdout.write(JSON.stringify([process.env.PARALLAX_DESKTOP_SECRET,process.env.PARALLAX_DESKTOP_READY]))',
    ])
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, '[null,null]')
  } finally {
    if (previous.secret === undefined) delete process.env.PARALLAX_DESKTOP_SECRET
    else process.env.PARALLAX_DESKTOP_SECRET = previous.secret
    if (previous.ready === undefined) delete process.env.PARALLAX_DESKTOP_READY
    else process.env.PARALLAX_DESKTOP_READY = previous.ready
  }
})
