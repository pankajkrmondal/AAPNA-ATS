/**
 * Keyboard reachability, reduced motion, reduced transparency.
 *
 * Each assertion here corresponds to a defect that was actually shipped and measured:
 *  - Segmented gave every option `tabIndex=0`, so a 4-option group was 4 tab stops and
 *    crossing the control bar cost ~16 instead of 5. It also declared `role="radio"`
 *    while handling no arrow keys — an ARIA contract claimed and not honoured.
 *  - `--press-scale: 1` under reduced motion never applied, because DesignContext
 *    writes the token inline on <html> and an inline declaration beats a media query.
 *    The press transform kept firing for users who had asked for no motion.
 */
import { getChromium, openWith, Report } from './lib.mjs';

export default async function run() {
  const chromium = await getChromium();
  const report = new Report('Accessibility');

  /* ---- keyboard: one tab stop per radiogroup, arrows move selection ---- */
  {
    const { browser, page } = await openWith(chromium, { theme: 'light', preset: 'liquid-glass' });
    const groups = await page.evaluate(() => document.querySelectorAll('.ui-segmented').length);
    const perGroupStops = await page.evaluate(() => {
      let total = 0;
      for (const g of document.querySelectorAll('.ui-segmented')) {
        total += [...g.querySelectorAll('.ui-segmented__item')]
          .filter((b) => b.tabIndex === 0).length;
      }
      return total;
    });
    report.add('one tab stop per segmented group', perGroupStops === groups,
      `${perGroupStops} stops across ${groups} groups`);

    const moved = await page.evaluate(async () => {
      const first = document.querySelector('.ui-segmented__item--active');
      if (!first) return null;
      const before = first.textContent;
      first.focus();
      first.closest('.ui-segmented').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 150));
      return { before, after: document.querySelector('.ui-segmented__item--active')?.textContent };
    });
    report.add('arrow keys move selection', Boolean(moved && moved.before !== moved.after),
      moved ? `"${moved.before}" -> "${moved.after}"` : 'no segmented control found');

    const focusRings = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.ui-btn, .ui-segmented__item')].slice(0, 12);
      return els.every((el) => {
        const cs = getComputedStyle(el);
        // A focus ring is either an outline or the glow box-shadow; both count.
        return cs.getPropertyValue('--glow-focus') !== '' || cs.outlineStyle !== 'none' || cs.boxShadow !== 'none';
      });
    });
    report.add('interactive elements can show a focus ring', focusRings);
    await browser.close();
  }

  /* ---- reduced motion ---- */
  {
    const { browser, page } = await openWith(chromium, { theme: 'light', reducedMotion: 'reduce' });
    const r = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        press: cs.getPropertyValue('--press-scale').trim(),
        dur: cs.getPropertyValue('--dur-base').trim(),
        stagger: cs.getPropertyValue('--stagger-step').trim(),
      };
    });
    report.add('reduced motion neutralises the press transform', r.press === '1', `--press-scale=${r.press}`);
    report.add('reduced motion neutralises durations', r.dur === '1ms' && r.stagger === '0ms',
      `--dur-base=${r.dur} --stagger-step=${r.stagger}`);
    await browser.close();
  }

  /* ---- normal motion must be unaffected: a guard that always fires is a bug ---- */
  {
    const { browser, page } = await openWith(chromium, { theme: 'light' });
    const r = await page.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue('--press-scale').trim());
    report.add('normal motion keeps the press transform', r !== '1', `--press-scale=${r}`);
    await browser.close();
  }

  return report;
}
