/**
 * Signs in once through the real Login page and saves the session
 * (localStorage ats_token / ats_user) for every spec to reuse.
 *
 * Login goes through the UI rather than the API on purpose: the submit button
 * stays disabled until Turnstile issues a token (dev uses Cloudflare's
 * always-pass test key), and the API rejects a missing token whenever the
 * backend has a Turnstile secret configured.
 */
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

export const STATE_PATH = 'e2e/.auth/state.json';

export default async function globalSetup(config) {
  const { baseURL, channel } = config.projects[0].use;
  const user = process.env.E2E_USER;
  const password = process.env.E2E_PASSWORD;
  if (!user || !password) {
    throw new Error('Set E2E_USER and E2E_PASSWORD (or VERIFY_EMAIL / VERIFY_PASSWORD in .env.development).');
  }

  mkdirSync('e2e/.auth', { recursive: true });
  const browser = await chromium.launch(channel ? { channel } : {});
  const page = await browser.newPage({ baseURL });
  try {
    await page.goto('/');
    await page.getByPlaceholder('Enter username or email').fill(user);
    await page.getByPlaceholder('Enter password').fill(password);
    const submit = page.locator('form[id="login"] button[type="submit"], button[type="submit"]').first();
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await submit.click();
    await page.waitForURL(/\/(dashboard|vendor-dashboard)/, { timeout: 60_000 });
    await page.context().storageState({ path: STATE_PATH });
  } finally {
    await browser.close();
  }
}
