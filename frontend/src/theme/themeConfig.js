/**
 * AntD 5.x theme — DERIVED, not declared.
 *
 * WHAT CHANGED AND WHY
 * This file used to export two frozen objects containing 91 hardcoded hex values.
 * That made AntD's generated component styles invisible to the brand axis: switching
 * to the `midnight` brand repainted every CSS-variable surface blue and left every
 * AntD button, input focus ring, tag, tab ink bar, menu selection, switch, checkbox,
 * slider and date picker on the old olive palette. Per-tenant theming was therefore
 * only ever half true.
 *
 * AntD cannot read a CSS custom property — it generates real CSS from JS values at
 * runtime — so it needs concrete strings for one mode. The fix is not to give it
 * custom properties, it is to feed it from the SAME source the custom properties
 * come from: theme/brands.js for colour, theme/presets/* for geometry and motion,
 * theme/fonts.js for the families and type scale. One source, two consumers.
 *
 * WHAT IS STILL DECLARED HERE, AND WHY THAT IS CORRECT
 * The neutral and status ramps (text greys, borders, success/error/warning/info).
 * Those are semantic, not brand: a tenant swapping their palette does not want their
 * error state to stop being red. They match the `--text` / `--green` / `--red`
 * tokens in theme/index.css, which is the same reasoning that file gives for
 * treating `--violet` as semantic rather than brand.
 */
import { theme } from 'antd';
import { BRANDS, DEFAULT_BRAND_ID } from './brands';
import { resolveAntdInputs } from './resolveTokens';
import { getPreset } from './presets';
import { getFontPack } from './fonts';

/* ---- colour helpers ------------------------------------------------------- */

/**
 * Applies an alpha to a colour that may be hex (#rgb / #rrggbb) or an existing
 * rgb()/rgba(). Brand token values are both — `aapna.light['--brand-primary']` is a
 * hex while `midnight.dark['--brand-primary-bg']` is already an rgba — so anything
 * tinting a brand colour has to handle each.
 *
 * Returns the input untouched for anything it cannot parse (a named colour, a
 * color-mix()), which degrades to "no tint" rather than to an invalid declaration
 * that AntD would emit as a broken rule.
 *
 * @param {string} color
 * @param {number} alpha 0-1
 * @returns {string}
 */
export function withAlpha(color, alpha) {
  if (typeof color !== 'string') return color;
  const c = color.trim();

  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const full = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
    if (full.length < 6) return c;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return c;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const [r, g, b] = m[1].split(/[,\s/]+/).filter(Boolean);
    if (r && g && b) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return c;
}

/* ---- semantic ramps ------------------------------------------------------- */

/**
 * Neutrals and status colours per mode. Mirrors theme/index.css — if a value moves
 * there it moves here, and vice versa. These are the only literals left in this
 * file, and they are deliberate: see the header.
 */
const NEUTRALS = {
  light: {
    colorSuccess: '#4a7c59',
    colorError: '#c0392b',
    colorWarning: '#d4a017',
    colorInfo: '#2980b9',
    colorText: '#2b2b2b',
    colorTextSecondary: '#5f6664',
    colorTextTertiary: '#6f7671',
    colorTextQuaternary: '#b4bcba',
    colorBorder: '#dde1df',
    colorBorderSecondary: '#eaebe8',
    boxShadow: '0 1px 3px rgba(16, 24, 20, 0.06)',
    boxShadowSecondary: '0 10px 28px rgba(16, 24, 20, 0.10)',
  },
  dark: {
    colorSuccess: '#5a9c6e',
    colorError: '#e74c3c',
    colorWarning: '#f0b429',
    colorInfo: '#3498db',
    colorText: '#eaeae6',
    colorTextSecondary: '#9ca5a2',
    colorTextTertiary: '#6f7875',
    colorTextQuaternary: '#454e4b',
    colorTextPlaceholder: '#6f7875',
    colorIcon: '#9ca5a2',
    colorIconHover: '#eaeae6',
    colorBorder: '#233330',
    colorBorderSecondary: '#1b2624',
    colorSplit: '#1b2624',
    // Tooltip ground. Deliberately a dark neutral, NOT the brand: brand green with
    // white text fails contrast on a dark surface. Pre-existing decision, kept.
    colorBgSpotlight: '#26302c',
    colorBgMask: 'rgba(0, 0, 0, 0.6)',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
    boxShadowSecondary: '0 6px 20px rgba(0, 0, 0, 0.35)',
  },
};

/**
 * The AntD geometry the app shipped with, restated so it can be held constant.
 *
 * WHY THIS EXISTS RATHER THAN JUST USING THE PRESET EVERYWHERE
 * AntD's tokens are global — one ConfigProvider paints all 24 routes. Feeding it
 * the preset's geometry before any route has been converted silently changed every
 * screen at once: base font 14 -> 15px, borderRadius 8 -> 12, borderRadiusLG
 * 14 -> 22, controlHeight 40 -> 38. That is a whole-app visual change landing
 * without review, and it cannot be verified route-by-route because it is not
 * route-scoped.
 *
 * So the app-wide provider keeps these values, and only surfaces that have actually
 * been built against the new system ask for the preset's geometry
 * (`presetGeometry: true`) — today that is /design-lab, which nests its own
 * provider. Stage 5 flips each route as it converts, and this block is deleted when
 * the last one lands.
 *
 * COLOUR IS NOT GATED. The brand derivation applies everywhere, because for the
 * default `aapna` brand it resolves to the same values that were hardcoded before —
 * so nothing moves — while making a tenant swap actually reach AntD, which is the
 * bug this rewrite exists to fix.
 */
const LEGACY_GEOMETRY = {
  borderRadius: 8,
  borderRadiusSM: 8,
  borderRadiusLG: 14,
  borderRadiusXS: 8,
  buttonRadius: 8,
  controlHeight: 40,
  controlHeightSM: 32,
  controlHeightLG: 48,
  fontSize: 14,
  fontSizeLG: 16,
  fontSizeSM: 12,
  fontSizeHeading1: 32,
  fontSizeHeading2: 26,
  fontSizeHeading3: 22,
  fontSizeHeading4: 18,
  fontSizeHeading5: 16,
  lineHeight: 1.6,
  motion: true,
  rowPy: 12,
};

/* ---- the builder ---------------------------------------------------------- */

/**
 * Builds a complete AntD theme config from the five axes.
 *
 * @param {object}  opts
 * @param {string} [opts.brandId]   key of BRANDS
 * @param {string} [opts.presetId]  key of PRESETS
 * @param {string} [opts.fontPackId] key of FONT_PACKS
 * @param {'light'|'dark'} [opts.mode]
 * @param {'compact'|'default'|'relaxed'} [opts.density]
 * @param {boolean} [opts.presetGeometry=false] use the preset's radii, control
 *   heights and type scale. Default false so unconverted routes keep the geometry
 *   they shipped with — see LEGACY_GEOMETRY above.
 * @returns {object} an antd ConfigProvider `theme` object
 */
export function buildAntdTheme({
  brandId = DEFAULT_BRAND_ID,
  presetId,
  fontPackId,
  mode = 'light',
  density = 'default',
  presetGeometry = false,
} = {}) {
  const isDark = mode === 'dark';
  const brand = (BRANDS[brandId] || BRANDS[DEFAULT_BRAND_ID])[mode];
  const preset = getPreset(presetId);
  const pack = getFontPack(fontPackId);
  const neutral = NEUTRALS[mode];
  // Families always come from the font pack — swapping the font is meant to work
  // app-wide, and a stack change reflows nothing structurally. Only the metrics
  // (sizes, radii, heights) are gated.
  const presetInputs = resolveAntdInputs(preset, pack, mode, density);
  const base = presetGeometry
    ? presetInputs
    : {
      ...LEGACY_GEOMETRY,
      fontFamily: presetInputs.fontFamily,
      fontFamilyCode: presetInputs.fontFamilyCode,
    };

  const primary = brand['--brand-primary'];
  /* The contrast-bearing pair (see the note in theme/index.css): --brand-solid is the
     solid FILL, a shade below --brand-primary so a white label clears 4.5:1, and
     --brand-on-solid is that label. Any surface that carries white text takes these,
     never --brand-primary. */
  const brandSolid = brand['--brand-solid'];
  const brandOnSolid = brand['--brand-on-solid'];
  const primaryHover = brand['--brand-primary-hover'];
  const primaryActive = brand['--brand-primary-active'];
  const surface = brand['--brand-surface'];
  const canvas = brand['--brand-canvas'];

  return {
    /**
     * STATED EXPLICITLY, and load-bearing — do not remove as redundant.
     *
     * A nested <ConfigProvider> INHERITS the parent's algorithm when it does not
     * declare one. <ForceLight> nests a light provider inside the app-wide one to
     * pin the public token pages; with no algorithm here, darkAlgorithm leaked
     * through from the parent during a dark session. The CSS variables were
     * correctly light so text stayed dark, but AntD's generated component styles
     * were dark-derived, and a candidate opening an emailed link while the
     * operator's session was dark got, for example, an <Alert> with near-black text
     * on a near-black fill.
     *
     * darkAlgorithm also derives dark-correct values for every token NOT set below
     * (status backgrounds like colorErrorBg, Tag preset palettes, disabled fills).
     * Explicit entries still override its output.
     */
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,

    token: {
      ...base,
      ...neutral,
      wireframe: false,

      /* Brand-derived. Every one of these used to be a literal. */
      colorPrimary: primary,
      colorPrimaryHover: primaryHover,
      colorPrimaryActive: primaryActive,
      colorPrimaryBg: brand['--brand-primary-bg'],
      colorPrimaryBgHover: withAlpha(primary, isDark ? 0.18 : 0.14),
      colorLink: primary,
      colorLinkHover: primaryHover,
      colorLinkActive: primaryActive,
      colorFill: withAlpha(primary, isDark ? 0.10 : 0.06),
      colorFillSecondary: withAlpha(primary, isDark ? 0.06 : 0.04),
      colorFillTertiary: withAlpha(primary, 0.04),
      colorFillQuaternary: isDark ? 'rgba(255, 255, 255, 0.03)' : withAlpha(primary, 0.02),
      controlItemBgHover: withAlpha(primary, isDark ? 0.08 : 0.05),
      controlItemBgActive: withAlpha(primary, isDark ? 0.18 : 0.12),

      /* Surfaces come from the brand too, so a tenant's canvas moves AntD's
         containers with it rather than leaving white cards on a tinted page. */
      colorBgContainer: surface,
      colorBgElevated: isDark ? '#1a221f' : surface,
      colorBgLayout: canvas,
      ...(isDark ? {} : { colorBgSpotlight: primary }),
    },

    components: {
      Button: {
        controlHeight: base.controlHeight,
        borderRadius: base.buttonRadius,
        borderRadiusSM: base.buttonRadius,
        borderRadiusLG: base.buttonRadius,
        fontWeight: 600,
        // The rest/hover glow lives on the .ui-btn class so it can read the preset's
        // --glow-brand and switch off under a preset with glow disabled. AntD's own
        // primaryShadow is zeroed rather than fighting it with !important.
        // Zeroed only when src/ui owns the button, where .ui-btn paints the glow
        // from --glow-brand. Unconverted routes still use AntD's own primary
        // buttons and must keep the shadow they shipped with.
        ...(presetGeometry
          ? { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' }
          : { primaryShadow: `0 4px 14px ${withAlpha(primary, 0.30)}` }),
      },
      Card: {
        borderRadiusLG: base.borderRadiusLG,
        boxShadowTertiary: neutral.boxShadow,
      },
      Table: {
        headerBg: isDark ? '#151e1b' : canvas,
        headerColor: neutral.colorText,
        rowHoverBg: withAlpha(primary, isDark ? 0.06 : 0.04),
        borderColor: neutral.colorBorderSecondary,
        cellPaddingBlock: presetGeometry ? parseFloat(preset.density.rowPy) : LEGACY_GEOMETRY.rowPy,
        borderRadiusLG: base.borderRadiusLG,
      },
      Menu: {
        itemBg: 'transparent',
        itemSelectedBg: withAlpha(primary, isDark ? 0.18 : 0.10),
        itemSelectedColor: primary,
        itemHoverBg: withAlpha(primary, isDark ? 0.08 : 0.05),
        itemHoverColor: isDark ? primary : primaryHover,
        itemActiveBg: withAlpha(primary, isDark ? 0.22 : 0.15),
        darkItemBg: 'transparent',
        darkItemSelectedBg: withAlpha(primary, 0.18),
        darkItemSelectedColor: primary,
        iconSize: 18,
        itemBorderRadius: base.borderRadius,
      },
      Layout: {
        siderBg: surface,
        headerBg: surface,
        bodyBg: canvas,
      },
      Input: {
        activeBorderColor: primary,
        hoverBorderColor: primaryHover,
        activeShadow: `0 0 0 2px ${withAlpha(primary, isDark ? 0.2 : 0.15)}`,
        borderRadius: base.borderRadius,
      },
      Select: {
        optionSelectedBg: withAlpha(primary, isDark ? 0.18 : 0.10),
        borderRadius: base.borderRadius,
      },
      Tag: { borderRadiusSM: base.borderRadiusSM },
      Badge: { dotSize: 8 },
      Segmented: { borderRadius: base.borderRadius, itemSelectedBg: surface },
      Modal: {
        borderRadiusLG: presetGeometry ? parseFloat(preset.radius.sheet) : LEGACY_GEOMETRY.borderRadiusLG,
        ...(isDark ? { contentBg: '#1a221f', headerBg: '#1a221f' } : {}),
      },
      Drawer: isDark ? { colorBgElevated: '#1a221f' } : {},
      /* Light mode inherited colorBgSpotlight: primary from the global token above, so
         tooltips were #7a922e with a white label — measured 3.51:1, under the 4.5:1 AA
         floor for normal text. --brand-solid exists precisely for a white-labelled fill
         and measures 4.85:1. Fixed 2026-08-31. Dark mode was already an explicit,
         passing pair and is unchanged. */
      Tooltip: isDark
        ? { colorBgSpotlight: '#26302c', colorTextLightSolid: '#eaeae6' }
        : { colorBgSpotlight: brandSolid, colorTextLightSolid: brandOnSolid },
      Tabs: {
        inkBarColor: primary,
        itemSelectedColor: primary,
        itemHoverColor: primaryHover,
      },
      Breadcrumb: {
        lastItemColor: neutral.colorText,
        linkColor: neutral.colorTextSecondary,
        linkHoverColor: primary,
        separatorColor: neutral.colorTextQuaternary,
      },
    },
  };
}

/**
 * Back-compatible presets built with the shipped defaults. Kept so anything that
 * imported `lightTheme` / `darkTheme` before the axes existed keeps working — and
 * because <ForceLight> genuinely wants a light theme that ignores the session mode.
 * Prefer buildAntdTheme() at call sites that know the active axes.
 */
export const lightTheme = buildAntdTheme({ mode: 'light' });
export const darkTheme = buildAntdTheme({ mode: 'dark' });

export default { buildAntdTheme, lightTheme, darkTheme };
