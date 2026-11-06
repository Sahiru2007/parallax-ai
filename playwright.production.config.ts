import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/production',
  forbidOnly: !!process.env.CI,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:1421',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 1421 --strictPort',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: !process.env.CI,
  },
})
