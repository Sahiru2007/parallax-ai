import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export interface CredentialStore {
  available: boolean
  get(): Promise<string | null>
  set(value: string): Promise<void>
  remove(): Promise<void>
}
export class WindowsCredentialStore implements CredentialStore {
  available = process.platform === 'win32'
  target: string
  constructor(target = 'PARALLAX AI/OpenAI') {
    this.target = target
  }
  private async call(operation: string, value?: string): Promise<{ value?: string | null }> {
    if (!this.available)
      throw new Error(
        'Saving API keys requires Windows Credential Manager. Environment variables remain supported for development.',
      )
    return new Promise((resolve, reject) => {
      // ExecutionPolicy is scoped to this helper process; no machine/user policy is changed.
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-File',
          fileURLToPath(new URL('./windows-credentials.ps1', import.meta.url)),
        ],
        {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            SystemRoot: process.env.SystemRoot,
            PATH: process.env.PATH,
            TEMP: process.env.TEMP,
          },
        },
      )
      let output = ''
      const timer = setTimeout(() => child.kill(), 15000)
      child.stdout.on('data', (chunk) => {
        output += String(chunk)
      })
      child.stderr.on('data', () => {})
      child.stdin.on('error', () => {})
      child.once('error', () => {
        clearTimeout(timer)
        reject(new Error('Windows Credential Manager helper could not start.'))
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        if (code !== 0)
          return reject(
            new Error(
              'Windows Credential Manager operation failed. No plaintext fallback is used.',
            ),
          )
        try {
          resolve(JSON.parse(output.replace(/^\uFEFF/, '')))
        } catch {
          reject(new Error('Windows Credential Manager returned an invalid result.'))
        }
      })
      child.stdin.end(JSON.stringify({ operation, target: this.target, value }))
    })
  }
  async get() {
    return (await this.call('get')).value ?? null
  }
  async set(value: string) {
    await this.call('set', value)
  }
  async remove() {
    await this.call('remove')
  }
}
