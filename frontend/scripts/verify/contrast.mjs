/**
 * WCAG contrast across every src/ui component, in both modes and both brands.
 *
 * This check exists because it caught real failures on the product's primary action:
 * the solid button measured 3.51:1 in light and 2.00:1 in dark against a 4.5:1 floor,
 * and the tertiary text token 2.93:1. None of that was visible by eye — which is the
 * entire argument for measuring it.
 */
import { getChromium, openWith, Report } from './lib.mjs';

/** Relative luminance per WCAG 2.1. */
const lum = (r, g, b) => {
  const a = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};

const TARGETS = [
  ['solid button label', '.ui-btn--solid'],
  ['soft button label', '.ui-btn--soft'],
  ['text button label', '.ui-btn--text'],
  ['stat label', '.ui-stat__label'],
  ['stat value', '.ui-stat__value'],
  ['stat footnote', '.ui-stat__footnote'],
  ['page title', '.ui-page-header__title'],
  ['page subtitle', '.ui-page-header__subtitle'],
  ['eyebrow', '.ui-page-header__eyebrow'],
  ['segmented inactive', '.ui-segmented__item:not(.ui-segmented__item--active)'],
  ['segmented active', '.ui-segmented__item--active'],
  ['state title', '.ui-state__title'],
  ['state body', '.ui-state__body'],
  ['field label', '.ui-field__label'],
  ['field hint', '.ui-field__hint'],
  // The read side of a field. Added 2026-09-01 with FieldValue: the state it replaces
  // (AntD `disabled`) measured 1.84:1 light / 1.91:1 dark on /mrf's detail modal and
  // nothing here saw it, because this check only measures what /design-lab renders.
  ['field value', '.ui-value'],
  ['field value empty', '.ui-value__empty'],
];

export default async function run() {
  const chromium = await getChromium();
  const report = new Report('Contrast (WCAG AA)');

  for (const mode of ['light', 'dark']) {
    for (const brand of ['aapna', 'midnight']) {
      const { browser, page } = await openWith(chromium, {
        mode, theme: mode, brand, preset: 'liquid-glass', font: 'system-native',
      });
      const results = await page.evaluate(({ targets, lumSrc }) => {
        // eslint-disable-next-line no-new-func
        const luminance = new Function(`return ${lumSrc}`)();
        /* Handles rgb()/rgba() AND `color(srgb r g b / a)`, which is what a
           `color-mix()` resolves to in Chromium. The first version of this parser only
           read rgb(), so every token built with color-mix — most of the tinted text in
           the system — silently returned null and was reported as "not on page"
           instead of being checked. Alpha is returned too, because a faded colour has
           to be composited over its background before the ratio means anything: the
           auth panel's lede measured 4.85 ignoring alpha and 4.17 with it, and only
           the second number is real. */
        const parse = (s) => {
          const str = String(s);
          let m = str.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
          if (m) return { rgb: [+m[1] * 255, +m[2] * 255, +m[3] * 255], a: m[4] !== undefined ? +m[4] : 1 };
          m = str.match(/rgba?\(([^)]+)\)/);
          if (m) {
            const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
            return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
          }
          return null;
        };
        // Walk up for the first effectively-opaque background: a translucent glass
        // surface does not define the colour the text actually sits on.
        /* Walks up for the first EFFECTIVELY OPAQUE background. The opacity test must
           use the same parser as everything else: it originally re-matched `rgba()`
           with its own regex, so once `color(srgb … / a)` became parseable this stopped
           at a translucent glass surface and treated it as the ground — reporting
           1.15:1 for text that plainly reads. A checker that cries wolf gets ignored,
           so the guard and the parser have to agree. */
        const solidBg = (el) => {
          let n = el;
          while (n && n !== document.documentElement) {
            const parsed = parse(getComputedStyle(n).backgroundColor);
            if (parsed && parsed.a > 0.95) return getComputedStyle(n).backgroundColor;
            n = n.parentElement;
          }
          return getComputedStyle(document.body).backgroundColor;
        };
        return targets.map(([label, sel]) => {
          const el = document.querySelector(sel);
          if (!el) return { label, skip: true };
          const cs = getComputedStyle(el);
          const f = parse(cs.color); const b = parse(solidBg(el));
          if (!f || !b) return { label, skip: true };
          // Composite semi-transparent text over its background before measuring.
          const eff = f.rgb.map((c, i) => c * f.a + b.rgb[i] * (1 - f.a));
          const L1 = luminance(...eff); const L2 = luminance(...b.rgb);
          const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
          const ratio = +(((hi + 0.05) / (lo + 0.05)).toFixed(2));
          const fs = parseFloat(cs.fontSize); const fw = Number(cs.fontWeight) || 400;
          // WCAG "large text": >=24px, or >=18.66px when bold.
          const need = (fs >= 24 || (fs >= 18.66 && fw >= 700)) ? 3 : 4.5;
          return { label, ratio, need, fs, fw, pass: ratio >= need };
        });
      }, { targets: TARGETS, lumSrc: lum.toString() });

      for (const r of results) {
        if (r.skip) continue;
        report.add(
          `${mode}/${brand} ${r.label}`,
          r.pass,
          `${r.ratio}:1 (need ${r.need}, ${r.fs}px/${r.fw})`,
        );
      }
      await browser.close();
    }
  }
  return report;
}
