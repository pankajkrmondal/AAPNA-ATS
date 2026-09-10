/**
 * The swap contract: five axes that must move independently.
 *
 * A design system with one theme has never been SHOWN to be themeable — coupling only
 * surfaces when you try the second one. This asserts on computed styles rather than
 * screenshots, so a value that merely looks right while being inlined still fails.
 */
import { getChromium, openWith, Report } from './lib.mjs';

const probe = () => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const btn = document.querySelector('.ui-btn');
  const surface = document.querySelector('.ui-surface');
  return {
    // Renamed from --radius-card 2026-08-29: that name is owned by the V2 layer,
    // which sets 16px on `.ats-v2`, and a converted route sits inside it.
    radiusCard: v('--radius-surface'),
    radiusBtn: v('--radius-btn'),
    ctlH: v('--ctl-h'),
    pressScale: v('--press-scale'),
    fontBody: v('--font').split(',')[0].replace(/['"]/g, ''),
    brandPrimary: v('--brand-primary'),
    brandSolid: v('--brand-solid'),
    btnRadius: btn && getComputedStyle(btn).borderRadius,
    btnFont: btn && getComputedStyle(btn).fontFamily.split(',')[0].replace(/['"]/g, ''),
    surfaceBg: surface && getComputedStyle(surface).backgroundColor,
  };
};

const BASELINE = { preset: 'liquid-glass', font: 'system-native', brand: 'aapna', theme: 'light', density: 'default' };

export default async function run() {
  const chromium = await getChromium();
  const report = new Report('Swap matrix (five axes, computed styles)');

  const read = async (axes) => {
    const { browser, page } = await openWith(chromium, { ...BASELINE, ...axes });
    const r = await page.evaluate(probe);
    await browser.close();
    return r;
  };

  const base = await read({});
  report.add('baseline resolves', Boolean(base.radiusCard && base.fontBody),
    `${base.radiusCard} card / ${base.radiusBtn} btn / ${base.fontBody}`);

  // Each axis must change what it owns — and nothing asserts a specific value, so the
  // check survives a preset being retuned. It fails only on COUPLING.
  const preset = await read({ preset: 'flat-slate' });
  report.add('preset changes geometry + material',
    preset.radiusCard !== base.radiusCard && preset.surfaceBg !== base.surfaceBg,
    `${base.radiusCard} -> ${preset.radiusCard}`);

  const font = await read({ font: 'figtree' });
  report.add('font changes the family, not the geometry',
    font.btnFont !== base.btnFont && font.radiusCard === base.radiusCard,
    `${base.btnFont} -> ${font.btnFont}`);

  const brand = await read({ brand: 'midnight' });
  report.add('brand changes colour, not the geometry',
    brand.brandPrimary !== base.brandPrimary && brand.radiusCard === base.radiusCard,
    `${base.brandPrimary} -> ${brand.brandPrimary}`);

  const dark = await read({ theme: 'dark' });
  report.add('mode changes colour, not the geometry',
    dark.brandPrimary !== base.brandPrimary && dark.radiusCard === base.radiusCard,
    `${base.brandPrimary} -> ${dark.brandPrimary}`);

  const compact = await read({ density: 'compact' });
  const relaxed = await read({ density: 'relaxed' });
  report.add('density changes control height only',
    compact.ctlH !== base.ctlH && relaxed.ctlH !== base.ctlH && compact.radiusCard === base.radiusCard,
    `${compact.ctlH} / ${base.ctlH} / ${relaxed.ctlH}`);

  /* The flag test. Behaviour must follow a preset's DECLARED flags, not its name —
     ui.css previously hardcoded [data-preset='flat-slate'], which meant any third
     preset silently inherited the first one's material. Forcing the attributes for a
     preset name the CSS has never seen is the only real proof. */
  const { browser, page } = await openWith(chromium, BASELINE);
  const flagged = await page.evaluate(() => {
    const h = document.documentElement;
    h.setAttribute('data-flag-squircle', '0');
    h.setAttribute('data-preset', 'a-preset-css-has-never-seen');
    const surf = document.querySelector('.ui-surface');
    return getComputedStyle(surf).getPropertyValue('--ui-corner').trim();
  });
  await browser.close();
  report.add('behaviour is flag-driven, not preset-name-driven',
    flagged === 'round', `--ui-corner = ${flagged}`);

  return report;
}
