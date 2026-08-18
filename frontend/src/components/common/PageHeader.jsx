/**
 * PageHeader — title / subtitle / actions, with one rhythm for the whole app.
 *
 * Audited in Phase 2 of the Aurora Glass rollout. It existed but only one page
 * used it; every other screen hand-rolled its own header, which is why title
 * sizes and the gap below them varied per route. The rhythm below is now the
 * standard, and the reason each value is what it is:
 *
 *   title      24px/700 — matches the dashboard hero's secondary tier
 *   subtitle   14px, --text-2, 4px under the title
 *   gap below  --space-6 (32px), the step above the 24px card gutter, so the
 *              header separates from content without a rule
 *
 * The container carries `.page-header` so a converted route can restyle it from
 * the stylesheet. The previous version put the whole layout in an inline style
 * object, which no stylesheet can override — the "Failure A" trap in the
 * rollout plan. Values here are unchanged from that object apart from the
 * bottom margin (28px → var(--space-6), i.e. 32px) so the spacing lands on the
 * scale; that 4px is the only visual change.
 *
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.subtitle]
 * @param {React.ReactNode} [props.actions]   right-aligned controls
 * @param {React.ReactNode} [props.children]  extra content under the subtitle
 * @param {object} [props.style]              escape hatch; prefer not to use it
 */
import { Space } from 'antd';

export default function PageHeader({ title, subtitle, actions, style, children }) {
  return (
    <div className="page-header" style={style}>
      <div className="page-header__text">
        <h2 className="page-header__title">{title}</h2>
        {subtitle && <div className="page-header__subtitle">{subtitle}</div>}
        {children}
      </div>

      {actions && (
        <Space size={12} wrap>
          {actions}
        </Space>
      )}
    </div>
  );
}
