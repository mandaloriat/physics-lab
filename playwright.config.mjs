import { defineConfig, devices } from '@playwright/test';

/**
 * Points at a running deployment rather than starting one: the same suite is the smoke
 * test for `docker compose up` locally and for lab.andolfatto.eu in production.
 *
 *   BASE_URL=https://lab.andolfatto.eu npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8000',
    trace: 'retain-on-failure',
    // Normally Playwright manages its own browser download (`npx playwright install
    // chromium`, which is what CI does). CHROMIUM_PATH points it at an already-present
    // binary instead — for a sandbox or an air-gapped machine that has one.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
