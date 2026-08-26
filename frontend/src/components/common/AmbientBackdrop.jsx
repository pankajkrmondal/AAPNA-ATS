/**
 * AmbientBackdrop — the living canvas that makes glassmorphism actually work.
 *
 * `backdrop-filter` blurs whatever sits behind an element. The app canvas used to
 * be a flat colour, so blurring it returned that same flat colour and every
 * "glass" surface was really just a translucent panel. This component supplies
 * something worth refracting: a drifting aurora, the AAPNA wordmark as a large
 * faint watermark, and a fine grain that keeps the gradients from banding.
 *
 * PERFORMANCE CONTRACT (the reason this is one fixed element, not per-page decor):
 *  - `position: fixed` means the whole stack is excluded from scroll repaint, so
 *    the blurred surfaces above it are not re-composited on every wheel tick.
 *  - The blobs animate `transform` only — compositor work, no layout, no paint.
 *    Contrast with the hero's older `meshDrift`, which animates
 *    `background-position` and therefore repaints; that is affordable for one
 *    small card but not for a full-viewport plane.
 *  - `pointer-events: none` throughout, so it never intercepts a click.
 *
 * All geometry, colour and motion live in theme/index.css under `.ats-v2` —
 * this file is deliberately just the layer skeleton.
 */
import AapnaLogo from './AapnaLogo';

export default function AmbientBackdrop() {
  return (
    <div className="ats-backdrop" aria-hidden="true">
      {/* Drifting colour field — olive-led, so it reads as AAPNA rather than
          as generic "AI product" purple. */}
      <div className="ats-aurora">
        <span className="ats-aurora__blob ats-aurora__blob--1" />
        <span className="ats-aurora__blob ats-aurora__blob--2" />
        <span className="ats-aurora__blob ats-aurora__blob--3" />
        <span className="ats-aurora__blob ats-aurora__blob--4" />
      </div>

      {/* The rotor, oversized and bleeding off the corner — brand presence as
          architecture rather than wallpaper. Rotated ultra-slowly (~140s/turn):
          the mark IS a pinwheel, so rotation is the shape's own logic rather than
          an effect imposed on it, and at that speed it reads as ambient depth.
          AapnaLogo's viewBox is centred on the true centre of rotational symmetry,
          so this needs no transform-origin correction.

          'mono' tone: a two-tone mark reads as noise at 6% opacity, so the whole
          thing collapses to one currentColor here.

          Decorative only — the accessible brand name comes from the sidebar lockup,
          so no title is passed and the SVG renders aria-hidden. */}
      <div className="ats-watermark">
        <AapnaLogo tone="mono" />
      </div>

      {/* Grain: breaks up gradient banding on wide/8-bit panels. */}
      <div className="ats-grain" />
    </div>
  );
}
