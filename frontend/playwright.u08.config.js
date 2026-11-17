/**
 * U08 browser check: the public /zeko-start/:token page, at desktop and phone width.
 *
 *   npm run build; npx playwright test -c playwright.u08.config.js
 *
 * Serves the built app with `vite preview` and mocks the /api/z/ endpoints, so
 * no backend, login or real Zeko booking is needed. Run from PowerShell: the
 * Bash sandbox blocks headless Edge.
 */
import { defineConfig } from '@playwright/test';

const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge';
const PORT = 4179;

export default defineConfig({
  testDir: './e2e',
  testMatch: /u08-zeko-start\.spec\.js$/,
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
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
