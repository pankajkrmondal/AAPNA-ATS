/**
 * usePointerSpotlight — tracks the cursor and publishes its position as CSS
 * custom properties on the hovered surface, so a radial highlight can follow it.
 *
 * DESIGN: one delegated listener on a container, not one per card. A dashboard
 * has ~12 glass surfaces; attaching a pointermove handler to each would mean 12
 * listeners and 12 React refs for an effect that is purely presentational.
 * Instead we listen once on the page root and walk up from the event target to
 * the nearest `.spotlight` ancestor.
 *
 * Writes are coalesced into a single requestAnimationFrame so a fast drag across
 * the grid produces one style write per frame instead of one per pointer event.
 * Only custom properties are touched (`--mx` / `--my`), which the CSS consumes
 * inside a `radial-gradient` — no layout, no React re-render.
 *
 * Pair with `.spotlight` on the surface; see the `.ats-v2 .spotlight::after`
 * rule in theme/index.css.
 *
 * @param {{ current: HTMLElement|null }} rootRef Container to delegate from.
 */
import { useEffect } from 'react';

export default function usePointerSpotlight(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    let raf = null;
    let pending = null;

    const flush = () => {
      raf = null;
      if (!pending) return;
      const { el, x, y } = pending;
      pending = null;
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${x - rect.left}px`);
      el.style.setProperty('--my', `${y - rect.top}px`);
    };

    const onMove = (event) => {
      const el = event.target?.closest?.('.spotlight');
      if (!el) return;
      pending = { el, x: event.clientX, y: event.clientY };
      if (raf === null) raf = requestAnimationFrame(flush);
    };

    root.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      root.removeEventListener('pointermove', onMove);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [rootRef]);
}
