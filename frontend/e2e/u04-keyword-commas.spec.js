/**
 * U04 browser check: commas in Skills and Location, the All / Any skills
 * choice, and the parsed-terms chips in the summary bar.
 *
 *   $env:E2E_SESSION_EMAIL = '<your staff email>'; npx playwright test -c playwright.u04.config.js
 *
 * Needs the local stack (Vite here, the backend on :5000 with SCREENING_V2=true).
 * Searches only: nothing is written or sent.
 */
import { test, expect } from '@playwright/test';
import { openScreening, formItem } from './helpers/screening.js';

const SHOT = process.env.U04_SHOT_DIR;

test('commas split skills and cities; All / Any is explicit; parsed terms are shown', async ({ page }) => {
  await openScreening(page, 'keyword');

  // All / Any: a Segmented control, All by default.
  const mode = page.getByTestId('skill-match-mode');
  await expect(mode.locator('.ant-segmented-item-selected')).toHaveText('All skills');
  await mode.getByText('Any skill', { exact: true }).click();
  await expect(mode.locator('.ant-segmented-item-selected')).toHaveText('Any skill');

  await page.locator('#keyword-skills').fill('Java, Python');

  // "Noida," is committed as a tag by the comma; "Delhi" is left half-typed
  // (no Enter, no comma) when Search is pressed — it must not be lost.
  const city = formItem(page, 'Location').locator('input');
  await city.pressSequentially('Noida,');
  await city.pressSequentially('Delhi');

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/screening/keyword-search') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Search Candidates' }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);

  const sent = response.request().postDataJSON();
  expect(sent.matchMode).toBe('any');
  expect(String(sent.location).split(',').map((s) => s.trim().toLowerCase())).toEqual(['noida', 'delhi']);

  const { summary } = (await response.json()).data;
  expect(summary.terms).toEqual({ skills: ['java', 'python'], location: ['noida', 'delhi'], matchMode: 'any' });

  const skills = page.getByTestId('search-terms-skills');
  await expect(skills).toContainText('Skills (any):');
  await expect(skills.locator('.ant-tag')).toHaveText(['java', 'python']);
  const location = page.getByTestId('search-terms-location');
  await expect(location).toContainText('Location (any):');
  await expect(location.locator('.ant-tag')).toHaveText(['noida', 'delhi']);

  if (SHOT) {
    await page.locator('.screening-filter').screenshot({ path: `${SHOT}/u04-form.png` });
    await page.locator('.screening-summary-bar').screenshot({ path: `${SHOT}/u04-summary.png` });
  }

  // Clear puts the choice back to All.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(mode.locator('.ant-segmented-item-selected')).toHaveText('All skills');
});
