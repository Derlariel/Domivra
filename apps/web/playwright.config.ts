import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173/login', reuseExistingServer: !process.env.CI, timeout: 60_000 },
})
