/**
 * /design-lab — the design system prototype and, later, the permanent gallery.
 *
 * Dev-only (registered behind import.meta.env.DEV in App.jsx), so it costs nothing
 * in the production bundle.
 *
 * WHAT THE CONTROL BAR IS FOR
 * It is as much the deliverable as the design is. Five axes switch live:
 *
 *   preset   liquid-glass | flat-slate      the look
 *   font     inter-sora | figtree | system  the voice AND its type scale
 *   brand    aapna | midnight               the tenant palette
 *   mode     light | dark                   the user's choice
 *   density  compact | default | relaxed    the information rate
 *
 * Two reasons it exists rather than a static page of swatches. First, it is the
 * proof that the swap contract is real — a component that hardcodes a radius or
 * assumes a glow is present looks correct under Liquid Glass forever and breaks the
 * moment `flat-slate` is selected, and that is only visible if you can select it.
 * Second, the risky calls in this direction (light-mode glow, 22px corners, 15px
 * body type against the app's current 11-13px) are judged by trying them, not by
 * approving numbers in a plan.
 */
import { useState, useMemo } from 'react';
import { ConfigProvider } from 'antd';
import useTheme from '../../hooks/useTheme';
import useBrand from '../../hooks/useBrand';
import useDesign from '../../hooks/useDesign';
import { buildAntdTheme } from '../../theme/themeConfig';
import { Segmented } from '../../ui';
import SystemPane from './SystemPane';
import AppPane from './AppPane';
import './designLab.css';

function Control({ label, children }) {
  return (
    <div className="dl-control">
      <span className="dl-control__label">{label}</span>
      {children}
    </div>
  );
}

export default function DesignLab() {
  const [pane, setPane] = useState('system');
  const { theme, setMode } = useTheme();
  const { brandId, setBrand, availableBrands } = useBrand();
  const {
    presetId, preset, setPreset, availablePresets,
    fontPackId, setFontPack, availableFontPacks,
    density, setDensity, availableDensities,
  } = useDesign();

  // This route is the only surface built against the V3 system, so it is the only
  // one that asks AntD for the preset's geometry. The app-wide provider in App.jsx
  // deliberately keeps the geometry the 24 unconverted routes shipped with — see
  // LEGACY_GEOMETRY in theme/themeConfig.js. Nesting a provider here is what lets
  // the gallery show the real thing without restyling the rest of the app.
  const antdTheme = useMemo(
    () => buildAntdTheme({
      brandId,
      presetId,
      fontPackId,
      mode: theme,
      density,
      presetGeometry: true,
    }),
    [brandId, presetId, fontPackId, theme, density],
  );

  return (
    <ConfigProvider theme={antdTheme}>
    <div className="dl">
      <header className="dl-bar">
        <div className="dl-bar__title">
          <span className="dl-bar__mark" aria-hidden />
          <div>
            <div className="t-caption dl-bar__kicker">Design System V3</div>
            {/* Reads the ACTIVE preset, not a constant. A gallery whose own title
                said "Liquid Glass" while rendering Flat Slate would be lying about
                the one thing it exists to demonstrate. */}
            <div className="dl-bar__name">{preset.name}</div>
          </div>
        </div>

        <div className="dl-bar__controls">
          <Control label="Preset">
            <Segmented
              aria-label="Design preset"
              value={presetId}
              onChange={setPreset}
              options={availablePresets.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Control>

          <Control label="Font">
            <Segmented
              aria-label="Font pack"
              value={fontPackId}
              onChange={setFontPack}
              options={availableFontPacks.map((f) => ({ value: f.id, label: f.name }))}
            />
          </Control>

          <Control label="Brand">
            <Segmented
              aria-label="Brand"
              value={brandId}
              onChange={setBrand}
              // The registry's own names are long ("Midnight (theming test)"); the
              // first word is enough in a control this dense.
              options={availableBrands.map((b) => ({ value: b.id, label: b.name.split(' ')[0] }))}
            />
          </Control>

          <Control label="Mode">
            <Segmented
              aria-label="Colour mode"
              value={theme}
              onChange={setMode}
              options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
            />
          </Control>

          <Control label="Density">
            <Segmented
              aria-label="Density"
              value={density}
              onChange={setDensity}
              options={availableDensities.map((d) => ({
                value: d,
                label: d[0].toUpperCase() + d.slice(1),
              }))}
            />
          </Control>
        </div>
      </header>

      <nav className="dl-panes">
        <Segmented
          aria-label="View"
          value={pane}
          onChange={setPane}
          options={[
            { value: 'system', label: 'The system' },
            { value: 'app', label: 'Applied to real screens' },
          ]}
        />
      </nav>

      {/* Keyed on the axes so a swap replays the entrance motion — the motion is
          part of what is being judged, and it is otherwise only visible on first
          load. */}
      <main className="dl-body" key={`${presetId}-${fontPackId}-${density}`}>
        {pane === 'system' ? <SystemPane /> : <AppPane />}
      </main>
    </div>
    </ConfigProvider>
  );
}
