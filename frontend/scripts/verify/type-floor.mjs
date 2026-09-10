/**
 * Type-scale floor guard — nothing readable renders below 12px.
 *
 * WHY 12px
 * Before this rollout the app set type between 9px and 13px with no system behind it.
 * `theme/fonts.js` gives every font pack the same 13-role scale with a **12px floor**,
 * and the conversion spent real effort removing 9px, 9.5px, 10px, 10.5px, 11px and
 * 11.5px declarations — CandidateScreening alone had 9px labels at 0.6 opacity, which
 * is below the floor AND dimmed.
 *
 * A floor that nothing enforces is a floor that comes back one component at a time.
 * This scan found four routes still breaching it *after* the rollout was called
 * complete, all in shared components the sweep had not reached yet.
 *
 * EXEMPTIONS, and why each is not running text:
 *   - SVG (`<text>` in charts) — Recharts renders its own axis labels; they are chart
 *     furniture, sized to the plot, and not read as prose.
 *   - `.cp-avatar`, `.dash-uploads__avatar` — two or three initials centred in a fixed
 *     small circle. A graphic label; raising it would overflow the chip.
 *   - `.live-badge` — a status pill whose text is a single word at a glance.
 *   - `.recharts-legend-item-text` — Recharts renders its legend as HTML rather than
 *     SVG, but it is the same chart furniture as the axis labels above it.
 *   - `.dash-kbd` — a keycap glyph (⌘K), sized to the key it depicts.
 *   - anything positioned off-screen — Recharts parks a measurement span at
 *     `top: -20000px` to size its labels. Filtered by geometry, not by class, so the
 *     rule holds for any offscreen node rather than just that one.
 *
 * Anything else under 12px is a regression. Add to EXEMPT only with a reason.
 */
import { BASE, getChromium, Report, credentials } from './lib.mjs';

const ROUTES = [
  '/dashboard', '/candidates', '/mrf', '/hr-upload', '/vendor',
  '/vendor-dashboard', '/filtering', '/pipeline', '/analytics', '/settings', '/email',
];

const EXEMPT = [
  'cp-avatar', 'dash-uploads__avatar', 'live-badge',
  'recharts-legend-item-text', 'dash-kbd',
];

export default async function run() {
  const r = new Report('type-scale floor (12px)');
  const creds = credentials();
  if (!creds) {
    r.add('skipped — no VERIFY_EMAIL / VERIFY_PASSWORD', true, '(set them to run this check)');
    return r;
  }

  const chromium = await getChromium();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1560, height: 1000 } });
    await ctx.addInitScript(() => localStorage.setItem('ats_theme', 'light'));
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await page.locator('input').first().fill(creds.email);
    await page.locator('input[type="password"]').fill(creds.password);
    await page.waitForTimeout(1300);
    await page.locator('button[type="submit"], .ant-btn').first().click();
    await page.waitForTimeout(6500);

    let total = 0;
    const offenders = [];
    for (const route of ROUTES) {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2800);
      const found = await page.evaluate((exempt) => {
        const out = {};
        for (const el of document.querySelectorAll('body *')) {
          // Only elements that render their OWN text; a wrapper inherits its child's size.
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          if (el.ownerSVGElement || el.tagName === 'text') continue;
          // Skip nodes parked off-screen. Recharts appends a hidden span at
          // `top: -20000px` to MEASURE label widths; it is never seen, and exempting
          // it by class would have exempted every portaled node with it.
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0 || box.bottom < 0 || box.right < 0) continue;
          const cls = typeof el.className === 'string' ? el.className : '';
          if (exempt.some((e) => cls.includes(e))) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs && fs < 12) {
            const key = fs + 'px ' + (cls.split(' ')[0] || el.tagName.toLowerCase());
            out[key] = (out[key] || 0) + 1;
          }
        }
        return out;
      }, EXEMPT);
      const n = Object.values(found).reduce((a, b) => a + b, 0);
      total += n;
      if (n) {
        const worst = Object.entries(found).sort((a, b) => b[1] - a[1])[0];
        offenders.push(route + ' (' + n + ': ' + worst[1] + '× ' + worst[0] + ')');
      }
    }

    r.add('no readable text below the 12px floor on any route',
      total === 0,
      total === 0
        ? '(' + ROUTES.length + ' routes scanned)'
        : '\n    ' + offenders.join('\n    '));

    await ctx.close();
  } finally {
    await browser.close();
  }
  return r;
}
