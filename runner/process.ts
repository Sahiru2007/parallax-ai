import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

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
  options: { timeoutMs?: number; onOutput?: (text: string) => void } = {},
): Promise<CommandResult> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const environment = { ...process.env }
    delete environment.OPENAI_API_KEY
    delete environment.PARALLAX_MODEL
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    let output = ''
    let stdout = '',
      stderr = ''
    const outDecoder = new StringDecoder('utf8'),
      errDecoder = new StringDecoder('utf8')
    const collect = (channel: 'stdout' | 'stderr', text: string) => {
      if (!text) return
      output = (output + text).slice(-150_000)
      if (channel === 'stdout') stdout = (stdout + text).slice(-150_000)
      else stderr = (stderr + text).slice(-150_000)
      options.onOutput?.(text)
    }
    child.stdout.on('data', (data) => collect('stdout', outDecoder.write(data)))
    child.stderr.on('data', (data) => collect('stderr', errDecoder.write(data)))
    child.stdout.on('end', () => collect('stdout', outDecoder.end()))
    child.stderr.on('end', () => collect('stderr', errDecoder.end()))
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
  const result = await command(cwd, 'git', args, signal)
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.output}`)
  return (result.stdout ?? result.output).trimEnd()
}
