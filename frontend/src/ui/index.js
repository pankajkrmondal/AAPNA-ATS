/**
 * src/ui — the component layer.
 *
 * The contract every component here keeps:
 *
 *   1. It reads TOKENS, never literals. No hex, no px radius, no duration, no font
 *      stack. A literal written here is a value theme/presets/*.js and theme/fonts.js
 *      can never reach, and it silently breaks the promise that the theme, font and
 *      type scale stay swappable later.
 *   2. It exposes VARIANTS, not one configuration. size / tone / emphasis / tier /
 *      density — so a new visual need is a prop, not a new bespoke class. The old
 *      primitives took none of these, which is why 224 buttons became twelve
 *      treatments and six heights.
 *   3. It sets no inline styles, with one prescribed exception: a DATA-DERIVED value
 *      passed as a CSS custom property so the stylesheet still owns the property
 *      (StatTile's --ui-accent; precedent is --stat-color / --kpi-color). An inline
 *      style cannot be overridden by any stylesheet without !important — see "the
 *      inline-style law" in docs/design/AURORA-GLASS-ROLLOUT-PLAN.md §I.3.
 *
 * Import the stylesheet once, here, so a consumer cannot forget it and so the ui
 * layer lands in the cascade after theme/tokens.css that it depends on.
 */
import './ui.css';
// Bridge rules for shared components not yet converted (see the file header). Loaded
// here so it lands after the component layer and before any page stylesheet.
import '../styles/legacy-bridge.css';
// Shared-component rules (styles/components.css). Loaded here rather than per file
// because these classes are used by components AND by pages — the unified loading
// treatment, the skill/status tag surfaces, the widget type roles. Importing once
// keeps the cascade order fixed instead of depending on which page rendered first.
import '../styles/components.css';

export { default as DesignScope } from './DesignScope';
export { default as Button } from './Button';
export { default as Surface } from './Surface';
export { PageShell, PageHeader } from './PageShell';
export { default as StatTile } from './StatTile';
export { default as Field } from './Field';
export { default as FieldValue } from './FieldValue';
export { default as Segmented } from './Segmented';
export { default as SegmentedTabs } from './SegmentedTabs';
export { default as StateBlock } from './StateBlock';
export { default as CountUp } from './CountUp';
export { default as Sheet } from './Sheet';
export { default as DataTable } from './DataTable';
