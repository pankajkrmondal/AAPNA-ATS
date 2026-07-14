/**
 * themeTransition — animates theme switches.
 *
 * Strategy (in order):
 *  1. prefers-reduced-motion → apply instantly, no animation.
 *  2. View Transitions API available → circular reveal expanding from the
 *     trigger coordinates (or viewport center when none given).
 *  3. Fallback (e.g. Firefox) → ~300ms CSS cross-fade driven by the
 *     `html.theme-transition` class (see "Theme switch transition" in
 *     src/theme/index.css).
 */

const FALLBACK_FADE_MS = 350;
const REVEAL_MS = 450;

/**
 * Run `apply` (the synchronous DOM + React state flip) inside a theme
 * transition.
 *
 * @param {() => void} apply - Callback that flips the theme synchronously.
 * @param {{ x: number, y: number }} [coords] - Viewport origin of the reveal.
 */
export function startThemeTransition(apply, coords) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    apply();
    return;
  }

  if (typeof document.startViewTransition !== 'function') {
    const root = document.documentElement;
    root.classList.add('theme-transition');
    apply();
    window.setTimeout(() => root.classList.remove('theme-transition'), FALLBACK_FADE_MS);
    return;
  }

  const transition = document.startViewTransition(() => apply());

  transition.ready
    .then(() => {
      const x = coords?.x ?? window.innerWidth / 2;
      const y = coords?.y ?? window.innerHeight / 2;
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: REVEAL_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    })
    // `ready` rejects when the transition is skipped (e.g. rapid toggles) — harmless.
    .catch(() => {});
}

export default startThemeTransition;
