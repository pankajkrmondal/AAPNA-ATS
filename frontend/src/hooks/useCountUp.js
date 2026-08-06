import { useState, useEffect } from 'react';

/**
 * Animate a number from 0 up to `target` (easeOutCubic). Re-runs whenever the
 * target changes — e.g. when a KPI value updates after an upload.
 */
export default function useCountUp(target, duration = 750) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const safeTarget = Number(target) || 0;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(Math.round(safeTarget * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
