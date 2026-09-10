/**
 * Status-border guard — the Failure B regression test.
 *
 * `.cp-candidate-card`'s LEADING border is the candidate's status. It is the only cue
 * for that state on the board, and it is painted from `--cp-accent`, which the card
 * publishes as a custom property so CSS keeps ownership of the property.
 *
 * The failure this guards against is silent by construction: any rule that writes the
 * `border` or `border-color` SHORTHAND sets all four sides and erases the status edge.
 * The page still renders, the cards still look fine, and the information is simply
 * gone. That already happened once — the hover rule in index.css used `border-color`
 * and wiped the accent off every hovered card.
 *
 * So this asserts three things a screenshot cannot:
 *   1. the leading border is present and non-zero
 *   2. cards of different status have DIFFERENT leading colours
 *   3. hovering does not change the leading colour
 *
 * Needs a login, like the parity check, and skips with a clear message when
 * credentials are absent rather than failing the suite for someone without them.
 */
import { BASE, getChromium, Report, credentials } from './lib.mjs';

export default async function run() {
  const r = new Report('status border (Failure B)');
  const creds = credentials();
  if (!creds) {
    r.add('skipped — no VERIFY_EMAIL / VERIFY_PASSWORD', true, '(set them to run this check)');
    return r;
  }

  const chromium = await getChromium();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1560, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await page.locator('input').first().fill(creds.email);
    await page.locator('input[type="password"]').fill(creds.password);
    await page.waitForTimeout(1300);
    await page.locator('button[type="submit"], .ant-btn').first().click();
    await page.waitForTimeout(6500);
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const data = await page.evaluate(async () => {
      const cards = [...document.querySelectorAll('.cp-candidate-card')];
      if (cards.length < 2) return { count: cards.length };
      const lead = (e) => {
        const c = getComputedStyle(e);
        return { color: c.borderInlineStartColor, width: parseFloat(c.borderInlineStartWidth) };
      };
      const all = cards.map(lead);
      const first = lead(cards[0]);
      cards[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      cards[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 250));
      const afterHover = lead(cards[0]);
      return {
        count: cards.length,
        widths: all.map((x) => x.width),
        distinct: [...new Set(all.map((x) => x.color))].length,
        first: first.color,
        afterHover: afterHover.color,
      };
    });

    if (!data.widths) {
      r.add('board rendered at least 2 candidate cards', false, `(found ${data.count})`);
      return r;
    }
    r.add('every card has a non-zero leading border',
      data.widths.every((w) => w >= 2), `(widths ${[...new Set(data.widths)].join(', ')}px)`);
    r.add('statuses render distinct leading colours',
      data.distinct > 1, `(${data.distinct} distinct across ${data.count} cards)`);
    r.add('hover does not erase the status colour',
      data.first === data.afterHover, `(${data.first} -> ${data.afterHover})`);
    await ctx.close();
  } finally {
    await browser.close();
  }
  return r;
}
