/**
 * Surface — the material primitive.
 *
 * Replaces `<Card className="glass-card">` plus the four different body paddings the
 * app used for the same job (22 on the dashboard, 18 on Pipeline, 12 on Candidates,
 * 24 wherever AntD's default won).
 *
 * TIER IS INFORMATION DENSITY, NOT IMPORTANCE.
 * The rule from §I.1 of the rollout plan, and the one thing to get right here: a
 * hero and a 100-row table want opposite things from glass. Tier 2 is a feature
 * surface, tier 3 is data, tier 4 is an overlay — and **anything nested inside a
 * tier-2 card is tier 3**, which is what stops a nested panel reading as a slab
 * stuck to the card.
 *
 * Only tiers 1 (chrome, elsewhere) and 4 blur. Tiers 2-3 scroll, and a
 * backdrop-filter on a scrolling surface re-blurs its backdrop every frame for no
 * visible gain over a soft-gradient ground. That is measured, not assumed —
 * aurora-glass.css:256.
 *
 * A plain <div>, not an AntD Card: Card brings its own padding, border, shadow and
 * hover lift, every one of which had to be overridden. Rendering the element
 * directly is both less code and less to fight.
 */

const TIERS = { 2: 'ui-surface--t2', 3: 'ui-surface--t3', 4: 'ui-surface--t4' };
const MATERIALS = { thin: 'ui-surface--thin', regular: 'ui-surface--regular', thick: 'ui-surface--thick' };
const PADDINGS = {
  none: 'ui-surface--pad-none',
  compact: 'ui-surface--pad-compact',
  default: 'ui-surface--pad-default',
  relaxed: 'ui-surface--pad-relaxed',
};

/**
 * @param {object} props
 * @param {2|3|4} [props.tier=2]
 * @param {'thin'|'regular'|'thick'} [props.material]  overrides the tier's default weight
 * @param {'none'|'compact'|'default'|'relaxed'} [props.padding='default']
 * @param {boolean} [props.interactive]  hover lift + press + focus ring. Opt-in:
 *   a whole board column or a long table bouncing as the pointer crosses it is wrong.
 * @param {boolean} [props.bloom]  corner light source, behind content
 * @param {string} [props.as='div']  element to render
 */
export default function Surface({
  tier = 2,
  material,
  padding = 'default',
  interactive = false,
  bloom = false,
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'ui-surface',
    TIERS[tier] || TIERS[2],
    material ? MATERIALS[material] : '',
    PADDINGS[padding] || PADDINGS.default,
    interactive ? 'ui-surface--interactive' : '',
    bloom ? 'ui-surface--bloom' : '',
    className,
  ].filter(Boolean).join(' ');

  // An interactive surface is operable, so it must be reachable and activatable by
  // keyboard. Callers can override either by passing their own — a Surface wrapping
  // a real <button> should not add a second tab stop.
  const a11y = interactive
    ? { tabIndex: rest.tabIndex ?? 0, role: rest.role ?? 'button' }
    : null;

  return (
    <Tag className={classes} {...a11y} {...rest}>
      {children}
    </Tag>
  );
}
