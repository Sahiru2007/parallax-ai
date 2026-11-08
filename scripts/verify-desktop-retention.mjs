import { readFile, writeFile, readdir, lstat, access } from 'node:fs/promises'
import { join, resolve, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { WindowsCredentialStore } from '../runner/credentials.ts'
const installed = process.env.PARALLAX_INSTALLED_EXE,
  installer = process.env.PARALLAX_INSTALLER
if (!installed || !installer) throw Error('Set PARALLAX_INSTALLED_EXE and PARALLAX_INSTALLER.')
const controlled = JSON.parse(await readFile('artifacts/desktop/latest.json', 'utf8'))
const settings = JSON.parse(await readFile('artifacts/desktop/settings-latest.json', 'utf8'))
const live = JSON.parse(await readFile('artifacts/desktop/gemini-latest.json', 'utf8'))
const allowed = resolve(process.env.LOCALAPPDATA, 'dev.parallax-ai.desktop')
const roots = [controlled.data, settings.data, live.data]
for (const root of roots) {
  const part = relative(allowed, resolve(root))
  if (!/^verification-(?:settings-|live-)?[a-f0-9-]{36}$/.test(part))
    throw Error('Verification data path is outside its owned profile.')
}
if (!/^PARALLAX AI\/Test\/[a-f0-9-]{36}$/.test(settings.target))
  throw Error('Only the verification credential namespace is allowed.')
const stores = [
  new WindowsCredentialStore(settings.target),
  new WindowsCredentialStore(settings.target + '/Gemini'),
]
const secrets = await Promise.all(stores.map((store) => store.get()))
async function snapshot() {
  const result = {}
  for (const root of roots) {
    async function walk(path) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (
          ['webview', 'node_modules'].includes(entry.name) ||
          /^runner-\d+\.json$/.test(entry.name)
        )
          continue
        const file = join(path, entry.name),
          stat = await lstat(file)
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory()) await walk(file)
        else if (stat.isFile())
          result[file] = createHash('sha256')
            .update(await readFile(file))
            .digest('hex')
      }
    }
    await walk(root)
  }
  return result
}
const before = await snapshot()
const uninstall = join(dirname(installed), 'uninstall.exe')
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "if (Get-Process parallax-ai -ErrorAction SilentlyContinue) { throw 'Close Parallax before uninstall verification.' }; $p=Start-Process -FilePath $env:PARALLAX_UNINSTALL -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode",
  ],
  { windowsHide: true, stdio: 'inherit', env: { ...process.env, PARALLAX_UNINSTALL: uninstall } },
)
const after = await snapshot()
for (const [path, hash] of Object.entries(before))
  if (after[path] !== hash) throw Error('Saved verification data changed during uninstall: ' + path)
const vaultRetained = (await Promise.all(stores.map((store) => store.get()))).every(
  (value, i) => value === secrets[i] && value !== null,
)
if (!vaultRetained) throw Error('Verification credentials were not retained.')
const exeRemoved = await access(installed).then(
  () => false,
  () => true,
)
const shortcut = join(
  process.env.APPDATA,
  'Microsoft/Windows/Start Menu/Programs/PARALLAX AI/PARALLAX AI.lnk',
)
const shortcutRemoved = await access(shortcut).then(
  () => false,
  () => true,
)
if (!exeRemoved || !shortcutRemoved) throw Error('Uninstall left its executable or Start shortcut.')
await writeFile(
  'artifacts/desktop/uninstall-retention-proof.json',
  JSON.stringify(
    {
      roots,
      filesVerified: Object.keys(before).length,
      exactDataRetained: true,
      verificationCredentialsRetained: vaultRetained,
      exeRemoved,
      shortcutRemoved,
      mode: 'Silent uninstall: default retain app data; no user data deletion requested.',
    },
    null,
    2,
  ),
)
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$p=Start-Process -FilePath $env:PARALLAX_SETUP -ArgumentList @(\'/S\',("/D="+$env:PARALLAX_INSTALL_DIR)) -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode',
  ],
  {
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, PARALLAX_SETUP: installer, PARALLAX_INSTALL_DIR: dirname(installed) },
  },
)
await access(installed)
await access(shortcut)
console.log(
  `Uninstall retained ${Object.keys(before).length} saved files and both verification credentials. Final installer reinstalled successfully.`,
)
