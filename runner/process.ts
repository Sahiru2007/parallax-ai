import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { rememberSecret, secretStream } from './provider-secrets.ts'

export interface CommandResult {
  exitCode: number
  output: string
  stdout?: string
  stderr?: string
}
export class CommandFailure extends Error {
  code: 'cancelled' | 'timeout'
  output: string
  constructor(message: string, code: 'cancelled' | 'timeout', output: string) {
    super(message)
    this.code = code
    this.output = output
  }
}
export async function command(
  cwd: string,
  executable: string,
  args: string[],
  signal?: AbortSignal,
  options: {
    timeoutMs?: number
    onOutput?: (text: string) => void
    onSpawn?: (pid: number) => void
  } = {},
): Promise<CommandResult> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const environment = { ...process.env }
    delete environment.NODE_TEST_CONTEXT
    rememberSecret(environment.OPENAI_API_KEY)
    rememberSecret(environment.GEMINI_API_KEY)
    rememberSecret(environment.GOOGLE_API_KEY)
    delete environment.OPENAI_API_KEY
    delete environment.GEMINI_API_KEY
    delete environment.GOOGLE_API_KEY
    delete environment.PARALLAX_GEMINI_TEST_URL
    delete environment.PARALLAX_MODEL
    delete environment.PARALLAX_OPENAI_TEST_URL
    delete environment.PARALLAX_DESKTOP_SECRET
    delete environment.PARALLAX_DESKTOP_READY
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    if (child.pid) options.onSpawn?.(child.pid)
    let output = ''
    let stdout = '',
      stderr = ''
    const outDecoder = new StringDecoder('utf8'),
      errDecoder = new StringDecoder('utf8')
    const outSecrets = secretStream(),
      errSecrets = secretStream()
    const collect = (channel: 'stdout' | 'stderr', text: string) => {
      if (!text) return
      output = (output + text).slice(-150_000)
      if (channel === 'stdout') stdout = (stdout + text).slice(-150_000)
      else stderr = (stderr + text).slice(-150_000)
      options.onOutput?.(text)
    }
    child.stdout.on('data', (data) => collect('stdout', outSecrets(outDecoder.write(data))))
    child.stderr.on('data', (data) => collect('stderr', errSecrets(errDecoder.write(data))))
    child.stdout.on('end', () => collect('stdout', outSecrets(outDecoder.end(), true)))
    child.stderr.on('end', () => collect('stderr', errSecrets(errDecoder.end(), true)))
    let failure: CommandFailure | undefined
    let stopping: Promise<void> | undefined
    const stop = (code: 'cancelled' | 'timeout') => {
      if (failure) return
      failure = new CommandFailure(
        code === 'timeout'
          ? `Command timed out after ${options.timeoutMs ?? 120_000} ms.`
          : 'Investigation cancelled.',
        code,
        '',
      )
      // Do not release the run lock until the process tree and its pipes have closed.
      stopping = new Promise<void>((done) => {
        if (!child.pid) return done()
        if (process.platform === 'win32') {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          })
          killer.once('error', () => {
            child.kill()
            done()
          })
          killer.once('close', () => {
            child.kill()
            done()
          })
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {
            child.kill('SIGKILL')
          }
          done()
        }
      })
    }
    const abort = () => stop('cancelled')
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs ?? 120_000)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.on('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', async (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      await stopping
      if (failure) {
        failure.output = output
        reject(failure)
      } else resolve({ exitCode: code ?? 1, output, stdout, stderr })
    })
  })
}
export async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const argv = process.platform === 'win32' ? ['-c', 'core.longpaths=true', ...args] : args
  const result = await command(cwd, 'git', argv, signal)
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.output}`)
  return (result.stdout ?? result.output).trimEnd()
}
