/**
 * PageShell + PageHeader — one page rhythm for the whole app.
 *
 * The app had thirteen container conventions. Four pages (Candidates, MRF, Settings,
 * AdminDashboard) added `padding: 24px` on top of the layout Content's
 * `24px 28px 40px`, so they sat 48-52px in while the dashboard sat at 24. Max widths
 * ranged 1000 / 1100 / 1200 / 1320 / 1400 with no rule behind which page got which.
 *
 * PageShell owns the inset. A page never sets its own padding again — that is the
 * whole point, and the reason `style` is not forwarded here.
 *
 * PageHeader replaces six hand-rolled header patterns and the full spread of heading
 * levels in use (Title l2, l3, l4, l5, raw <h1>, raw <h2>). It ships as a real <h1>
 * because a page has one document title, and the visual size is a class — the two
 * were previously conflated, which is how `level` ended up carrying styling intent.
 */

import { forwardRef } from 'react';
import AapnaLogo from '../components/common/AapnaLogo';

const WIDTHS = {
  narrow: 'ui-page--narrow',
  standard: 'ui-page--standard',
  wide: 'ui-page--wide',
};

/**
 * @param {object} props
 * @param {'narrow'|'standard'|'wide'} [props.width='standard']
 *   narrow = forms and settings, standard = most pages, wide = boards and analytics
 * @param {boolean} [props.stagger=true]  children enter in sequence
 */
/* forwardRef because a page shell is exactly the element a page wants to measure or
   attach a pointer listener to — usePointerSpotlight publishes --mx/--my from the page
   root, and /dashboard passes its ref straight through. Without this the ref lands on
   nothing and the spotlight silently never tracks. */
export const PageShell = forwardRef(function PageShell({
  width = 'standard',
  stagger = true,
  className = '',
  children,
  ...rest
}, ref) {
  const classes = [
    'ui-page',
    WIDTHS[width] || WIDTHS.standard,
    stagger ? 'ui-stagger' : '',
    className,
  ].filter(Boolean).join(' ');

  return <div ref={ref} className={classes} {...rest}>{children}</div>;
});

const HEADER_SIZES = { sm: 'ui-page-header--sm', md: '', lg: 'ui-page-header--lg' };

/**
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.eyebrow]   uppercase brand-coloured kicker
 * @param {React.ReactNode} [props.subtitle]  one line of what this page is for
 * @param {React.ReactNode} [props.actions]   right-aligned controls
 * @param {React.ReactNode} [props.filters]   a second row under the actions, for the
 *   controls that change what the page SHOWS rather than what it does — the period
 *   segmented and the role select on /dashboard. v1 had only `actions`, so both the
 *   filters and the secondary CTA silently disappeared when the hero was rebuilt.
 *   Separate from `actions` because they are a different kind of control and want a
 *   different visual weight; folding them together is what produced the original
 *   hand-rolled hero in the first place.
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.hero]  ambient hero treatment (mesh + sweep + bloom)
 */
export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  filters,
  size = 'md',
  hero = false,
  className = '',
  children,
}) {
  const header = (
    <div className={['ui-page-header', HEADER_SIZES[size] ?? '', hero ? '' : className]
      .filter(Boolean).join(' ')}
    >
      <div className="ui-page-header__text">
        {eyebrow && <div className="ui-page-header__eyebrow">{eyebrow}</div>}
        <h1 className="ui-page-header__title">{title}</h1>
        {subtitle && <p className="ui-page-header__subtitle">{subtitle}</p>}
        {children}
      </div>

      {(actions || filters) && (
        <div className="ui-page-header__controls">
          {actions && <div className="ui-page-header__actions">{actions}</div>}
          {filters && <div className="ui-page-header__filters">{filters}</div>}
        </div>
      )}
    </div>
  );

  if (!hero) return header;

  return (
    <div className={['ui-hero', className].filter(Boolean).join(' ')}>
      {/* Decorative only, and aria-hidden so a screen reader is not told about a
          gradient. Both layers animate transform, never background-position — the
          latter repaints the whole layer every frame and is banned by the design
          doc, which the dashboard hero's original meshDrift violated. */}
      <div className="ui-hero__mesh" aria-hidden />
      {/* The slow conic light sweep, ~22s. This is the piece that makes a hero read
          as alive in a still frame rather than only on entrance — the v1 hero had
          the mesh but not the sweep, which is most of why the motion "did not
          exist". Mirrors atsHeroSweep in aurora-glass.css. */}
      <div className="ui-hero__sweep" aria-hidden />
      {/* The static AAPNA mark, cropped by the corner. `tone="mono"` because a
          two-tone mark reads as noise at 10% opacity, and no `title` because it is
          decorative — the accessible brand name comes from the sidebar lockup. */}
      <div className="ui-hero__mark" aria-hidden>
        <AapnaLogo tone="mono" />
      </div>
      <div className="ui-hero__content">{header}</div>
    </div>
  );
}

export default PageShell;
