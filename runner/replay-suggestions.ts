import type { AppSuggestion } from '../shared/scenario-editor.ts'

// Inspect the immutable baseline only. Suggestions never start a command or consult a provider.
export function replaySuggestions(files: Map<string, Buffer>): AppSuggestion[] {
  const suggestions: AppSuggestion[] = []
  const defaults = { cwd: '.', origin: 'http://127.0.0.1:{PORT}', page: '/', readyPath: '/' }
  for (const [path, content] of [...files]
    .filter(([p]) => /(?:^|\/)package\.json$/.test(p))
    .slice(0, 12)) {
    if (content.length > 100000) continue
    try {
      const pkg = JSON.parse(content.toString())
      for (const name of ['dev', 'start', 'serve']) {
        const script = pkg.scripts?.[name]
        if (typeof script !== 'string') continue
        const vite = /^vite(?:\s|$)/.test(script) && !/\b(?:build|preview)\b/.test(script)
        const cwd = path === 'package.json' ? '.' : path.slice(0, -'/package.json'.length)
        suggestions.push({
          label: `npm run ${name}${cwd === '.' ? '' : ` in ${cwd}`}`,
          reason: `${path}: scripts.${name}. ${vite ? 'Vite accepts an isolated port; review existing flags.' : 'Confirm how this script accepts a port; its behavior has not been executed.'}`,
          app: {
            ...defaults,
            cwd,
            executable: 'npm',
            args: ['run', name, ...(vite ? ['--', '--host', '127.0.0.1', '--port', '{PORT}'] : [])],
          },
        })
      }
    } catch {
      /* Invalid manifests are not executable suggestions. */
    }
  }
  for (const [path, content] of [...files]
    .filter(([p]) => /\.(?:cjs|mjs|js)$/.test(p))
    .slice(0, 60)) {
    if (content.length > 200000) continue
    const code = content.toString()
    if (!/createServer|\.listen\s*\(/.test(code) || !/process\.argv\s*\[\s*2\s*\]/.test(code))
      continue
    suggestions.push({
      label: `Node app: ${path}`,
      reason: `Detected a server and process.argv[2] in ${path}. Port argument is a suggestion; confirm it before running.`,
      app: { ...defaults, executable: 'node', args: [path, '{PORT}'] },
    })
    if (suggestions.length >= 8) break
  }
  return suggestions.slice(0, 8)
}
