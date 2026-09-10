/**
 * Type sizes for Recharts furniture.
 *
 * WHY THESE ARE NUMBERS AND NOT TOKENS
 * Recharts takes `tick` and `wrapperStyle` as JS objects and renders SVG `<text>`, so a
 * `var(--fs-*)` cannot reach them — the value has to be a number at the call site. That
 * is also why `scripts/verify/type-floor.mjs` exempts chart furniture from the 12px
 * floor: axis labels are sized to the plot, not read as prose.
 *
 * WHY THEY ARE HERE RATHER THAN AT EACH CALL SITE
 * Because they had drifted. Four charts wrote `fontSize: 11` and two wrote `11.5` for
 * the same job, which is the same "no two agree" problem the design system exists to
 * end — just in a corner tokens cannot reach. One constant means the next chart cannot
 * invent a seventh value, and a future retune is one edit.
 *
 * Keep in step with the ramp's footnote role by eye when that role moves.
 */

/** Axis tick labels — the smallest text on a chart. */
export const CHART_TICK_SIZE = 11;

/** Legend entries, marginally larger: they are read, not scanned against a gridline. */
export const CHART_LEGEND_SIZE = 12;
