/**
 * DesignContext — owns the preset, font pack and density axes.
 *
 * Completes the set of orthogonal visual axes the app is built on:
 *
 *   mode    ThemeContext   light / dark            the user's choice
 *   brand   BrandContext   aapna / midnight        the organization's colour
 *   preset  this file      liquid-glass / flat-slate   the look
 *   font    this file      inter-sora / figtree / system   the voice + type scale
 *   density this file      compact / default / relaxed     the information rate
 *
 * Deliberately mirrors BrandContext's construction, because the constraints are
 * identical and that file already solved them:
 *
 *   - Tokens are written with `style.setProperty` on <html> rather than through a
 *     <style> tag, so they beat the stylesheet's `:root` defaults without needing
 *     !important, and a switch is a cheap attribute mutation rather than a
 *     stylesheet reparse.
 *   - Mode-dependent values are published as `-light` / `-dark` PAIRS and selected
 *     by theme/tokens.css. Never write the active mode alone — an inline value beats
 *     the `[data-theme='light']` re-scoping that <ForceLight> uses to pin the public
 *     token pages, so a candidate opening an emailed link during a dark session
 *     would get dark surfaces. See the long note in theme/resolveTokens.js.
 *   - No cleanup that removes the properties: the effect overwrites the same keys on
 *     change, and clearing first would expose a frame of untokenised layout.
 *
 * This provider does NOT build the AntD theme. It exposes the resolved preset and
 * pack; AppShell combines them with the active mode (which it already has) and calls
 * buildAntdTheme. Keeping that in AppShell avoids making this provider depend on
 * ThemeContext and lets <ForceLight> build a light-pinned AntD theme from the same
 * inputs.
 */
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  PRESETS, DEFAULT_PRESET_ID, PRESET_STORAGE_KEY, resolvePresetId, getPreset,
  DENSITIES, DEFAULT_DENSITY, DENSITY_STORAGE_KEY, resolveDensity,
} from '../theme/presets';
import {
  FONT_PACKS, DEFAULT_FONT_PACK_ID, FONT_STORAGE_KEY, resolveFontPackId, getFontPack,
  applyFontStylesheet,
} from '../theme/fonts';
import { resolveCssVars } from '../theme/resolveTokens';

/** @type {React.Context} */
export const DesignContext = createContext(null);

/** Writes a key to localStorage, tolerating private-mode failures. */
function persist(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — the choice just won't survive reload */
  }
}

/**
 * @param {{ children: React.ReactNode, overrides?: Record<string,string> }} props
 *   `overrides` is the seam for a server-driven design config, matching the one
 *   BrandProvider already exposes: a token map that wins over the resolved preset.
 *   Nothing supplies it yet.
 */
export function DesignProvider({ children, overrides }) {
  const [presetId, setPresetIdState] = useState(resolvePresetId);
  const [fontPackId, setFontPackIdState] = useState(resolveFontPackId);
  const [density, setDensityState] = useState(resolveDensity);

  const preset = useMemo(() => getPreset(presetId), [presetId]);
  const fontPack = useMemo(() => getFontPack(fontPackId), [fontPackId]);

  // The whole token map. Recomputed only when the preset or pack changes — mode and
  // brand do not appear here by design, because both are resolved in CSS.
  const cssVars = useMemo(
    () => ({ ...resolveCssVars(preset, fontPack), ...overrides }),
    [preset, fontPack, overrides],
  );

  useEffect(() => {
    const el = document.documentElement;
    for (const [key, value] of Object.entries(cssVars)) {
      el.style.setProperty(key, value);
    }
    el.setAttribute('data-preset', preset.id);
    el.setAttribute('data-density', density);

    /* Feature flags as ATTRIBUTES, not custom properties.
       A CSS variable cannot be matched in a selector, so `--flag-squircle: 0` could
       never turn a rule off — which is why four of the five flags sat emitted and
       unread while ui.css hardcoded `[data-preset='flat-slate']` instead. Coupling
       behaviour to one preset's NAME means any third preset silently inherits the
       first one's material regardless of what it declares.

       `data-preset` stays too, but only as a debugging affordance — nothing should
       select on it. */
    for (const [name, on] of Object.entries(preset.flags || {})) {
      const attr = `data-flag-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      el.setAttribute(attr, on ? '1' : '0');
    }
  }, [cssVars, preset.id, preset.flags, density]);

  // Swapping the webfont stylesheet is separate from the token write: the token
  // write is synchronous and cheap, this one is a network fetch. Splitting them
  // means a density change does not touch the <link> at all.
  useEffect(() => {
    applyFontStylesheet(fontPack);
  }, [fontPack]);

  const setPreset = useCallback((next) => {
    if (!PRESETS[next]) return;
    persist(PRESET_STORAGE_KEY, next);
    setPresetIdState(next);
  }, []);

  const setFontPack = useCallback((next) => {
    if (!FONT_PACKS[next]) return;
    persist(FONT_STORAGE_KEY, next);
    setFontPackIdState(next);
  }, []);

  const setDensity = useCallback((next) => {
    if (!DENSITIES.includes(next)) return;
    persist(DENSITY_STORAGE_KEY, next);
    setDensityState(next);
  }, []);

  const value = useMemo(() => ({
    presetId, preset, setPreset,
    fontPackId, fontPack, setFontPack,
    density, setDensity,
    availablePresets: Object.values(PRESETS).map((p) => ({
      id: p.id, name: p.name, description: p.description,
    })),
    availableFontPacks: Object.values(FONT_PACKS).map((f) => ({
      id: f.id, name: f.name, description: f.description,
    })),
    availableDensities: DENSITIES,
    defaults: {
      preset: DEFAULT_PRESET_ID,
      fontPack: DEFAULT_FONT_PACK_ID,
      density: DEFAULT_DENSITY,
    },
  }), [presetId, preset, setPreset, fontPackId, fontPack, setFontPack, density, setDensity]);

  return <DesignContext.Provider value={value}>{children}</DesignContext.Provider>;
}

export default DesignContext;
