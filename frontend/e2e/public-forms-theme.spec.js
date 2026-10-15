/**
 * Public forms stay light under a dark saved theme (Phase 3 "Do Now", N31).
 *
 *   E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/public-forms-theme.spec.js
 *
 * The public token-link pages (candidate, approver, interviewer) are designed
 * light. Their own subtree was pinned light, but dropdowns, date pickers,
 * modals and toasts render on <body> and picked up the user's dark theme from
 * <html data-theme>. The links here carry dummy tokens: each page still
 * renders (its error state), which is enough to check the theme.
 */
import { test, expect } from '@playwright/test';

const PUBLIC_ROUTES = [
  '/missing-jd-upload?token=ZHVtbXlAZXhhbXBsZS5pbnZhbGlk',
  '/mrf-submit',
  '/mrf/1/approve?token=dummy',
  '/scorecard/00000000-0000-0000-0000-000000000000',
  '/documents/00000000-0000-0000-0000-000000000000',
];

test.use({ colorScheme: 'dark' });

test.beforeEach(async ({ page }) => {
  // The user's saved choice is DARK — the worst case for these pages.
  await page.addInitScript(() => {
    try { localStorage.setItem('ats_theme', 'dark'); } catch { /* ignore */ }
  });
});

/** Relative luminance-ish check: true for a light background colour. */
const isLight = (rgb) => {
  const [r, g, b] = (rgb.match(/\d+/g) || []).map(Number);
  return (r + g + b) / 3 > 180;
};

for (const route of PUBLIC_ROUTES) {
  test(`${route.split('?')[0]} is light before and after React mounts`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isLight(bodyBg) || bodyBg === 'rgba(0, 0, 0, 0)', `body background ${bodyBg}`).toBeTruthy();
  });
}

test('a portalled dropdown on the MRF form is light', async ({ page }) => {
  await page.goto('/mrf-submit');
  const select = page.locator('.ant-select').first();
  await expect(select).toBeVisible({ timeout: 30_000 });
  await select.click();
  const dropdown = page.locator('.ant-select-dropdown:visible').first();
  await expect(dropdown).toBeVisible();
  const bg = await dropdown.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(isLight(bg), `dropdown background ${bg}`).toBeTruthy();
});

test('the user\'s own dark theme is untouched on staff pages', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('#root')).not.toBeEmpty();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});
