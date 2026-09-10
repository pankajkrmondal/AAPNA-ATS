/**
 * Design-lab vs real app parity.
 *
 * WHY THIS EXISTS
 * The lab's applied screens are hand-built mocks that duplicate the structure of real
 * routes, so they can always drift from what actually ships — and they did. A review
 * found `/dashboard` rendering 16px card corners against the lab's 24px, because
 * `aurora-glass.css` sets `--radius-card: 16px` on `.ats-v2` and a converted route sits
 * inside that element. Nothing caught it: build, lint and every other check passed,
 * because the page rendered perfectly, just wrong.
 *
 * WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
 * Design TOKENS as they land on real elements: radius, type sizes, control height,
 * padding, band height. A mock is allowed to show different content, different data,
 * even a different arrangement — it is NOT allowed to be styled differently. Asserting
 * layout would make the check fail every time a mock legitimately diverged, and a check
 * that cries wolf gets deleted.
 *
 * CREDENTIALS
 * The real dashboard is auth-gated, so this needs a login. It reads VERIFY_EMAIL /
 * VERIFY_PASSWORD from frontend/.env.development and SKIPS with a clear message when
 * they are absent — someone without credentials should not see a red suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChromium, openWith, BASE, Report, credentials } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.resolve(HERE, '../../.env.development');

/**
 * The properties compared. Each is read off a REAL element rather than off
 * `:root`, because the whole failure mode here is a token resolving correctly at the
 * root and being overridden further down the tree.
 */
const PROBE = () => {
  const style = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  };
  const height = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  };
  return {
    'stat card radius': style('.ui-stat-card', 'borderRadius'),
    'surface radius': style('.ui-surface', 'borderRadius'),
    'stat padding': style('.ui-stat', 'padding'),
    'stat value size': style('.ui-stat__value', 'fontSize'),
    'stat label size': style('.ui-stat__label', 'fontSize'),
    'sparkline band height': String(height('.ui-stat-band')),
    'hero title size': style('.ui-page-header__title', 'fontSize'),
    'hero radius': style('.ui-hero', 'borderRadius'),
    'button radius': style('.ui-btn', 'borderRadius'),
    'button height': style('.ui-btn', 'height'),
    'body font': (style('body', 'fontFamily') || '').split(',')[0].replace(/['"]/g, ''),
  };
};

/* `font` tracks theme/fonts.js's DEFAULT_FONT_PACK_ID (inter-sora since 2026-08-31). It
   pins BOTH sides, so a stale value here keeps passing while quietly testing a font the
   app no longer ships — the failure mode is blindness, not a red row. Move it with the
   default. */
const AXES = { theme: 'light', preset: 'liquid-glass', font: 'inter-sora', density: 'default' };

export default async function run() {
  const report = new Report('Design-lab / app parity');
  const creds = credentials();
  if (!creds) {
    report.add('skipped — no VERIFY_EMAIL/VERIFY_PASSWORD in .env.development', true,
      'the real dashboard is auth-gated');
    return report;
  }

  const chromium = await getChromium();

  // --- the lab's applied dashboard ---
  const lab = await openWith(chromium, { ...AXES, path: '/design-lab', width: 1500, height: 900 });
  await lab.page.getByRole('radio', { name: 'Applied to real screens' }).click();
  await lab.page.waitForTimeout(2500);
  const labValues = await lab.page.evaluate(PROBE);
  await lab.browser.close();

  // --- the real, logged-in dashboard ---
  const app = await openWith(chromium, { ...AXES, path: '/login', width: 1500, height: 900 });
  const { page } = app;
  await page.locator('input').first().fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  // The dev Turnstile key always passes, but the widget still needs a moment to resolve.
  await page.waitForTimeout(1500);
  await page.locator('button[type="submit"], .ant-btn').first().click();
  await page.waitForTimeout(7000);

  if (!page.url().includes('/dashboard')) {
    report.add('login', false, `landed on ${page.url()} — check the credentials and that the backend is up`);
    await app.browser.close();
    return report;
  }
  const appValues = await page.evaluate(PROBE);
  await app.browser.close();

  for (const key of Object.keys(labValues)) {
    const l = labValues[key];
    const a = appValues[key];
    // A property missing on BOTH sides is not a parity failure — it means neither
    // surface renders that element, which is the mock's prerogative.
    if (l === null && a === null) continue;
    report.add(key, String(l) === String(a), String(l) === String(a) ? String(l) : `lab ${l} vs app ${a}`);
  }
  return report;
}
