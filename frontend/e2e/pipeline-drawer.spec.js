/**
 * Pipeline drawer open/close stability (Phase 3 "Do Now", N30).
 *
 *   E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/pipeline-drawer.spec.js
 *
 * Bug: closing the candidate pop-up could blank the whole page. These runs
 * open and close the drawer repeatedly — immediately, mid-load, and with the
 * outcome dialog (and its email editor iframe) open — and fail on any page
 * error, any React error in the console, or a board that is no longer there.
 *
 * Needs at least one live journey on the board (the backend test fixture or
 * any real candidate).
 */
import { test, expect } from '@playwright/test';

const CYCLES = Number(process.env.E2E_DRAWER_CYCLES || 20);

/** Collects uncaught page errors and console errors for the whole test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Network noise from the local stack (no Redis/Graph/Zeko) is not the bug,
    // and neither are antd's own deprecation notices.
    if (/Failed to load resource|ERR_CONNECTION_REFUSED|status of (4|5)\d\d/.test(text)) return;
    if (/^Warning: \[antd: /.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function openBoard(page) {
  await page.goto('/pipeline');
  await expect(page.locator('.cp-candidate-card').first()).toBeVisible({ timeout: 60_000 });
}

/** The board is still rendered: header text plus at least one card. */
async function expectBoardAlive(page) {
  await expect(page.locator('.cp-candidate-card').first()).toBeVisible();
  const rootText = await page.locator('#root').innerText();
  expect(rootText.trim().length, 'page went blank').toBeGreaterThan(50);
}

// OPEN drawers only: since N30 the drawer slides out with its content, so a
// closing drawer is still in the DOM (and visible) for the animation.
const drawer = (page) => page.locator('.ant-drawer-open .ant-drawer-content-wrapper:visible');

async function closeDrawer(page) {
  await drawer(page).locator('.ant-drawer-close').click();
  await expect(drawer(page)).toHaveCount(0);
}

test.describe('N30 pipeline drawer', () => {
  test(`open and close ${CYCLES}x, after the detail has loaded`, async ({ page }) => {
    const errors = watchErrors(page);
    await openBoard(page);
    const cards = page.locator('.cp-candidate-card');
    const n = await cards.count();
    for (let i = 0; i < CYCLES; i += 1) {
      await cards.nth(i % n).click();
      await expect(drawer(page)).toBeVisible();
      await expect(drawer(page).locator('.ant-drawer-title')).not.toBeEmpty();
      await closeDrawer(page);
      await expectBoardAlive(page);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test(`open and close ${CYCLES}x while the detail is still loading`, async ({ page }) => {
    const errors = watchErrors(page);
    await openBoard(page);
    const cards = page.locator('.cp-candidate-card');
    const n = await cards.count();
    for (let i = 0; i < CYCLES; i += 1) {
      await cards.nth(i % n).click();
      await drawer(page).locator('.ant-drawer-close').click();
      await expect(drawer(page)).toHaveCount(0);
      await expectBoardAlive(page);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('closing with the outcome dialog and email editor open', async ({ page }) => {
    const errors = watchErrors(page);
    await openBoard(page);
    const cards = page.locator('.cp-candidate-card');
    const n = await cards.count();
    for (let i = 0; i < Math.min(CYCLES, 8); i += 1) {
      await cards.nth(i % n).click();
      await expect(drawer(page)).toBeVisible();
      const approve = drawer(page).getByRole('button', { name: 'Approve' }).first();
      if (await approve.isVisible().catch(() => false)) {
        await approve.click();
        const dialog = page.locator('.ant-modal:visible');
        await expect(dialog).toBeVisible();
        // Leave the dialog as the user would — Escape. antd's Escape can take the
        // drawer down with it; when it does not, close the drawer at once.
        await page.keyboard.press('Escape');
      }
      if (await drawer(page).count()) await closeDrawer(page);
      await expect(drawer(page)).toHaveCount(0);
      await expectBoardAlive(page);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('deep link with ?candidate= then close', async ({ page }) => {
    const errors = watchErrors(page);
    // Clicking a card does not write ?candidate= — only bell links and
    // "Copy link" do — so take a journey id from the board's own API response.
    const boardResponse = page.waitForResponse((r) => /\/api\/pipeline(\?|$)/.test(r.url()) && r.request().method() === 'GET');
    await openBoard(page);
    const body = await (await boardResponse).json();
    const firstCard = (body.data?.columns || []).flatMap((c) => c.cards || [])[0];
    expect(firstCard, 'no journey on the board').toBeTruthy();
    const url = `/pipeline?candidate=${firstCard.id}`;
    for (let i = 0; i < 5; i += 1) {
      await page.goto(url);
      await expect(drawer(page)).toBeVisible({ timeout: 60_000 });
      await closeDrawer(page);
      await expectBoardAlive(page);
      expect(page.url()).not.toContain('candidate=');
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
