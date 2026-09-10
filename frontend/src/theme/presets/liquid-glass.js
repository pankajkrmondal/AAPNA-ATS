/**
 * Preset: Liquid Glass — iOS-flavoured glassmorphism with glow.
 *
 * Extends the shipped Aurora Glass material model (docs/design/AURORA-GLASS-
 * ROLLOUT-PLAN.md Part I) rather than replacing it: the four tiers, the gradient
 * rim, the specular sheen and the brand-hued depth ramp all survive. What this adds
 * is iOS geometry (larger continuous corners, hairline separators), a thin/regular/
 * thick material split within each tier, and glow — colour bleeding out of a source
 * rather than a shadow falling under it.
 *
 * MODE-DEPENDENT VALUES GO IN `light` / `dark`, NOT AT THE TOP LEVEL.
 * resolveTokens emits those as `-light` / `-dark` suffixed pairs and tokens.css
 * selects between them, exactly as theme/brands.js already does. This is what keeps
 * <ForceLight> working on the public token pages: an inline mode-specific value on
 * <html> would beat the [data-theme='light'] re-scoping those pages rely on, and a
 * candidate opening an emailed link during a dark session would get dark surfaces on
 * a page that must be light. That bug has been fixed once already — see brands.js.
 *
 * GLOW IS WRITTEN IN TERMS OF var(--brand-primary), NOT A HEX.
 * That is what makes it follow a tenant brand for free: switch to `midnight` and the
 * glow turns blue with no edit here. Any raw hex in this file would be invisible to
 * the brand axis, which is the same law that applies to components.
 */

const liquidGlass = {
  id: 'liquid-glass',
  name: 'Liquid Glass',
  description: 'iOS materials, large continuous corners, luminous accents, spring motion.',

  /**
   * Feature switches the components read. Kept as flags rather than baked into the
   * CSS so a preset can turn a whole class of effect off without leaving orphaned
   * rules behind — `flat-slate` sets every one of these false.
   */
  flags: {
    blurChrome: true,     // tier 1 (sidebar, topbar) — sticky, rasterized once
    blurOverlay: true,    // tier 4 (sheets, dropdowns) — transient, above everything
    blurContent: false,   // tiers 2-3 stay unblurred. See the note below.
    glow: true,
    squircle: true,       // corner-shape where supported; border-radius everywhere else
    specular: true,       // the diagonal sheen on card bodies
    spotlight: true,      // cursor-tracked highlight (usePointerSpotlight)
    vibrancy: true,       // text/icons pick up backdrop saturation
  },

  /**
   * WHY blurContent IS FALSE, AND WHY IT SHOULD STAY FALSE.
   * Measured, not assumed (aurora-glass.css:256). A backdrop-filter on a *scrolling*
   * surface re-blurs its backdrop every frame, and this backdrop is soft gradients
   * with 3% grain — blur buys nothing visible there while costing a repaint per
   * frame. Tiers 2-3 get the material read from tint + rim + hilite + vibrancy
   * instead, which demonstrably works today. Tiers 1 and 4 blur because tier 1 is
   * sticky (rasterized once, never scrolls) and tier 4 is transient.
   */

  /**
   * Geometry. iOS reads as iOS largely because of large, soft, continuously-curved
   * corners. The previous scale topped out at 16px with buttons at 8-10px; this
   * raises the ceiling and — more importantly — gives buttons ONE radius instead of
   * the four found across 224 call sites.
   */
  radius: {
    xs: '10px',     // chips, tags, table cells
    // Inputs move WITH the button rather than staying at 12px. A 12px field beside
    // an 18px button reads as a mistake rather than as a hierarchy — the two sit on
    // the same row constantly, so they have to be in the same family.
    sm: '15px',     // inputs, small controls
    btn: '18px',    // every button, every size
    card: '24px',   // cards, panels
    sheet: '32px',  // modals, drawers, popovers
    pill: '999px',  // segmented, badges, avatars
  },

  /**
   * Motion. --ease-spring already existed and was barely used; iOS motion is
   * spring-settled rather than linearly eased, so it becomes the default for
   * anything that changes size or position, and the eased curves are kept for
   * opacity and colour where a spring would read as a wobble.
   */
  motion: {
    instant: '90ms',
    fast: '160ms',
    base: '240ms',
    sheet: '380ms',
    cinematic: '520ms',
    ambient: '26s',
    staggerStep: '55ms',
    easeStandard: 'cubic-bezier(0.22, 1, 0.36, 1)',      // = the existing --ease-out-quint
    easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',     // = the existing --ease-spring
    easeEmphasized: 'cubic-bezier(0.2, 0, 0, 1)',
    pressScale: '0.96',
  },

  /**
   * Density. These token NAMES already exist in index.css:184-196 and were never
   * wired to anything. The values are unchanged; this preset just gives them an
   * owner so [data-density] can move them.
   */
  density: {
    controlHCompact: '30px',
    controlH: '38px',
    controlHRelaxed: '46px',
    cardPadCompact: '16px',
    cardPad: '22px',
    cardPadRelaxed: '28px',
    rowPyCompact: '8px',
    rowPy: '12px',
    rowPyRelaxed: '16px',
    rowPx: '16px',
  },

  light: {
    /* Material — three fill weights per surface, so a nested panel reads as a
       THINNER pane of the same glass rather than a different colour. This is the
       fix for the "slab" failure mode: a nested surface that painted its own opaque
       fill used to sit on the glass like a sticker. */
    '--material-thin': 'rgba(255, 255, 255, 0.48)',
    '--material-regular': 'rgba(255, 255, 255, 0.62)',
    '--material-thick': 'rgba(255, 255, 255, 0.86)',

    /* Hairlines. iOS separates with sub-pixel translucent rules, never 1px solid
       grey — a grey rule on a light ground reads as dirt at the same value that a
       translucent one reads as an edge. currentColor means it works on any surface. */
    '--hairline-color': 'color-mix(in srgb, currentColor 12%, transparent)',
    '--hairline': '0.5px solid color-mix(in srgb, currentColor 12%, transparent)',

    /* Glow. Tight radius and low alpha in light mode — this is the hard direction
       for glow, because an untinted bloom on a light ground reads as blur or dirt
       rather than as light. Brand-hued at every stop, following the same rule that
       made the light-mode depth ramp work (it mixes from a saturated brand mid-tone,
       never black). Dark mode below runs wider and brighter. */
    '--glow-brand': `
      0 0 0 1px color-mix(in srgb, var(--brand-primary) 22%, transparent),
      0 4px 14px color-mix(in srgb, var(--brand-primary) 22%, transparent),
      0 0 28px -10px color-mix(in srgb, var(--brand-primary) 40%, transparent)`,
    '--glow-brand-strong': `
      0 0 0 1px color-mix(in srgb, var(--brand-primary) 34%, transparent),
      0 6px 20px color-mix(in srgb, var(--brand-primary) 30%, transparent),
      0 0 40px -8px color-mix(in srgb, var(--brand-primary) 55%, transparent)`,
    '--glow-success': '0 0 0 1px color-mix(in srgb, var(--green) 26%, transparent), 0 4px 16px color-mix(in srgb, var(--green) 24%, transparent)',
    '--glow-danger': '0 0 0 1px color-mix(in srgb, var(--red) 26%, transparent), 0 4px 16px color-mix(in srgb, var(--red) 24%, transparent)',
    '--glow-warning': '0 0 0 1px color-mix(in srgb, var(--warning) 30%, transparent), 0 4px 16px color-mix(in srgb, var(--warning) 26%, transparent)',
    /* Replaces the flat `outline: 2px solid var(--gold)` focus ring. A ring plus a
       bloom stays visible against a glass surface, where a hairline outline can be
       lost in the rim gradient. */
    '--glow-focus': `
      0 0 0 3px color-mix(in srgb, var(--brand-primary) 20%, transparent),
      0 0 18px color-mix(in srgb, var(--brand-primary) 30%, transparent)`,
    '--bloom': 'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--brand-primary) 18%, transparent) 0%, transparent 68%)',
    '--glow-opacity': '1',

    /* Inner light — the top edge catches light, the bottom inner shadow gives the
       pane thickness. Without the second half a glass surface reads as a hole
       rather than as a sheet lying on the page. Deepened from v1: the bottom shadow
       was too weak to register, which is a large part of why the glass read flat. */
    '--material-hilite': 'inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 -22px 34px -22px rgb(var(--shade-rgb) / 0.26)',

    /* The diagonal specular sheen. v1's version topped out at 0.50 alpha and faded
       by 34%, which on a near-white surface was invisible. A specular highlight is
       the single strongest cue that something is glass rather than paper, so it
       gets a brighter peak and a longer, steeper falloff. */
    '--material-specular': 'linear-gradient(135deg, rgba(255, 255, 255, 0.92) 0%, rgba(255, 255, 255, 0.34) 22%, rgba(255, 255, 255, 0.04) 44%, transparent 58%)',

    /* The rim, split out from the sheen so a preset can tune the two independently.
       v1 tied the rim's opacity to --flag-specular, so softening one softened the
       other — and the rim is what defines the pane's EDGE, which is exactly what a
       translucent surface loses against a light ground. */
    '--material-rim': 'linear-gradient(140deg, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.22) 38%, color-mix(in srgb, var(--brand-primary) 82%, transparent) 100%)',
    '--material-rim-opacity': '1',

    /* Saturation on the FILL, not a backdrop-filter — so it costs nothing and does
       not break the no-blur-on-scrolling-surfaces rule. This is what stops a tinted
       white panel reading as tracing paper. */
    '--vibrancy-saturate': '1.6',
    '--material-tint': 'color-mix(in srgb, var(--brand-primary) 5%, transparent)',
  },

  dark: {
    '--material-thin': 'rgba(24, 32, 29, 0.52)',
    '--material-regular': 'rgba(24, 32, 29, 0.68)',
    '--material-thick': 'rgba(20, 27, 24, 0.88)',

    '--hairline-color': 'color-mix(in srgb, currentColor 16%, transparent)',
    '--hairline': '0.5px solid color-mix(in srgb, currentColor 16%, transparent)',

    /* Wider and brighter than light. Glow is what dark mode is for — on a dark
       ground a bloom reads as emitted light, which is the effect the whole direction
       is after and which light mode can only approximate. */
    '--glow-brand': `
      0 0 0 1px color-mix(in srgb, var(--brand-primary) 30%, transparent),
      0 4px 18px color-mix(in srgb, var(--brand-primary) 30%, transparent),
      0 0 48px -8px color-mix(in srgb, var(--brand-primary) 58%, transparent)`,
    '--glow-brand-strong': `
      0 0 0 1px color-mix(in srgb, var(--brand-primary) 45%, transparent),
      0 6px 26px color-mix(in srgb, var(--brand-primary) 40%, transparent),
      0 0 64px -6px color-mix(in srgb, var(--brand-primary) 72%, transparent)`,
    '--glow-success': '0 0 0 1px color-mix(in srgb, var(--green) 34%, transparent), 0 4px 20px color-mix(in srgb, var(--green) 34%, transparent)',
    '--glow-danger': '0 0 0 1px color-mix(in srgb, var(--red) 34%, transparent), 0 4px 20px color-mix(in srgb, var(--red) 34%, transparent)',
    '--glow-warning': '0 0 0 1px color-mix(in srgb, var(--warning) 38%, transparent), 0 4px 20px color-mix(in srgb, var(--warning) 32%, transparent)',
    '--glow-focus': `
      0 0 0 3px color-mix(in srgb, var(--brand-primary) 28%, transparent),
      0 0 24px color-mix(in srgb, var(--brand-primary) 45%, transparent)`,
    '--bloom': 'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--brand-primary) 26%, transparent) 0%, transparent 68%)',
    '--glow-opacity': '1',

    '--material-hilite': 'inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 -22px 34px -22px rgba(0, 0, 0, 0.55)',

    /* Dark mode needs a softer specular than light: the same 0.92 peak on a dark
       pane reads as a white smear rather than as reflected light. */
    '--material-specular': 'linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.06) 26%, transparent 52%)',
    '--material-rim': 'linear-gradient(140deg, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0.06) 38%, color-mix(in srgb, var(--brand-primary) 72%, transparent) 100%)',
    '--material-rim-opacity': '1',

    '--vibrancy-saturate': '1.8',
    '--material-tint': 'color-mix(in srgb, var(--brand-primary) 8%, transparent)',
  },
};

export default liquidGlass;
