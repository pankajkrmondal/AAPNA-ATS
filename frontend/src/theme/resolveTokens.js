/**
 * resolveTokens — turns (preset × fontPack) into the flat CSS custom-property map
 * that DesignContext writes onto <html>.
 *
 * This is the single seam the whole swap contract rests on. Every visual value the
 * app is allowed to use comes out of here, which is what makes changing the theme,
 * the font or the type scale later a config edit rather than a 24-page migration.
 *
 * THE `-light` / `-dark` PAIR CONVENTION — load-bearing, do not "simplify".
 * Mode-dependent values are emitted as BOTH `--x-light` and `--x-dark`, and
 * theme/tokens.css picks between them with a selector. They are never written for
 * the active mode alone. The reason is that these properties are set inline on
 * <html>, and an inline declaration beats every selector — including the
 * `[data-theme='light']` re-scoping that <ForceLight> uses to pin the public
 * token-link pages (/mrf-submit, /mrf/:id/approve, /missing-jd-upload, /scorecard,
 * /documents) to light. Writing only the active mode means a candidate who opens an
 * emailed link while the operator's session is dark gets dark surfaces on a page
 * that must be light. theme/brands.js documents this as a bug that was already
 * found and fixed once; this file inherits the fix rather than reintroducing it.
 *
 * Mode-INdependent values (radius, motion, density, type) are emitted flat, because
 * they genuinely do not vary by mode and pairing them would double the property
 * count for nothing.
 */
import { TYPE_ROLES } from './fonts';

/** Roles whose CSS variable name differs from the JS key (camelCase → kebab). */
const ROLE_VAR = {
  title1: 'title-1',
  title2: 'title-2',
  title3: 'title-3',
  metricLg: 'metric-lg',
  metricMd: 'metric-md',
  metricSm: 'metric-sm',
};

const roleVar = (role) => ROLE_VAR[role] || role;

/**
 * Emits the type scale as one variable trio per role, plus the three family stacks.
 *
 * Each role produces `--fs-<role>`, `--fw-<role>`, `--tracking-<role>` and
 * `--lh-<role>`. Components reference the whole set rather than a bare size, which
 * is what stops a heading from being assembled by hand out of a size and a guess at
 * a weight — the practice that produced 28 distinct inline font sizes.
 *
 * @param {object} pack a FONT_PACKS entry
 * @returns {Record<string, string>}
 */
function typeVars(pack) {
  const out = {
    '--font': pack.stacks.body,
    '--font-heading': pack.stacks.display,
    '--mono': pack.stacks.mono,
    // The third optical cut, used by the caption and footnote roles. Segoe UI
    // Variable Small and SF's small optical size are drawn with looser spacing and
    // sturdier strokes so 12px stays legible; a pack without a distinct small cut
    // points this at its body stack, so the name always resolves.
    '--font-small': pack.stacks.small || pack.stacks.body,
    // NOTE: `--font-body` / `--font-display` were emitted here as "legacy aliases"
    // and had zero consumers anywhere in src. Removed rather than left as a promise —
    // the three names above (`--font`, `--font-heading`, `--mono`) are the ones
    // index.css and the JSX sites actually reference.
  };

  for (const role of TYPE_ROLES) {
    const spec = pack.scale?.[role];
    if (!spec) {
      // A missing role would emit a dangling var() that silently inherits. Surface
      // it in development, where a font pack is actually being authored.
      if (import.meta.env?.DEV) {
        console.warn(`[design] font pack "${pack.id}" is missing type role "${role}"`);
      }
      continue;
    }
    const name = roleVar(role);
    out[`--fs-${name}`] = spec.size;
    out[`--fw-${name}`] = String(spec.weight);
    out[`--tracking-${name}`] = spec.tracking;
    out[`--lh-${name}`] = String(spec.lh);
  }
  return out;
}

/**
 * Emits geometry, motion and density — all mode-independent.
 * @param {object} preset
 * @returns {Record<string, string>}
 */
function structureVars(preset) {
  const { radius, motion, density } = preset;

  return {
    /* Geometry — V3 NAMES ONLY.
       An earlier revision also repointed the legacy `--radius-sm/md/lg/overlay`,
       `--border-radius*`, `--transition-*` and `--ease-out-quint` names at this
       scale, on the theory that it would carry the new look into existing CSS for
       free. It did — and that was the bug. Those names have 100+ consumers across
       index.css and aurora-glass.css, so emitting them inline on <html> silently
       restyled all 24 unconverted routes: measured on /login, `--radius-sm` went
       8px -> 12px and `--radius-lg` 14px -> 22px. That is a whole-app visual change
       landing before a single route has been reviewed, which is exactly what the
       staged rollout exists to prevent, and it cannot be verified route-by-route
       because it happens everywhere at once.

       So the V3 scale uses names nothing else consumes. `--radius-ctl` in
       particular is NOT called `--radius-sm` for this reason. Legacy names keep
       their index.css values until Stage 5 converts the route that uses them; the
       aliases get reinstated then, once each screen has actually been looked at.

       CORRECTED 2026-08-29. This block previously said `--radius-card` was "the one
       shared name, and it is safe", reasoning that "converted-to-V2 routes keep their
       16px while src/ui gets the preset's value". That was wrong in both directions.

       `aurora-glass.css` sets `--radius-card: 16px` on `.ats-v2`. `DesignScope` nests
       `.ats-v3` INSIDE that element, and a custom property set on a descendant wins
       for its subtree — so every V3 surface on a converted route silently rendered at
       16px instead of the preset's 24px. And "converted routes keep their 16px" is not
       a desirable outcome anyway: a converted route is precisely the one that should
       take the new value.

       The fix is to stop making the exception. The V3 surface radius is now
       `--radius-surface`, a name nothing else consumes — the same rule that already
       governs `--radius-ctl` (deliberately not `--radius-sm`) and every other token in
       this file. `--radius-card` is left entirely to the V2 layer. */
    '--radius-xs': radius.xs,
    '--radius-ctl': radius.sm,
    '--radius-btn': radius.btn,
    '--radius-surface': radius.card,
    '--radius-sheet': radius.sheet,
    '--radius-pill': radius.pill,

    /* Motion — V3 names only, same reasoning. `--transition-fast/normal/slow` has
       52 consumers and `--ease-out-quint` 51; repointing them changed the feel of
       every existing hover in the app. `--ease-spring` IS emitted because the
       preset value is byte-identical to index.css's. */
    /* MOTION VALUES ARE EMITTED UNDER A `-motion` SUFFIX, then selected in
       tokens.css — the same pair convention the light/dark tokens use, and for the
       same reason.

       These are written inline on <html>, and an inline declaration beats a media
       query. So the `@media (prefers-reduced-motion: reduce)` block in tokens.css
       that neutralises them was silently dead: `--press-scale` stayed 0.96 and every
       `--dur-*` kept its full value for a user who had asked for no motion. The
       global `*` guard in index.css masks most of that by forcing animation and
       transition durations to 0.001ms — but it does NOT cover the press transform,
       which is a `transform` on `:active`, so the scale still fired.

       Emitting the raw values under a distinct name and letting CSS choose keeps the
       decision in the cascade, where the media query can actually win. */
    '--dur-instant-motion': motion.instant,
    '--dur-fast-motion': motion.fast,
    '--dur-base-motion': motion.base,
    '--dur-sheet-motion': motion.sheet,
    '--dur-cinematic-motion': motion.cinematic,
    '--dur-ambient-motion': motion.ambient,
    '--stagger-step-motion': motion.staggerStep,
    '--press-scale-motion': motion.pressScale,
    /* Easings are not motion AMOUNT, they are motion SHAPE — a reduced-motion request
       is about movement, and a curve with no duration to apply it to is inert. These
       stay flat. */
    '--ease-standard': motion.easeStandard,
    '--ease-spring': motion.easeSpring,
    '--ease-emphasized': motion.easeEmphasized,

    /* Density. All three variants are emitted and tokens.css selects with
       [data-density], for the same reason modes are paired — switching stays in CSS
       where the scoping already works. */
    '--control-h-compact': density.controlHCompact,
    '--control-h': density.controlH,
    '--control-h-relaxed': density.controlHRelaxed,
    '--card-pad-compact': density.cardPadCompact,
    '--card-pad': density.cardPad,
    '--card-pad-relaxed': density.cardPadRelaxed,
    '--row-py-compact': density.rowPyCompact,
    '--row-py': density.rowPy,
    '--row-py-relaxed': density.rowPyRelaxed,
    '--row-px': density.rowPx,

    /* Only the flags used as VALUES live here.
       The other four were emitted as `--flag-*: 1|0` and never read once — because a
       custom property cannot drive a selector, and "turn this rule off" is what those
       flags are for. They are published as `data-flag-*` ATTRIBUTES by DesignContext
       instead, which selectors can match. `--flag-specular` stays a property because
       it is genuinely consumed as a number (an opacity multiplier). */
    '--flag-specular': preset.flags.specular ? '1' : '0',
  };
}

/**
 * Emits the mode-dependent half as `-light` / `-dark` pairs.
 * @param {object} preset
 * @returns {Record<string, string>}
 */
function materialVars(preset) {
  const out = {};
  for (const mode of ['light', 'dark']) {
    for (const [key, value] of Object.entries(preset[mode] || {})) {
      // Multi-line template strings in the preset files are readable there and
      // wasteful here; collapse the whitespace once at the boundary.
      out[`${key}-${mode}`] = String(value).replace(/\s+/g, ' ').trim();
    }
  }
  return out;
}

/**
 * The full custom-property map for a preset + font pack.
 * @param {object} preset a PRESETS entry
 * @param {object} pack   a FONT_PACKS entry
 * @returns {Record<string, string>}
 */
export function resolveCssVars(preset, pack) {
  return {
    ...structureVars(preset),
    ...typeVars(pack),
    ...materialVars(preset),
  };
}

/**
 * The subset AntD needs, resolved for ONE mode.
 *
 * AntD generates real CSS at runtime from JS values, so it cannot read a custom
 * property — it needs concrete strings, for the active mode only. That is why this
 * is separate from resolveCssVars and why it takes `mode`. Feeding both from the
 * same preset and pack is what stops the two halves of the app from drifting, which
 * is exactly what happened before: themeConfig.js restated 91 hexes that
 * BrandProvider could never reach, so a brand switch repainted CSS surfaces and left
 * every AntD control on the old palette.
 *
 * @param {object} preset
 * @param {object} pack
 * @param {'light'|'dark'} mode
 * @param {'compact'|'default'|'relaxed'} density
 */
export function resolveAntdInputs(preset, pack, mode, density) {
  const s = pack.scale;
  const d = preset.density;
  const controlHeight = density === 'compact'
    ? d.controlHCompact
    : density === 'relaxed' ? d.controlHRelaxed : d.controlH;

  return {
    fontFamily: pack.stacks.body,
    fontFamilyCode: pack.stacks.mono,
    // px numbers, because AntD's token system does arithmetic on these. The fluid
    // `display` role is deliberately excluded — a clamp() cannot be a number, and
    // AntD has no role that maps to it.
    fontSize: px(s.body.size),
    fontSizeLG: px(s.headline.size),
    fontSizeSM: px(s.subhead.size),
    fontSizeHeading1: px(s.title1.size),
    fontSizeHeading2: px(s.title2.size),
    fontSizeHeading3: px(s.title3.size),
    fontSizeHeading4: px(s.headline.size),
    fontSizeHeading5: px(s.callout.size),
    lineHeight: s.body.lh,
    borderRadius: px(preset.radius.sm),  // preset.radius.sm is emitted as --radius-ctl
    borderRadiusSM: px(preset.radius.xs),
    borderRadiusLG: px(preset.radius.card),
    borderRadiusXS: px(preset.radius.xs),
    controlHeight: px(controlHeight),
    controlHeightSM: px(d.controlHCompact),
    controlHeightLG: px(d.controlHRelaxed),
    buttonRadius: px(preset.radius.btn),
    motion: preset.motion.ambient !== '0s',
  };
}

/**
 * Parses a CSS length to a number for AntD's token arithmetic.
 * Returns the fallback for anything non-numeric (a clamp(), a calc()), because a
 * NaN reaching AntD's token pipeline produces `NaNpx` rules that fail silently.
 */
function px(value, fallback = 14) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export default resolveCssVars;
