/**
 * Screenshots for the business user guides (docs/user-guides/, N43).
 * VIEW-ONLY: opens pages, tabs, drawers and menus; runs one keyword search and
 * one JD search (reads). Nothing is created, edited, sent, shortlisted, moved
 * or closed, so it is safe on shared staging.
 *
 * Personal data never reaches an image: every API response is rewritten in the
 * browser first (helpers/maskData.js) — names, emails and phone numbers become
 * sample values.
 *
 *   E2E_SHOTS_DIR=../docs/user-guides/images npx playwright test e2e/user-guide-screenshots.spec.js
 *
 * Also writes each page's visible text next to its image (<name>.txt) when
 * E2E_DUMP_TEXT=1, which is how the guide's wording is checked against the
 * real screens. Signed in as the E2E user (a recruiter); admin screens need an
 * admin login (E2E_ADMIN_STATE = a saved storage state).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { maskApiResponses } from './helpers/maskData.js';

const SHOTS = process.env.E2E_SHOTS_DIR || 'test-results/user-guide';
mkdirSync(SHOTS, { recursive: true });

const settle = async (page, ms = 1200) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
};

async function capture(page, name, { fullPage = false, locator } = {}) {
  // JPEG at 80: a tenth of the PNG size, so a full set stays small in git.
  const opts = { path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 80 };
  if (locator) await locator.screenshot(opts);
  else await page.screenshot({ ...opts, fullPage });
  if (process.env.E2E_DUMP_TEXT === '1') {
    const text = await page.evaluate(() => document.body.innerText);
    writeFileSync(`${SHOTS}/${name}.txt`, text);
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await maskApiResponses(page);
});

test('dashboard', async ({ page }) => {
  await page.goto('/dashboard');
  await settle(page, 2500);
  await capture(page, 'recruiter-01-dashboard');
  await capture(page, 'recruiter-01b-dashboard-full', { fullPage: true });
});

test('mrf', async ({ page }) => {
  await page.goto('/mrf');
  await settle(page, 2000);
  await capture(page, 'recruiter-02-mrf-list');
  const firstRow = page.locator('.ant-table-tbody tr.ant-table-row').first();
  if (await firstRow.count()) {
    await firstRow.click();
    await settle(page);
    await capture(page, 'recruiter-02b-mrf-details');
  }
});

test('search candidate', async ({ page }) => {
  await page.goto('/candidates');
  await settle(page, 2000);
  await capture(page, 'recruiter-03-search-candidate');
});

test('hr upload', async ({ page }) => {
  await page.goto('/hr-upload');
  await settle(page, 1500);
  await capture(page, 'recruiter-04-hr-upload', { fullPage: true });
});

test('vendor upload (staff view)', async ({ page }) => {
  await page.goto('/vendor');
  await settle(page, 1500);
  await capture(page, 'recruiter-05-vendor-upload');
});

test('screening — keyword', async ({ page }) => {
  await page.goto('/filtering');
  await settle(page);
  await page.getByRole('tab', { name: 'Keyword Filtering' }).click();
  await settle(page, 600);
  await capture(page, 'recruiter-06-screening-keyword-form', { fullPage: true });
  await page.locator('#keyword-skills').fill('Java');
  const done = page.waitForResponse((r) => r.url().includes('/screening/keyword-search') && r.request().method() === 'POST', { timeout: 180000 });
  await page.getByRole('button', { name: 'Search Candidates' }).click();
  await done.catch(() => {});
  await settle(page, 2500);
  await page.getByText(/\d+ matched/).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.mouse.wheel(0, 300);
  await settle(page, 800);
  await capture(page, 'recruiter-06b-screening-keyword-results');
});

test('screening — JD', async ({ page }) => {
  await page.goto('/filtering');
  await settle(page);
  await page.getByRole('tab', { name: 'JD Filtering' }).click();
  await settle(page, 1000);
  await capture(page, 'recruiter-07-screening-jd');

  // Open the first open role the way the JD specs do: the page restores the
  // selected role from localStorage on load.
  const token = await page.evaluate(() => localStorage.getItem('ats_token'));
  const res = await page.request.get('/api/screening/roles', { headers: { Authorization: `Bearer ${token}` } });
  const body = res.ok() ? await res.json() : null;
  const roles = body?.data?.roles || body?.data || [];
  const roleId = (Array.isArray(roles) ? roles : []).map((r) => r.id ?? r.mrf_id).find(Boolean);
  test.skip(!roleId, 'no open role');
  await page.evaluate((id) => {
    localStorage.setItem('screening_active_tab', 'jd');
    localStorage.setItem('screening_selected_role', String(id));
  }, roleId);
  const done = page.waitForResponse((r) => r.url().includes(`/screening/roles/${roleId}/search`) && r.request().method() === 'POST', { timeout: 240000 });
  await page.goto('/filtering');
  await done.catch(() => {});
  await settle(page, 3000);
  await capture(page, 'recruiter-07b-screening-jd-results');
});

test('pipeline board, legend and drawer', async ({ page }) => {
  await page.goto('/pipeline');
  await page.locator('[data-testid^="card-status-"]').first().waitFor({ timeout: 60000 }).catch(() => {});
  await settle(page, 1500);
  await capture(page, 'recruiter-08-pipeline-board');
  const legendBtn = page.getByTestId('board-legend-button');
  if (await legendBtn.count()) {
    await legendBtn.click();
    await settle(page, 500);
    await capture(page, 'recruiter-08b-pipeline-legend');
    await page.keyboard.press('Escape');
  }
  const card = page.locator('[data-testid^="card-status-"]').first();
  if (await card.count()) {
    await card.click();
    await page.locator('.ant-drawer .ant-spin-spinning').first().waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
    await settle(page, 2000);
    await capture(page, 'recruiter-08c-pipeline-drawer');
    const tabs = page.locator('.ant-drawer .ant-tabs-tab');
    const n = await tabs.count();
    for (let i = 1; i < Math.min(n, 6); i += 1) {
      const label = (await tabs.nth(i).innerText()).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await tabs.nth(i).click();
      await settle(page, 1000);
      await capture(page, `recruiter-08d-drawer-${label}`);
    }
  }
});

test('analytics', async ({ page }) => {
  await page.goto('/analytics');
  await settle(page, 2500);
  await capture(page, 'recruiter-09-analytics');
  const tabs = page.locator('.ant-tabs-nav .ant-tabs-tab');
  const n = await tabs.count();
  for (let i = 1; i < n; i += 1) {
    const label = (await tabs.nth(i).innerText()).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await tabs.nth(i).click();
    await settle(page, 1500);
    await capture(page, `recruiter-09-analytics-${label}`);
  }
});

test('email templates', async ({ page }) => {
  await page.goto('/email');
  await page.getByText('Loading templates...').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
  await settle(page, 1500);
  // Open the first template so the editor and preview show.
  await page.getByText(/Shortlist/).first().click().catch(() => {});
  await settle(page, 1500);
  await capture(page, 'recruiter-10-email-templates');
});

test('settings', async ({ page }) => {
  await page.goto('/settings');
  await settle(page, 2000);
  await capture(page, 'recruiter-11-settings', { fullPage: true });
});

test('error message with a ref (illustration)', async ({ page }) => {
  // A fake 500 on a keyword search shows how a server error reads to HR.
  // Nothing reaches the server: the request is answered in the browser.
  await page.route('**/api/screening/keyword-search', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    headers: { 'x-request-id': 'K7Q2MX', 'access-control-expose-headers': 'x-request-id' },
    body: JSON.stringify({ status: 'error', message: 'Something went wrong. Please try again later.', ref: 'K7Q2MX' }),
  }));
  await page.goto('/filtering');
  await settle(page);
  await page.getByRole('tab', { name: 'Keyword Filtering' }).click();
  await page.locator('#keyword-skills').fill('Java');
  await page.getByRole('button', { name: 'Search Candidates' }).click();
  await page.locator('.ant-message-notice').first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await capture(page, 'common-error-with-ref');
});
