/**
 * Preset registry — the "look" axis of the design system.
 *
 * The app now has five orthogonal visual axes, and keeping them orthogonal is the
 * whole point of this layer:
 *
 *   mode    ∈ { light, dark }        ThemeContext   — the user's choice
 *   brand   ∈ BRANDS                 BrandContext   — the organization's choice
 *   preset  ∈ PRESETS                DesignContext  — the look (this file)
 *   font    ∈ FONT_PACKS             DesignContext  — the voice (theme/fonts.js)
 *   density ∈ { compact, default, relaxed }         — the information rate
 *
 * A preset owns geometry, material, glow, motion and density. It deliberately does
 * NOT own colour: colour is the brand axis, and a preset that shipped its own
 * palette would silently break per-tenant theming. Everything in a preset that needs
 * a brand colour references var(--brand-primary) so it follows the brand for free.
 *
 * WHAT A PRESET CANNOT CHANGE — worth stating, because it bounds the promise:
 * layout. Where the sidebar sits, how many columns a dashboard band has, what a
 * page's information hierarchy is. Those live in src/ui components and the pages
 * themselves. A future look that keeps this structure is a config change here; one
 * that rearranges the app is not, and no token layer would make it so.
 */
import liquidGlass from './liquid-glass';
import flatSlate from './flat-slate';

export const PRESETS = {
  'liquid-glass': liquidGlass,
  'flat-slate': flatSlate,
};

export const DEFAULT_PRESET_ID = 'liquid-glass';
export const PRESET_STORAGE_KEY = 'ats_preset';

/** Density is a preset-independent axis, but its allowed values live here so the
 *  switcher and the resolver agree on one list. */
export const DENSITIES = ['compact', 'default', 'relaxed'];
export const DEFAULT_DENSITY = 'default';
export const DENSITY_STORAGE_KEY = 'ats_density';

/**
 * Resolves the active preset id: a localStorage override, else the default.
 * A function rather than a constant so a tenant or user preference can become
 * another source without touching callers — same shape as resolveBrandId().
 * @returns {string} a key of PRESETS
 */
export function resolvePresetId() {
  try {
    const stored = localStorage.getItem(PRESET_STORAGE_KEY);
    if (stored && PRESETS[stored]) return stored;
  } catch {
    /* storage unavailable (private mode) */
  }
  return DEFAULT_PRESET_ID;
}

/** @returns {string} one of DENSITIES */
export function resolveDensity() {
  try {
    const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (DENSITIES.includes(stored)) return stored;
  } catch {
    /* storage unavailable (private mode) */
  }
  return DEFAULT_DENSITY;
}

/** @param {string} id @returns {object} the preset, falling back to the default */
export function getPreset(id) {
  return PRESETS[id] || PRESETS[DEFAULT_PRESET_ID];
}

export default PRESETS;
