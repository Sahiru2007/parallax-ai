import { lstat, realpath, symlink, unlink } from 'node:fs/promises'

/** Rebind only the app-owned dependency junction when an install location changes. */
export async function linkDesktopDependencies(link: string, dependencies: string) {
  const existing = await lstat(link).catch(() => null)
  if (existing) {
    if (!existing.isSymbolicLink())
      throw new Error(
        `The demo dependency path is not an app-owned link. Move it aside and restart: ${link}`,
      )
    if ((await realpath(link).catch(() => null)) === (await realpath(dependencies))) return
    await unlink(link)
  }
  await symlink(dependencies, link, process.platform === 'win32' ? 'junction' : 'dir')
}
