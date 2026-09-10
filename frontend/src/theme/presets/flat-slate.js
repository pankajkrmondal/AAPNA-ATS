/**
 * Preset: Flat Slate — the proof that the preset axis is real.
 *
 * WHY THIS FILE EXISTS
 * A design system with one theme has never been *shown* to be themeable. Coupling
 * only surfaces when you try the second one: a component that hardcodes a 22px
 * radius, assumes a glow is present, or paints its own translucent fill will look
 * correct under Liquid Glass forever and break the moment anything else is applied.
 * This preset is deliberately the opposite of Liquid Glass on every axis — opaque
 * instead of translucent, square instead of curved, shadowed instead of glowing,
 * fast-eased instead of spring-settled — so that "it renders correctly under both"
 * is a meaningful statement rather than a hopeful one.
 *
 * It is not a throwaway. It stays in the registry as the regression test that runs
 * on every converted route (see the swap matrix in the verification plan), for the
 * same reason theme/brands.js keeps `midnight`: exercising the mechanism through the
 * same code path a real tenant would use is what stops the mechanism from rotting.
 *
 * It is also a genuinely usable dense-enterprise look, which is the point — if
 * someone later wants the app flat and compact, this is the one-line answer.
 */

const flatSlate = {
  id: 'flat-slate',
  name: 'Flat Slate',
  description: 'Opaque, square, shadowed. Dense enterprise — and the decoupling test.',

  /** Every effect off. A component that still looks glassy under this preset is
   *  painting its own material instead of reading the tokens. */
  flags: {
    blurChrome: false,
    blurOverlay: false,
    blurContent: false,
    glow: false,
    squircle: false,
    specular: false,
    spotlight: false,
    vibrancy: false,
  },

  /** Small, conventional radii — the opposite end of the scale from Liquid Glass's
   *  22px cards, so any hardcoded corner shows up immediately. */
  radius: {
    xs: '3px',
    sm: '4px',
    btn: '4px',
    card: '6px',
    sheet: '8px',
    pill: '999px',
  },

  /* The material tokens Liquid Glass adds all have to exist here too, set to their
     inert values. A token that only one preset defines is a token components will
     quietly hardcode around the first time it comes back empty. */

  /** Fast and linear-ish. No spring, no overshoot; `pressScale` at 1 disables the
   *  press transform entirely, which catches any component that animates on press
   *  by hardcoding a scale rather than reading the token. */
  motion: {
    instant: '60ms',
    fast: '110ms',
    base: '150ms',
    sheet: '180ms',
    cinematic: '220ms',
    ambient: '0s',
    staggerStep: '25ms',
    easeStandard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeSpring: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeEmphasized: 'cubic-bezier(0.4, 0, 0.2, 1)',
    pressScale: '1',
  },

  /** Tighter than Liquid Glass throughout — this is the dense variant. */
  density: {
    controlHCompact: '26px',
    controlH: '32px',
    controlHRelaxed: '40px',
    cardPadCompact: '12px',
    cardPad: '16px',
    cardPadRelaxed: '20px',
    rowPyCompact: '6px',
    rowPy: '9px',
    rowPyRelaxed: '12px',
    rowPx: '12px',
  },

  light: {
    /* Fully opaque at every weight. The three names still resolve — components ask
       for `thin`/`regular`/`thick` regardless of preset — they just stop meaning
       translucency and start meaning a subtle value step. */
    '--material-thin': '#fbfbfa',
    '--material-regular': '#ffffff',
    '--material-thick': '#ffffff',

    /* Real 1px borders, because with no translucency and no rim a hairline is not
       enough to define an edge. This is the honest flat-UI answer. */
    '--hairline-color': 'var(--border)',
    '--hairline': '1px solid var(--border)',

    /* Glow becomes a plain focus ring and conventional shadows. Kept as the same
       token NAMES so no component needs a conditional — a card asking for
       --glow-brand under this preset simply gets a border-ish shadow. */
    '--glow-brand': '0 0 0 1px var(--border)',
    '--glow-brand-strong': '0 1px 2px rgba(16, 24, 20, 0.10), 0 2px 6px rgba(16, 24, 20, 0.08)',
    '--glow-success': '0 0 0 1px color-mix(in srgb, var(--green) 40%, transparent)',
    '--glow-danger': '0 0 0 1px color-mix(in srgb, var(--red) 40%, transparent)',
    '--glow-warning': '0 0 0 1px color-mix(in srgb, var(--warning) 45%, transparent)',
    '--glow-focus': '0 0 0 2px color-mix(in srgb, var(--brand-primary) 45%, transparent)',
    '--bloom': 'none',
    '--glow-opacity': '0',

    '--material-hilite': 'none',
    '--material-specular': 'none',
    '--material-rim': 'none',
    '--material-rim-opacity': '0',
    '--material-tint': 'transparent',
    '--vibrancy-saturate': '1',
  },

  dark: {
    '--material-thin': '#161b1a',
    '--material-regular': '#1b2220',
    '--material-thick': '#1b2220',

    '--hairline-color': 'var(--border)',
    '--hairline': '1px solid var(--border)',

    '--glow-brand': '0 0 0 1px var(--border)',
    '--glow-brand-strong': '0 1px 2px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3)',
    '--glow-success': '0 0 0 1px color-mix(in srgb, var(--green) 45%, transparent)',
    '--glow-danger': '0 0 0 1px color-mix(in srgb, var(--red) 45%, transparent)',
    '--glow-warning': '0 0 0 1px color-mix(in srgb, var(--warning) 50%, transparent)',
    '--glow-focus': '0 0 0 2px color-mix(in srgb, var(--brand-primary) 55%, transparent)',
    '--bloom': 'none',
    '--glow-opacity': '0',

    '--material-hilite': 'none',
    '--material-specular': 'none',
    '--material-rim': 'none',
    '--material-rim-opacity': '0',
    '--material-tint': 'transparent',
    '--vibrancy-saturate': '1',
  },
};

export default flatSlate;
