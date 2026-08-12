/**
 * BrandContext — applies the active organization's brand tokens to the document.
 *
 * Sits *outside* ThemeContext's concerns: ThemeContext owns light/dark (the user's
 * choice), this owns which brand palette those modes are drawn from (the
 * organization's choice). Both write to :root, and theme/index.css aliases the
 * legacy `--gold` / `--ink` names onto the `--brand-*` tokens, so one brand switch
 * repaints every existing screen without touching their styles.
 *
 * Writes go through `style.setProperty` on <html> rather than a <style> tag so they
 * win over the stylesheet's `:root` defaults without needing !important, and so a
 * brand change is a cheap attribute mutation rather than a stylesheet reparse.
 */
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BRANDS, BRAND_STORAGE_KEY, DEFAULT_BRAND_ID, brandTokens, resolveBrandId,
} from '../theme/brands';

/** @type {React.Context} */
export const BrandContext = createContext(null);

/**
 * @param {{ children: React.ReactNode, overrides?: Record<string,string> }} props
 *   `overrides` is the seam for server-driven per-company themes: a token map that
 *   wins over the registry entry. Nothing supplies it yet.
 */
export function BrandProvider({ children, overrides }) {
  const [brandId, setBrandIdState] = useState(resolveBrandId);

  // Deliberately does NOT depend on the resolved light/dark mode: brandTokens emits
  // `-light` and `-dark` variants together and index.css selects between them. That
  // keeps mode switching in CSS, where <ForceLight> re-scoping already works — see
  // the note on brandTokens().
  useEffect(() => {
    const el = document.documentElement;
    const tokens = { ...brandTokens(brandId), ...overrides };
    Object.entries(tokens).forEach(([k, v]) => el.style.setProperty(k, v));
    el.setAttribute('data-brand', brandId);
    // No cleanup removing these: the effect overwrites the same keys on change,
    // and clearing first would expose a frame of unbranded colour.
  }, [brandId, overrides]);

  const setBrand = useCallback((next) => {
    if (!BRANDS[next]) return;
    try {
      localStorage.setItem(BRAND_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setBrandIdState(next);
  }, []);

  const value = useMemo(() => ({
    brandId,
    brand: BRANDS[brandId] || BRANDS[DEFAULT_BRAND_ID],
    setBrand,
    availableBrands: Object.values(BRANDS).map((b) => ({ id: b.id, name: b.name })),
  }), [brandId, setBrand]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export default BrandContext;
