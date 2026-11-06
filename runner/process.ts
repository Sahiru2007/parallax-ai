import { spawn } from 'node:child_process'

export interface CommandResult {
  exitCode: number
  output: string
}
export async function command(
  cwd: string,
  executable: string,
  args: string[],
  signal?: AbortSignal,
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
    })
    let output = ''
    const collect = (data: Buffer) => {
      output = (output + data.toString()).slice(-150_000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const abort = () => {
      child.kill()
      reject(new Error('Investigation cancelled.'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(new Error('Investigation cancelled.'))
      else resolve({ exitCode: code ?? 1, output })
    })
  })
}
export async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const result = await command(cwd, 'git', args, signal)
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.output}`)
  return result.output.trimEnd()
}
