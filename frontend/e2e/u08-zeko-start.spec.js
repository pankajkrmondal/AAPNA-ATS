/**
 * U08 browser check: the optional phone page between our Zeko email and Zeko.
 *
 *   npm run build; npx playwright test -c playwright.u08.config.js
 *
 * The /api/z/ endpoints are mocked (see the config); every other /api call
 * answers 401, which also proves a stale session does not bounce the candidate
 * to the login page. Set U08_SHOT_DIR to keep screenshots.
 */
import { test, expect } from '@playwright/test';

const SHOT = process.env.U08_SHOT_DIR;
const TOKEN = '3f2b9c1e-7a4d-4e2f-9b1a-0c5d6e7f8a9b';
const ZEKO_URL = 'https://zeko.example.test/interview/java-dev';
const OPEN = { state: 'open', firstName: 'Priya', role: 'Senior Java Developer', zekoUrl: ZEKO_URL };

/** Mocks the API; returns the phone POST bodies seen. */
async function mockApi(page, { info = OPEN, infoStatus = 200, phoneStatus = 200 } = {}) {
  const posts = [];
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes(`/api/z/${TOKEN}/info`)) {
      return route.fulfill({
        status: infoStatus,
        json: infoStatus === 200 ? { status: 'success', data: info } : { status: 'error', message: 'This interview link is not valid. Please use the link in your latest email from us.' },
      });
    }
    if (url.includes(`/api/z/${TOKEN}/phone`)) {
      posts.push(route.request().postDataJSON());
      return route.fulfill({
        status: phoneStatus,
        json: phoneStatus === 200 ? { status: 'success', data: { zekoUrl: ZEKO_URL, saved: true } } : { status: 'error', message: 'Enter a 10-digit Indian mobile number.' },
      });
    }
    return route.fulfill({ status: 401, json: { status: 'error', message: 'Not logged in' } });
  });
  // "Zeko" itself: a stub page, so leaving our site can be asserted.
  await page.route(`${ZEKO_URL}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>ZEKO STUB</h1>' }));
  return posts;
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('open link: optional phone copy, both buttons, no horizontal scroll at phone width', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/zeko-start/${TOKEN}`);
  await expect(page.getByText('Add a phone number so our team can reach you (optional)')).toBeVisible();
  await expect(page.getByText('Hi Priya,')).toBeVisible();
  await expect(page.getByText('Senior Java Developer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to Zeko' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  expect(page.url()).toContain('/zeko-start/');
  if (SHOT) await page.screenshot({ path: `${SHOT}/u08-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 375, height: 740 });
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  if (SHOT) await page.screenshot({ path: `${SHOT}/u08-phone.png`, fullPage: true });
});

test('Skip goes straight to Zeko without saving', async ({ page }) => {
  const posts = await mockApi(page);
  await page.goto(`/zeko-start/${TOKEN}`);
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'ZEKO STUB' })).toBeVisible();
  expect(posts).toEqual([]);
});

test('a bad number is caught on the page; a good one is saved, then Zeko opens', async ({ page }) => {
  const posts = await mockApi(page);
  await page.goto(`/zeko-start/${TOKEN}`);
  const input = page.locator('#zeko-phone');
  await input.fill('12345');
  await page.getByRole('button', { name: 'Continue to Zeko' }).click();
  await expect(page.locator('#zeko-phone-error')).toContainText('10-digit mobile number');
  expect(posts).toEqual([]);

  await input.fill('+91 91234 56780');
  await page.getByRole('button', { name: 'Continue to Zeko' }).click();
  await expect(page.getByRole('heading', { name: 'ZEKO STUB' })).toBeVisible();
  expect(posts).toEqual([{ phone: '+91 91234 56780' }]);
});

test('the server refusing the number keeps the candidate on the page with its reason', async ({ page }) => {
  await mockApi(page, { phoneStatus: 400 });
  await page.goto(`/zeko-start/${TOKEN}`);
  await page.locator('#zeko-phone').fill('9123456780');
  await page.getByRole('button', { name: 'Continue to Zeko' }).click();
  await expect(page.locator('#zeko-phone-error')).toContainText('Enter a 10-digit Indian mobile number.');
  await expect(page.getByRole('button', { name: 'Skip' })).toBeEnabled();
});

test('an expired link explains itself and offers no form', async ({ page }) => {
  await mockApi(page, { info: { state: 'expired', firstName: 'Priya', role: 'Senior Java Developer', zekoUrl: null } });
  await page.goto(`/zeko-start/${TOKEN}`);
  await expect(page.getByText('This interview link has expired')).toBeVisible();
  await expect(page.locator('#zeko-phone')).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 740 });
  expect(await noHorizontalScroll(page)).toBe(true);
  if (SHOT) await page.screenshot({ path: `${SHOT}/u08-expired-phone.png`, fullPage: true });
});

test('an unknown token shows Link unavailable', async ({ page }) => {
  await mockApi(page, { infoStatus: 404 });
  await page.goto(`/zeko-start/${TOKEN}`);
  await expect(page.getByText('Link unavailable').first()).toBeVisible();
  await expect(page.getByText('Please use the link in your latest email from us.')).toBeVisible();
  expect(page.url()).toContain('/zeko-start/');
});
