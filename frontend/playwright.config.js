/**
 * Playwright end-to-end suite (e2e/) — Candidate Screening strict filtering
 * (Phase 3 "Do Now", section A).
 *
 *   npm run e2e
 *
 * Runs against the dev server (`npm run dev`, which proxies /api to the backend
 * on :5000) unless E2E_BASE_URL points elsewhere. The backend must be running
 * with SCREENING_V2=true for the strict-filter assertions to hold.
 *
 * Credentials come from the environment — E2E_USER / E2E_PASSWORD — falling
 * back to the VERIFY_EMAIL / VERIFY_PASSWORD pair the frontend:verify skill
 * already keeps in .env.development. Never commit them.
 *
 * Uses the installed Microsoft Edge (channel 'msedge'), so no browser download
 * is needed. Set E2E_BROWSER_CHANNEL=chrome (or '' for bundled Chromium) to
 * change that.
 */
import { defineConfig } from '@playwright/test';
import { loadEnv } from 'vite';

const fileEnv = loadEnv('development', process.cwd(), '');
const pick = (...keys) => keys.map((k) => process.env[k] || fileEnv[k]).find(Boolean) || '';

process.env.E2E_USER ||= pick('E2E_USER', 'VERIFY_EMAIL');
process.env.E2E_PASSWORD ||= pick('E2E_PASSWORD', 'VERIFY_PASSWORD');

const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.js',
  // Searches hit one shared backend; JD search can take a while before the
  // N10 speed work, so run one test at a time with generous timeouts.
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    ...(channel ? { channel } : {}),
    headless: process.env.E2E_HEADED !== '1',
    storageState: 'e2e/.auth/state.json',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
