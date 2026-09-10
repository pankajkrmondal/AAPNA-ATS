/**
 * Composition guard — the assertions `parity.mjs` deliberately does not make.
 *
 * WHY THIS IS A SIBLING AND NOT AN EDIT TO parity.mjs
 * That file's docblock commits to asserting TOKENS and explicitly not layout: "a mock is
 * allowed to show different content, never to be styled differently." It kept that
 * promise, and it is the reason "parity passes" was worth nothing against the gap this
 * file exists for — the app matched the lab on every token while looking 40% unlike it,
 * because the primitives were built and never assembled. Rewriting parity's contract in
 * place would make it lie about itself; this states the other half separately.
 *
 * EACH ASSERTION HERE CAUGHT SOMETHING REAL, and is written to fail on the exact defect
 * it was born from:
 *
 *   1. Ten of twelve routes rendered no page header at all. Titles lived only in the
 *      topbar, so screens opened with no anchor.
 *   2. /candidates/:id opened with a bare text button floating on the canvas.
 *   3. `Button` shipped to ONE file while its own docblock claimed 224 call sites.
 *   4. `/analytics` was converted, reported as done, and still had a 20px bare-div
 *      title — found by a human reading the screen, not by any check.
 *   5. KPI tiles on five routes rendered short with an empty lower half, because the
 *      call sites passed no `footnote`.
 */
import { getChromium, openWith, BASE, Report, credentials } from './lib.mjs';

/** The in-shell routes. /admin/dashboard is a separate shell and is excluded. */
const ROUTES = [
  '/dashboard', '/candidates', '/mrf', '/hr-upload', '/vendor',
  '/vendor-dashboard', '/filtering', '/pipeline', '/analytics', '/settings', '/email',
];

/**
 * Buttons AntD renders ITSELF, which can never carry `.ui-btn` because they are not a
 * `<Button>` in our source. Measured on a fully converted /pipeline: the only survivor
 * was `Input.Search`'s enter-button. Modal footers, Popconfirm and Table pagination are
 * the same case. Add to this list only with a reason.
 */
const ANTD_INTERNAL_BUTTONS = [
  'ant-input-search-button',
  'ant-pagination-item-link',
  'ant-picker-header-super-prev-btn',
];

/**
 * The type ramp, plus the metric sizes.
 *
 * Taken from theme/fonts.js's active pack, NOT from the fallbacks in tokens.css. THIS LIST
 * IS PACK-SPECIFIC AND MUST MOVE WITH `DEFAULT_FONT_PACK_ID` — a pack owns its scale, so a
 * font swap silently invalidates these numbers.
 *
 * Updated 2026-08-31, system-native -> inter-sora. The text roles are identical between the
 * two packs; only the metrics moved, 25/33/46 -> 24/32/44. 24 and 32 were already here for
 * title3/title1, so the single new value is 44 — and its absence would have failed
 * "type is on the ramp" on every route rendering a metricLg.
 * Verified against `.ui-stat__value`, the design system's own metric, which measures
 * 32px on /dashboard under this pack.
 */
const RAMP = [12, 13, 14, 15, 17, 20, 24, 32, 44];

/** Same exemptions as type-floor.mjs — chart furniture and graphic labels, not prose. */
const TYPE_EXEMPT = [
  'cp-avatar', 'dash-uploads__avatar', 'live-badge',
  'recharts-legend-item-text', 'dash-kbd', 'ui-hero__mark',
];

/* One destructured object, not three parameters: page.evaluate passes exactly one arg
   and throws "Too many arguments" otherwise. */
const PROBE = ({ internals, ramp, exempt }) => {
  const page = document.querySelector('.ui-page');
  const headers = document.querySelectorAll('.ui-page-header');

  // 2 — what the page opens with.
  const first = page ? page.firstElementChild : null;
  const firstOk = !!first && (
    first.classList.contains('ui-surface')
    || first.classList.contains('ui-page-header')
    || first.classList.contains('ui-hero')
  );

  // 3 — every button inside the converted scope belongs to the design system.
  const rawButtons = [...document.querySelectorAll('.ats-v3 .ant-btn')]
    .filter((b) => !b.classList.contains('ui-btn'))
    .filter((b) => !internals.some((c) => b.classList.contains(c)))
    .map((b) => (b.textContent || '').trim().slice(0, 22) || '(icon)');

  // 4 — every rendered size is a member of the ramp.
  const offRamp = new Map();
  for (const el of document.querySelectorAll('.ats-v3 *')) {
    if (!el.firstChild || el.firstChild.nodeType !== Node.TEXT_NODE) continue;
    if (!el.firstChild.textContent.trim()) continue;
    if (exempt.some((c) => el.closest('.' + c))) continue;
    if (el.closest('svg')) continue;
    const r = el.getBoundingClientRect();
    if (r.top < -9999 || (!r.width && !r.height)) continue;
    const size = Math.round(parseFloat(getComputedStyle(el).fontSize));
    if (!ramp.includes(size)) offRamp.set(size, (offRamp.get(size) || 0) + 1);
  }

  // 5 — a stat tile without a footnote renders short and empty-bottomed.
  const tiles = [...document.querySelectorAll('.ui-stat')];
  const tilesNoFootnote = tiles.filter((t) => !t.querySelector('.ui-stat__footnote')).length;

  return {
    headers: headers.length,
    firstChild: first ? first.tagName.toLowerCase() + '.' + String(first.className).split(' ')[0] : '(none)',
    firstOk,
    rawButtons,
    offRamp: [...offRamp.entries()].sort((a, b) => b[1] - a[1]),
    tiles: tiles.length,
    tilesNoFootnote,
  };
};

export default async function run() {
  const report = new Report('composition');
  const creds = credentials();
  if (!creds) {
    report.add('skipped — no VERIFY_EMAIL/VERIFY_PASSWORD in .env.development', true,
      'every route here is auth-gated');
    return report;
  }

  const chromium = await getChromium();
  const { browser, page } = await openWith(chromium, { path: '/login', width: 1500, height: 1000 });
  await page.locator('input').first().fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await page.waitForTimeout(1500);
  await page.locator('button[type="submit"], .ant-btn').first().click();
  await page.waitForTimeout(7000);

  if (!page.url().includes('/dashboard')) {
    report.add('login', false, `landed on ${page.url()} — check the credentials and that the backend is up`);
    await browser.close();
    return report;
  }

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const r = await page.evaluate(PROBE, {
      internals: ANTD_INTERNAL_BUTTONS, ramp: RAMP, exempt: TYPE_EXEMPT,
    });

    report.add(`${route} renders exactly one page header`, r.headers === 1, `(${r.headers})`);
    report.add(`${route} opens on a surface or a header`, r.firstOk, `(${r.firstChild})`);
    report.add(`${route} has no un-systemised button`, r.rawButtons.length === 0,
      r.rawButtons.length ? `(${r.rawButtons.length}: ${r.rawButtons.slice(0, 4).join(', ')})` : '');
    report.add(`${route} type is on the ramp`, r.offRamp.length === 0,
      r.offRamp.length ? `(${r.offRamp.map(([s, n]) => `${s}px x${n}`).join(', ')})` : '');
    if (r.tiles) {
      report.add(`${route} stat tiles carry a footnote`, r.tilesNoFootnote === 0,
        `(${r.tilesNoFootnote} of ${r.tiles} without)`);
    }
  }

  await browser.close();
  return report;
}
