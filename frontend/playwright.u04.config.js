/**
 * U04 browser check: commas in keyword Skills and Location.
 *
 *   $env:E2E_SESSION_EMAIL = '<your staff email>'; npx playwright test -c playwright.u04.config.js
 *
 * Same session handling as playwright.u01.config.js (a short-lived staff
 * session, deleted when the run ends). Run from PowerShell: the Bash sandbox
 * blocks headless Edge.
 */
import { defineConfig } from '@playwright/test';

const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: './e2e',
  testMatch: /u04-keyword-commas\.spec\.js$/,
  globalSetup: './e2e/helpers/u01-session-setup.js',
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    ...(channel ? { channel } : {}),
    headless: process.env.E2E_HEADED !== '1',
    launchOptions: { args: ['--no-sandbox'] },
    storageState: 'e2e/.auth/u01-state.json',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
