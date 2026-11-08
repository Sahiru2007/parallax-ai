import { readFile } from 'node:fs/promises'
import { extname, resolve, relative, isAbsolute } from 'node:path'
import type { ServerResponse } from 'node:http'

export const desktopCsp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}
export async function desktopAsset(root: string, pathname: string, response: ServerResponse) {
  let path = decodeURIComponent(pathname)
  if (path === '/' || path === '/pickup' || path === '/legacy') path = '/index.html'
  const file = resolve(root, '.' + path)
  const rel = relative(root, file)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || path.includes('\\')) {
    response.writeHead(403)
    response.end('Invalid asset path.')
    return
  }
  try {
    const body = await readFile(file)
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': desktopCsp,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('Bundled asset not found.')
  }
}
