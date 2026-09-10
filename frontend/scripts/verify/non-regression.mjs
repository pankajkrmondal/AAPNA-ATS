/**
 * The 24 unconverted routes must not have shifted.
 *
 * This is the check that caught the one bug that actually mattered. The V3 scale was
 * first emitted under the LEGACY token names (`--radius-sm` and friends), which have
 * 100+ consumers in index.css — so it silently restyled every route in the app before
 * a single screen had been reviewed. Measured on /login: `--radius-sm` 8px -> 12px,
 * `--radius-lg` 14px -> 22px.
 *
 * Delete this only when the last route is converted and the legacy names are retired.
 */
import { getChromium, openWith, Report } from './lib.mjs';

/** The values these tokens had before Design V3 existed. */
const PRE_V3 = {
  '--radius-sm': '8px',
  '--radius-md': '10px',
  '--radius-lg': '14px',
  '--border-radius': '8px',
  '--border-radius-lg': '14px',
  '--transition-fast': '0.15s cubic-bezier(0.22, 1, 0.36, 1)',
};

export default async function run() {
  const chromium = await getChromium();
  const report = new Report('Non-regression on unconverted routes');

  // /login is public: it renders with no backend and no session, which is what makes
  // it usable as the canary.
  const { browser, page } = await openWith(chromium, { path: '/login', theme: 'light' });
  const actual = await page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
  }, Object.keys(PRE_V3));
  await browser.close();

  for (const [token, want] of Object.entries(PRE_V3)) {
    report.add(`/login ${token}`, actual[token] === want,
      actual[token] === want ? want : `expected ${want}, got "${actual[token]}"`);
  }
  return report;
}
