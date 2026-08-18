/**
 * Brand registry — the per-organization theming axis.
 *
 * The app has two independent theming axes and they must stay independent:
 *
 *   mode  ∈ { light, dark }  — owned by ThemeContext, user-chosen, already shipped
 *   brand ∈ BRANDS           — owned by BrandContext, organization-chosen (this file)
 *
 * Any brand must work in both modes, so every brand supplies a token set per mode.
 * Keeping them orthogonal is what lets a future tenant restyle the product without
 * touching mode logic, and lets a user still pick dark mode inside a tenant theme.
 *
 * IMPORTANT — why the tokens are named `--brand-*` and not `--gold`:
 * `--gold`, `--ink` and friends are referenced in hundreds of places across
 * theme/index.css and in inline styles on nearly every page. Renaming them would be
 * a repo-wide churn for zero user-visible benefit. Instead index.css *aliases* the
 * legacy names onto these (`--gold: var(--brand-primary)`), so a brand switch
 * repaints the whole app while every existing reference keeps working.
 *
 * NOTE ON NAMES: `--gold` / `--green` are historical. The primary brand colour is now
 * violet (see the `aapna` block below); the legacy alias names were kept
 * deliberately for the reason above. Read `--gold` as "the primary brand colour",
 * not as a hue.
 *
 * NEXT SESSION (server-driven themes): nothing here needs to change structurally.
 * A company's token overrides can be stored as a JSON blob — the existing
 * `rpa_settings` key/value table takes `theme.company.<id>` with no migration — and
 * handed to BrandProvider as `overrides`. Only `resolveBrandId` gains a source.
 */

/**
 * @typedef {object} BrandTokens
 * @property {string} --brand-primary   Primary brand colour (buttons, links, active nav).
 * @property {string} --brand-primary-hover
 * @property {string} --brand-primary-active
 * @property {string} --brand-accent    Secondary mark colour; also the logo's filled blade.
 * @property {string} --brand-primary-bg  Tinted surface behind primary content.
 * @property {string} --brand-canvas    App background.
 * @property {string} --brand-surface   Card/panel background.
 */

/** The default and, today, only brand. Values are lifted verbatim from the
 *  pre-existing palette so switching this on changes nothing visually. */
const aapna = {
  id: 'aapna',
  name: 'AAPNA Infotech',
  /** Product label shown beside the logo. The logo bitmap already reads "aapna",
   *  so this must NOT repeat the company name — see MainLayout's brand slot. */
  productLabel: 'ATS Platform',
  /** Hero eyebrow. Distinct from productLabel because this slot has no logo next to
   *  it, so it does carry the brand name. Sourced from the brand rather than
   *  hardcoded in the hero, so a tenant theme replaces it too. */
  heroEyebrow: 'AAPNA ATS Platform',
  light: {
    '--brand-primary': '#4f2fb8',
    '--brand-primary-hover': '#6c62d2',
    '--brand-primary-active': '#3d2196',
    '--brand-accent': '#6c62d2',
    '--brand-primary-bg': '#e7e3f7',
    '--brand-canvas': '#f8f7fc',
    '--brand-surface': '#ffffff',
    // Deeper canvas used ONLY behind the glass dashboard. Light mode's problem was
    // value contrast: near-white cards on a near-white page have nothing to separate
    // against, so the glass read as flat no matter how it was styled — while dark
    // mode worked because its panes glow against a dark ground. Dropping the ground
    // ~9% in value is what lets a white pane actually read as a pane.
    '--brand-canvas-deep': '#fcfbfe',
    // Ambient canvas (see aurora-glass.css). Violet-led on purpose: one analogous
    // companion and one cool accent, no warm hues — that is what keeps it reading as
    // a calm product surface rather than a gradient soup. Light mode carries MORE saturation
    // than instinct suggests: over a light ground the eye needs real chroma before a
    // wash registers at all.
    '--aurora-1': 'rgba(79, 47, 184, 0.13)',
    '--aurora-2': 'rgba(108, 98, 210, 0.11)',
    '--aurora-3': 'rgba(108, 98, 210, 0.08)',
    '--aurora-4': 'rgba(79, 47, 184, 0.06)',
    '--aurora-opacity': '1',
    '--watermark-opacity': '0.075',
    // Shadow hue for light mode (see light3 note): coloured, not black.
    '--shade-rgb': '58 40 120',
  },
  dark: {
    '--brand-primary': '#a99cf0',
    '--brand-primary-hover': '#c4baf7',
    '--brand-primary-active': '#8b7bea',
    '--brand-accent': '#a99cf0',
    '--brand-primary-bg': 'rgba(169, 156, 240, 0.12)',
    '--brand-canvas': '#0d0b16',
    '--brand-canvas-deep': '#0d0b16', // dark mode already has the contrast it needs
    '--brand-surface': '#161327',
    '--aurora-1': 'rgba(169, 156, 240, 0.32)',
    '--aurora-2': 'rgba(90, 79, 190, 0.24)',
    '--aurora-3': 'rgba(108, 98, 210, 0.16)',
    '--aurora-4': 'rgba(79, 47, 184, 0.38)',
    '--aurora-opacity': '0.92',
    '--watermark-opacity': '0.075',
  },
};

/**
 * A deliberately different second brand, used only to prove the axis is real:
 * flipping to it must repaint primary colour, aurora and mark with no code edits.
 * Keeping a test brand in the registry (rather than in a test file) means the
 * mechanism is exercised by the same code path a real tenant would use.
 */
const midnight = {
  id: 'midnight',
  name: 'Midnight (theming test)',
  productLabel: 'Talent Cloud',
  heroEyebrow: 'Midnight Talent Cloud',
  light: {
    '--brand-primary': '#3b5bdb',
    '--brand-primary-hover': '#4c6ef5',
    '--brand-primary-active': '#2f4bb8',
    '--brand-accent': '#7048e8',
    '--brand-primary-bg': '#e7ecfd',
    '--brand-canvas': '#f5f6fa',
    '--brand-surface': '#ffffff',
    '--aurora-1': 'rgba(59, 91, 219, 0.38)',
    '--aurora-2': 'rgba(112, 72, 232, 0.26)',
    '--aurora-3': 'rgba(34, 184, 207, 0.20)',
    '--aurora-4': 'rgba(76, 110, 245, 0.30)',
    '--aurora-opacity': '0.9',
    '--watermark-opacity': '0.06',
  },
  dark: {
    '--brand-primary': '#8da2fb',
    '--brand-primary-hover': '#a5b4fc',
    '--brand-primary-active': '#7387f0',
    '--brand-accent': '#a78bfa',
    '--brand-primary-bg': 'rgba(141, 162, 251, 0.14)',
    '--brand-canvas': '#080a12',
    '--brand-surface': '#111420',
    '--aurora-1': 'rgba(141, 162, 251, 0.32)',
    '--aurora-2': 'rgba(167, 139, 250, 0.26)',
    '--aurora-3': 'rgba(34, 184, 207, 0.16)',
    '--aurora-4': 'rgba(99, 122, 240, 0.36)',
    '--aurora-opacity': '0.92',
    '--watermark-opacity': '0.075',
  },
};

export const BRANDS = { aapna, midnight };
export const DEFAULT_BRAND_ID = 'aapna';

/** localStorage key for the manual override (testing, and later a tenant pin). */
export const BRAND_STORAGE_KEY = 'ats_brand';

/**
 * Resolves which brand to use. Today: a localStorage override, else the default.
 * Later: the logged-in user's company theme, which is why this is a function
 * rather than a constant.
 * @returns {string} brand id present in BRANDS
 */
export function resolveBrandId() {
  try {
    const stored = localStorage.getItem(BRAND_STORAGE_KEY);
    if (stored && BRANDS[stored]) return stored;
  } catch {
    /* storage unavailable (private mode) */
  }
  return DEFAULT_BRAND_ID;
}

/**
 * Flattens a brand into CSS custom properties for BOTH modes at once, suffixing
 * each key with `-light` / `-dark`.
 *
 * Why both rather than just the active mode: the emitted properties are written
 * inline on <html>, and inline styles beat every selector. If we wrote only the
 * active mode's values to `--brand-primary`, they would also win *inside* the
 * `<ForceLight>` wrapper used by the public token-link pages (/mrf-submit,
 * /mrf/:id/approve, /missing-jd-upload) — a dark-mode session would render those
 * always-light pages with dark-mode brand colours.
 *
 * Emitting mode-agnostic inputs and letting index.css choose
 * (`--brand-primary: var(--brand-primary-light)` under `:root, [data-theme='light']`,
 * and the `-dark` variant under `[data-theme='dark']`) keeps mode switching in CSS
 * where the theme scoping already works.
 *
 * @param {string} brandId
 * @returns {Record<string, string>} e.g. { '--brand-primary-light': '#4f2fb8', … }
 */
export function brandTokens(brandId) {
  const brand = BRANDS[brandId] || BRANDS[DEFAULT_BRAND_ID];
  const out = {};
  for (const mode of ['light', 'dark']) {
    for (const [key, value] of Object.entries(brand[mode])) {
      out[`${key}-${mode}`] = value;
    }
  }
  return out;
}

export default BRANDS;
