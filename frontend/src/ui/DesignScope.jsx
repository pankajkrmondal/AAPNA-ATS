/**
 * DesignScope — the per-route opt-in that makes Stage 5 incremental.
 *
 * THE PROBLEM THIS SOLVES
 * AntD's tokens are global: one `<ConfigProvider>` paints all 24 routes. So a route
 * converted to `src/ui` cannot get the preset's geometry (18px buttons, 38px controls,
 * the type scale) without changing every unconverted route at the same time — which is
 * exactly the whole-app restyle the staged rollout exists to prevent, and which was
 * already shipped and reverted once (see LEGACY_GEOMETRY in theme/themeConfig.js).
 *
 * Wrapping a converted route in its own nested provider resolves it: that subtree gets
 * `presetGeometry: true`, everything outside keeps the geometry it shipped with. A
 * route converts by adding this wrapper and reverts by removing it, which is the same
 * one-line-in, one-line-out property `V2_ROUTES` gave the previous rollout.
 *
 * When the last route is converted, this component and `LEGACY_GEOMETRY` both get
 * deleted and the app-wide provider takes the preset geometry directly. Until then
 * this is the seam.
 *
 * WHY IT ALSO CARRIES `ats-v3`
 * The ambient canvas selectors in aurora-glass.css read `:is(.ats-v2, .ats-v3)`. A
 * converted route needs the second scope so the aurora, rotor watermark and grain
 * reach `src/ui` surfaces. MainLayout already renders `<AmbientBackdrop />` for routes
 * in V2_ROUTES, so this does NOT render a second one — two fixed full-viewport planes
 * would double the compositing cost for no visual gain. Pass `backdrop` only for a
 * route that has no layout supplying one (the auth and public pages).
 */
import { useMemo } from 'react';
import { ConfigProvider } from 'antd';
import useTheme from '../hooks/useTheme';
import useBrand from '../hooks/useBrand';
import useDesign from '../hooks/useDesign';
import { buildAntdTheme } from '../theme/themeConfig';
import AmbientBackdrop from '../components/common/AmbientBackdrop';

/**
 * @param {object} props
 * @param {boolean} [props.backdrop=false] render the ambient canvas here. Only for
 *   routes whose layout does not already provide one — MainLayout does.
 * @param {string} [props.as='div'] element to render as the scope wrapper
 * @param {'light'|'dark'} [props.mode] pins the mode instead of following the
 *   session. The public token-link pages need this: they are opened from an email by
 *   someone who is not the operator, and must not inherit a dark session. Pinning it
 *   here also re-scopes the CSS variables via `data-theme`, which is what the separate
 *   <ForceLight> wrapper used to do.
 */
export default function DesignScope({
  backdrop = false,
  as: Tag = 'div',
  mode: modeOverride,
  className = '',
  children,
  ...rest
}) {
  const { theme: sessionTheme } = useTheme();
  const theme = modeOverride || sessionTheme;
  const { brandId } = useBrand();
  const { presetId, fontPackId, density } = useDesign();

  const antdTheme = useMemo(
    () => buildAntdTheme({
      brandId, presetId, fontPackId, mode: theme, density, presetGeometry: true,
    }),
    [brandId, presetId, fontPackId, theme, density],
  );

  return (
    <ConfigProvider theme={antdTheme}>
      <Tag
        className={['ats-v3', className].filter(Boolean).join(' ')}
        {...rest}
        /* AFTER {...rest}, deliberately: a pinned mode is not negotiable by a caller.
           Setting data-theme re-scopes every mode-paired token for this subtree — the
           `:root, [data-theme='light']` construction in tokens.css and index.css —
           and colorScheme keeps native controls (scrollbars, form widgets) in step. */
        {...(modeOverride
          ? { 'data-theme': modeOverride, style: { colorScheme: modeOverride, ...rest.style } }
          : {})}
      >
        {backdrop && <AmbientBackdrop />}
        {children}
      </Tag>
    </ConfigProvider>
  );
}
