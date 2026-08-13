/**
 * useCountUp — animates a number from 0 up to `target` (easeOutCubic).
 *
 * CONSOLIDATION NOTE: this existed in three near-identical copies — here, inside
 * StatCard.jsx, and inside VendorDashboard.jsx. StatCard's was the only one that
 * respected `prefers-reduced-motion`, handled non-numeric values, and formatted with
 * thousands separators, so its implementation was promoted here and the other two
 * deleted. That makes the reduced-motion guard apply everywhere numbers animate,
 * which is an accessibility fix and not just tidying: KpiCard and VendorDashboard
 * previously animated for users who had asked for no motion.
 *
 * Returns a STRING (locale-formatted) for numeric targets, so callers render it
 * directly. Non-numeric targets pass straight through unanimated.
 *
 * @param {number|string} target
 * @param {number} [duration] ms
 * @returns {string}
 */
import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function useCountUp(target, duration = 1100) {
  const isNumeric = typeof target === 'number' && Number.isFinite(target);
  const [display, setDisplay] = useState(isNumeric ? 0 : target);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!isNumeric) {
      setDisplay(target);
      return undefined;
    }
    // Zero needs no animation, and animating to it looks like a glitch.
    if (prefersReducedMotion() || target === 0) {
      setDisplay(target);
      return undefined;
    }

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3; // easeOutCubic
      setDisplay(Math.round(target * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [target, duration, isNumeric]);

  return isNumeric ? display.toLocaleString() : display;
}
