import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/coding',
  workers: 1,
  outputDir: './artifacts/coding-browser-results',
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1500, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
