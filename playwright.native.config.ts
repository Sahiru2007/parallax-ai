import { defineConfig } from '@playwright/test'

// Attach to the running Tauri WebView2; never substitute a browser-launched page.
export default defineConfig({
  testDir: './tests/native',
  workers: 1,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
})
