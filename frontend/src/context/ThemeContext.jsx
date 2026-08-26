/**
 * ThemeContext — Light / Dark / System theme management.
 *
 * The persisted *mode* ('light' | 'dark' | 'system') lives in localStorage
 * under `ats_theme`; the *resolved* theme ('light' | 'dark') is derived from
 * it. Default is 'light' — the OS preference is honored only when the user
 * explicitly picks 'system'. Switches animate via startThemeTransition
 * (circular reveal / cross-fade fallback).
 */
import { createContext, useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { startThemeTransition } from '../utils/themeTransition';

/** @type {React.Context} */
export const ThemeContext = createContext(null);

const STORAGE_KEY = 'ats_theme';
const MODES = ['light', 'dark', 'system'];
const THEME_COLOR = { light: '#7a922e', dark: '#0a0e0c' };

/**
 * Reads the initial mode: valid localStorage value → that mode, else 'light'.
 * Never falls back to the OS preference — that is what 'system' is for.
 * @returns {'light' | 'dark' | 'system'}
 */
function getInitialMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (MODES.includes(stored)) return stored;
  } catch {
    /* storage unavailable (private mode) */
  }
  return 'light';
}

const osIsDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** @returns {'light' | 'dark'} */
const resolveMode = (mode) => (mode === 'system' ? (osIsDark() ? 'dark' : 'light') : mode);

/** Syncs the resolved theme to the DOM (html attribute, color-scheme, theme-color meta). */
function applyResolvedTheme(resolved) {
  const el = document.documentElement;
  el.setAttribute('data-theme', resolved);
  el.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[resolved]);
}

/**
 * ThemeProvider wraps the app and provides theme state + controls.
 * @param {{ children: React.ReactNode }} props
 */
export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(getInitialMode);
  const [resolved, setResolved] = useState(() => resolveMode(getInitialMode()));

  // Persist the mode and keep the DOM in sync (covers initial mount too).
  useLayoutEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
    applyResolvedTheme(resolved);
  }, [mode, resolved]);

  // Follow live OS changes — only while in system mode.
  useEffect(() => {
    if (mode !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      const next = e.matches ? 'dark' : 'light';
      startThemeTransition(() => {
        applyResolvedTheme(next);
        flushSync(() => setResolved(next));
      });
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  /**
   * Sets the theme mode, animating from `coords` when provided.
   * @param {'light' | 'dark' | 'system'} nextMode
   * @param {{ x: number, y: number }} [coords] - Reveal origin in viewport px.
   */
  const setMode = useCallback((nextMode, coords) => {
    if (!MODES.includes(nextMode)) return;
    const nextResolved = resolveMode(nextMode);
    startThemeTransition(() => {
      applyResolvedTheme(nextResolved);
      flushSync(() => {
        setModeState(nextMode);
        setResolved(nextResolved);
      });
    }, coords);
  }, []);

  /**
   * Flips the resolved theme and pins it as an explicit mode (leaves 'system').
   * When called from a click, the reveal expands from the clicked element.
   * @param {React.MouseEvent} [event]
   */
  const toggleTheme = useCallback(
    (event) => {
      const next = resolved === 'dark' ? 'light' : 'dark';
      let coords;
      const target = event?.currentTarget;
      if (target?.getBoundingClientRect) {
        const rect = target.getBoundingClientRect();
        coords = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      setMode(next, coords);
    },
    [resolved, setMode],
  );

  const value = useMemo(
    () => ({
      mode,
      setMode,
      theme: resolved,
      isDark: resolved === 'dark',
      toggleTheme,
    }),
    [mode, setMode, resolved, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export default ThemeContext;
