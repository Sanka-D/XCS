import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3100'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 3100',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      XCS_BROWSER_E2E: '1',
      NUXT_API_BASE_URL: `${baseURL}/__e2e-api`,
      NUXT_PUBLIC_API_BASE_URL: `${baseURL}/__e2e-api`,
      NUXT_PUBLIC_PROFILE_ID: 'xrpl-testnet-xcs-browser-e2e',
      NUXT_PUBLIC_RPC_URL: 'ws://127.0.0.1:1',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
