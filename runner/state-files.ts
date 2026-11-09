import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

// Windows scanners/readers can briefly deny replacement of an existing file.
// Retry only sharing errors. Never delete the last acknowledged state as a fallback.
export async function replaceStateFile(
  source: string,
  target: string,
  replace = rename,
  platform: string = process.platform,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await replace(source, target)
      return
    } catch (error) {
      if (
        platform !== 'win32' ||
        attempt >= 5 ||
        !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')
      )
        throw error
      await delay(10 * 2 ** attempt)
    }
  }
}
