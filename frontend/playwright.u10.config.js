/**
 * U10 browser check: Analytics → Completed forms, and the bell note's link.
 *
 *   npm run build; npx playwright test -c playwright.u10.config.js
 *
 * Serves the built app with `vite preview` and mocks every /api call (a fake
 * admin session included), so no backend or login is needed and nothing is
 * written. Run from PowerShell: the Bash sandbox blocks headless Edge.
 * Set U10_SHOT_DIR to keep screenshots.
 */
import { defineConfig } from '@playwright/test';

const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge';
const PORT = 4180;

export default defineConfig({
  testDir: './e2e',
  testMatch: /u10-completed-forms\.spec\.js$/,
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...(channel ? { channel } : {}),
    headless: process.env.E2E_HEADED !== '1',
    launchOptions: { args: ['--no-sandbox'] },
    viewport: { width: 1366, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
