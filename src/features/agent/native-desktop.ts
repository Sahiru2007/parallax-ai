import { invoke, isTauri } from '@tauri-apps/api/core'

export const nativeTransport = () =>
  window.location.protocol === 'parallax:' || window.location.hostname === 'parallax.localhost'
export const nativeWindow = () => isTauri()
export const pickRepository = (initialPath?: string) =>
  invoke<string | null>('pick_repository', { initialPath })
export const openFrame = (path: string) => invoke<void>('open_frame', { path })
