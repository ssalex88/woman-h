import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 30000,
  use: { baseURL: 'http://localhost:5173',
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    trace: 'retain-on-failure' },
})
