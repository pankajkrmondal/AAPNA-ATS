/**
 * U01 browser check: the no-resume warning in the Schedule window.
 *
 *   $env:E2E_SESSION_EMAIL = '<your staff email>'; npx playwright test -c playwright.u01.config.js
 *
 * Needs the local stack (`npm run dev` here, the backend on :5000 against the
 * staging DB). Signs in with a short-lived session minted for that staff
 * account (e2e/helpers/u01-session-setup.js), deleted when the run ends. Run
 * from PowerShell: the Bash sandbox blocks headless Edge.
 */
import { defineConfig } from '@playwright/test';

const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: './e2e',
  testMatch: /u01-resume-warning\.spec\.js$/,
  globalSetup: './e2e/helpers/u01-session-setup.js',
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
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
