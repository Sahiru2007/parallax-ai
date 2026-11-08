import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { dirname, resolve, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

// A reproducible resource tree, assembled from the lockfile's installed packages.
// No compilation/bundling of Node modules: Playwright and Vite retain their runtime assets.
const root = resolve(import.meta.dirname, '..')
const payload = join(root, 'src-tauri/resources/desktop')
const cache = join(root, 'artifacts/desktop/downloads')
await mkdir(payload, { recursive: true })
await mkdir(cache, { recursive: true })
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  )
async function download(url, path, sha) {
  if (!(await exists(path))) {
    const response = await fetch(url)
    if (!response.ok) throw Error(`Download failed (${response.status}): ${url}`)
    await writeFile(path, Buffer.from(await response.arrayBuffer()))
  }
  const actual = createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
  if (actual !== sha) throw Error(`Checksum mismatch for ${path}`)
}
const nodeVersion = '24.22.1'
const nodeZip = `node-v${nodeVersion}-win-x64.zip`
const nodeBase = `https://nodejs.org/dist/v${nodeVersion}`
const sums = await (await fetch(`${nodeBase}/SHASUMS256.txt`)).text()
const nodeSha = sums
  .split('\n')
  .find((line) => line.endsWith(`  ${nodeZip}`))
  ?.split(' ')[0]
if (!/^[a-f0-9]{64}$/.test(nodeSha ?? '')) throw Error('Official Node checksum not found')
await download(`${nodeBase}/${nodeZip}`, join(cache, nodeZip), nodeSha)
const gitZip = 'MinGit-2.56.0.4-64-bit.zip'
const gitSha = 'e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877'
await download(
  `https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/${gitZip}`,
  join(cache, gitZip),
  gitSha,
)
// Use environment parameters instead of shell-interpolated paths (spaces are expected).
function unzip(zip, destination) {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Expand-Archive -LiteralPath $env:PARALLAX_ZIP -DestinationPath $env:PARALLAX_UNZIP -Force',
    ],
    {
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, PARALLAX_ZIP: zip, PARALLAX_UNZIP: destination },
    },
  )
}
if (!(await exists(join(cache, `node-v${nodeVersion}-win-x64/node.exe`))))
  unzip(join(cache, nodeZip), cache)
await cp(join(cache, `node-v${nodeVersion}-win-x64`), join(payload, 'node'), { recursive: true })
if (!(await exists(join(payload, 'git/cmd/git.exe'))))
  unzip(join(cache, gitZip), join(payload, 'git'))

const copied = new Set()
async function copyPackage(name, parent = root) {
  let cursor = parent,
    source
  for (;;) {
    const candidate = join(cursor, 'node_modules', name)
    if (await exists(join(candidate, 'package.json'))) {
      source = candidate
      break
    }
    const next = dirname(cursor)
    if (next === cursor) break
    cursor = next
  }
  if (!source) throw Error(`Missing runtime dependency ${name} from ${parent}; run npm ci`)
  if (copied.has(source)) return
  copied.add(source)
  const destination = join(payload, relative(root, source))
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: (p) => !p.includes(`${join(source, 'node_modules')}`),
  })
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(pkg.dependencies ?? {}))
    await copyPackage(dependency, source)
  for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) {
    try {
      await copyPackage(dependency, source)
    } catch (error) {
      if (!String(error.message).startsWith('Missing runtime dependency')) throw error
    }
  }
}
for (const name of [
  '@playwright/test',
  'vite',
  '@vitejs/plugin-react',
  'react',
  'react-dom',
  'typescript',
  '@types/react',
  '@types/react-dom',
  '@types/node',
])
  await copyPackage(name)
for (const dir of ['runner', 'shared'])
  await cp(join(root, dir), join(payload, dir), { recursive: true })
await cp(join(root, 'dist'), join(payload, 'frontend'), { recursive: true })
await writeFile(join(payload, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
const seed = join(payload, 'demo-seed')
await mkdir(join(seed, 'runner'), { recursive: true })
await cp(join(root, 'fixtures'), join(seed, 'fixtures'), { recursive: true })
await cp(join(root, 'shared'), join(seed, 'shared'), { recursive: true })
await cp(join(root, 'runner/schedule.test.ts'), join(seed, 'runner/schedule.test.ts'))
await writeFile(
  join(seed, 'package.json'),
  JSON.stringify({ name: 'parallax-pickup-demo', private: true, type: 'module' }),
)
await writeFile(join(seed, '.gitignore'), 'node_modules/\nartifacts/\n')
await writeFile(
  join(seed, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'es2023',
      lib: ['ES2023', 'DOM'],
      module: 'esnext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      types: ['vite/client'],
    },
    include: ['fixtures'],
  }),
)
const browsers = JSON.parse(
  await readFile(join(root, 'node_modules/playwright-core/browsers.json'), 'utf8'),
)
const chromium = browsers.browsers.find((b) => b.name === 'chromium')
const headless = browsers.browsers.find((b) => b.name === 'chromium-headless-shell')
const browserRoot =
  process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.LOCALAPPDATA, 'ms-playwright')
for (const browser of [headless, browsers.browsers.find((b) => b.name === 'ffmpeg')]) {
  const name = `${browser.name.replaceAll('-', '_')}-${browser.revision}`
  await cp(join(browserRoot, name), join(payload, 'browsers', name), { recursive: true })
}
await writeFile(
  join(payload, 'runtime-manifest.json'),
  JSON.stringify(
    {
      node: { version: nodeVersion, sha256: nodeSha, url: `${nodeBase}/${nodeZip}` },
      git: { version: '2.56.0.4', sha256: gitSha },
      playwright: JSON.parse(
        await readFile(join(root, 'node_modules/playwright/package.json'), 'utf8'),
      ).version,
      chromium,
      packages: [...copied].map((p) => relative(root, p)),
    },
    null,
    2,
  ),
)
console.log(
  `Desktop resources prepared: ${copied.size} locked packages, Node, MinGit and pinned Playwright browsers.`,
)
