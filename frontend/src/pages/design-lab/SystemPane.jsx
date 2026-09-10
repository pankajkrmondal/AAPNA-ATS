/**
 * SystemPane — every component at every state, plus the raw scales.
 *
 * The comparison rows near the top are the point of this pane. They exist because
 * three decisions in this direction are genuinely arguable and should be settled by
 * looking rather than by reading a number in a plan:
 *
 *   1. Light-mode glow. Glow reads beautifully on dark and is hard on light — an
 *      untinted bloom on a light ground reads as blur or dirt. Three intensities are
 *      shown side by side so the right one can be picked in the mode where it is
 *      difficult.
 *   2. 22px card corners. iOS-correct, but larger than enterprise density usually
 *      wears. Shown against the current 16px.
 *   3. 15px body type. The app is set at 9-13px today, which is the main reason it
 *      reads cramped. Shown against the sizes it replaces.
 */
import {
  RiseOutlined, TeamOutlined, FileTextOutlined, CheckCircleOutlined,
  SearchOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, WarningOutlined,
} from '@ant-design/icons';
import { Input, Select } from 'antd';
import { useState } from 'react';
import {
  Button, Surface, StatTile, Field, FieldValue, Segmented, StateBlock, CountUp,
} from '../../ui';

const TYPE_ROLES = [
  ['display', 'Display', 'Large title — one per screen'],
  ['title-1', 'Title 1', 'Page titles'],
  ['title-2', 'Title 2', 'Section headings'],
  ['title-3', 'Title 3', 'Card headings'],
  ['headline', 'Headline', 'Emphasised body'],
  ['body', 'Body', 'Default text'],
  ['callout', 'Callout', 'Secondary text'],
  ['subhead', 'Subhead', 'Table cells, dense lists'],
  ['footnote', 'Footnote', 'Captions, hints — the 12px floor'],
];

function Section({ title, note, children }) {
  return (
    <section className="dl-section">
      <div className="dl-section__head">
        <h2 className="t-title-2">{title}</h2>
        {note && <p className="dl-section__note">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function SystemPane() {
  const [seg, setSeg] = useState('all');
  // Bumping this remounts the replayable tiles, which restarts their CSS animations.
  // A class toggle would need a forced reflow between remove and re-add; a key change
  // is the same effect with none of the layout thrash.
  const [beat, setBeat] = useState(0);

  return (
    <div className="dl-stack">

      {/* ---- the three arguable calls, shown rather than described ---- */}
      <Section
        title="Decisions worth looking at"
        note="These three are the arguable ones. Switch to light mode for the first — that is the hard direction for glow."
      >
        <div className="dl-grid dl-grid--3">
          <Surface tier={2} bloom>
            <div className="t-caption dl-muted">Glow · three intensities</div>
            <div className="dl-row dl-row--wrap dl-mt">
              <Button emphasis="solid" className="dl-glow--strong">Strong</Button>
              <Button emphasis="solid">Standard</Button>
              <Button emphasis="solid" className="dl-glow--none">None</Button>
            </div>
            <p className="dl-note">
              Rest-state glow, not hover-only. A button that lights up only when
              pointed at reads as a hover effect; one lit at rest reads as the
              primary action on the page.
            </p>
          </Surface>

          <Surface tier={2}>
            <div className="t-caption dl-muted">Corner radius</div>
            <div className="dl-row dl-mt">
              <div className="dl-swatch dl-swatch--preset">New</div>
              <div className="dl-swatch dl-swatch--16">16px</div>
              <div className="dl-swatch dl-swatch--8">8px</div>
            </div>
            <p className="dl-note">
              Left is the preset&rsquo;s <code>--radius-surface</code>. Middle is what
              ships today. iOS wants the larger corner; enterprise density usually
              wants the smaller.
            </p>
          </Surface>

          <Surface tier={2}>
            <div className="t-caption dl-muted">Body type</div>
            <div className="dl-mt">
              <p className="t-body" style={{ margin: 0 }}>
                Shortlisted 14 candidates this week.
              </p>
              <p className="dl-type-old dl-type-old--13">
                Shortlisted 14 candidates this week. <span className="dl-muted">(13px — today)</span>
              </p>
              <p className="dl-type-old dl-type-old--11">
                Shortlisted 14 candidates this week. <span className="dl-muted">(11px — 194 uses today)</span>
              </p>
            </div>
            <p className="dl-note">
              The app currently sets 194 elements at 11px and 21 at 9px. This is the
              change that reflows every screen.
            </p>
          </Surface>
        </div>
      </Section>

      {/* ---- type ---- */}
      <Section
        title="Type scale"
        note="Bound to the font pack, not the preset — a ramp tuned for Sora reads wrong on system-ui. Switch fonts above to see it retune."
      >
        <Surface tier={2} padding="relaxed">
          {TYPE_ROLES.map(([role, name, use]) => (
            <div className="dl-type-row" key={role}>
              <div className="dl-type-row__meta">
                <span className="t-caption">{name}</span>
                <span className="dl-muted dl-type-row__use">{use}</span>
              </div>
              <div className={`t-${role} dl-type-row__specimen`}>
                Pipeline health at a glance
              </div>
            </div>
          ))}
        </Surface>
      </Section>

      {/* ---- buttons ---- */}
      <Section
        title="Button"
        note="One geometry. Replaces 12 treatments and 6 heights across 224 call sites. tone × emphasis rather than a lookup table of named variants."
      >
        <Surface tier={2} padding="relaxed">
          <div className="dl-label-row">
            <span className="t-caption dl-muted">Emphasis</span>
          </div>
          <div className="dl-row dl-row--wrap">
            <Button emphasis="solid" icon={<PlusOutlined />}>Solid</Button>
            <Button emphasis="soft">Soft</Button>
            <Button emphasis="text">Text</Button>
          </div>

          <div className="dl-label-row"><span className="t-caption dl-muted">Tone</span></div>
          <div className="dl-row dl-row--wrap">
            <Button emphasis="solid" tone="brand">Brand</Button>
            <Button emphasis="solid" tone="danger" icon={<DeleteOutlined />}>Danger</Button>
            <Button emphasis="solid" tone="success" icon={<CheckCircleOutlined />}>Success</Button>
            <Button emphasis="soft" tone="danger">Danger soft</Button>
            <Button emphasis="soft" tone="neutral">Neutral</Button>
          </div>

          <div className="dl-label-row"><span className="t-caption dl-muted">Size</span></div>
          <div className="dl-row dl-row--wrap dl-row--baseline">
            <Button size="sm" emphasis="solid">Small</Button>
            <Button size="md" emphasis="solid">Medium</Button>
            <Button size="lg" emphasis="solid">Large</Button>
            <Button size="md" emphasis="soft" iconOnly icon={<SearchOutlined />} aria-label="Search" />
          </div>

          <div className="dl-label-row"><span className="t-caption dl-muted">Disabled</span></div>
          <div className="dl-row dl-row--wrap">
            <Button emphasis="solid" disabled>Solid</Button>
            <Button emphasis="soft" disabled>Soft</Button>
            <Button emphasis="text" disabled>Text</Button>
          </div>
        </Surface>
      </Section>

      {/* ---- surfaces ---- */}
      <Section
        title="Surface"
        note="Tier is information density, not importance. Only tiers 1 and 4 blur — a backdrop-filter on a scrolling surface re-blurs every frame for no visible gain."
      >
        <div className="dl-grid dl-grid--3">
          <Surface tier={2}>
            <div className="t-title-3">Tier 2 — Feature</div>
            <p className="t-callout dl-muted">Hero, KPI cards, widget panels. Translucent, no blur.</p>
          </Surface>
          <Surface tier={3}>
            <div className="t-title-3">Tier 3 — Data</div>
            <p className="t-callout dl-muted">Tables, dense lists, anything nested in a tier 2. More opaque.</p>
          </Surface>
          <Surface tier={4}>
            <div className="t-title-3">Tier 4 — Overlay</div>
            <p className="t-callout dl-muted">Sheets and popovers. The one content surface that blurs.</p>
          </Surface>
        </div>

        <div className="dl-grid dl-grid--2 dl-mt">
          <Surface tier={2} interactive>
            <div className="t-title-3">Interactive</div>
            <p className="t-callout dl-muted">Hover to lift, press to settle. Opt-in — a long table must not do this.</p>
          </Surface>
          <Surface tier={2}>
            <div className="t-title-3">Nested is thinner glass</div>
            <p className="t-callout dl-muted">Not a different colour — that is what made nested panels read as slabs.</p>
            <Surface tier={3} material="thin" padding="compact" className="dl-mt">
              <span className="t-subhead">A tier-3 panel inside a tier-2 card</span>
            </Surface>
          </Surface>
        </div>
      </Section>

      {/* ---- stats ---- */}
      <Section
        title="StatTile"
        note="Merges three parallel families that used 38/34/32px values, three shadows, three icon radii and three hover lifts for the same job. Accent is a token name, never a hex."
      >
        <div className="dl-grid dl-grid--4">
          <StatTile icon={<TeamOutlined />} label="Candidates" value={1284} accent="brand" delta={{ value: 12 }} footnote="Across 18 open roles" interactive bloom />
          <StatTile icon={<FileTextOutlined />} label="Open MRFs" value={37} accent="info" delta={{ value: -4 }} footnote="6 awaiting approval" interactive />
          <StatTile icon={<CheckCircleOutlined />} label="Offers accepted" value={19} accent="success" delta={{ value: 8 }} footnote="This quarter" interactive />
          <StatTile icon={<RiseOutlined />} label="Time to hire" value="24d" accent="warning" delta={{ value: 0 }} footnote="Median, last 90 days" interactive />
        </div>
      </Section>

      {/* ---- form ---- */}
      <Section
        title="Field & Segmented"
        note="One input rhythm. Replaces height:42/borderRadius:8 written inline on every input — MRF.jsx alone repeats it six times."
      >
        <div className="dl-grid dl-grid--2">
          <Surface tier={2} padding="relaxed">
            <div className="dl-stack-sm">
              <Field label="Role" hint="The position this requisition is for.">
                <Input placeholder="Senior Data Engineer" />
              </Field>
              <Field label="Hiring manager" required>
                <Select
                  style={{ width: '100%' }}
                  placeholder="Select a manager"
                  options={[{ value: 'a', label: 'Priya Raman' }, { value: 'b', label: 'Alex Chen' }]}
                />
              </Field>
              <Field label="Headcount" error="Enter a number between 1 and 20.">
                <Input placeholder="0" />
              </Field>
            </div>
          </Surface>

          <Surface tier={2} padding="relaxed">
            <div className="t-caption dl-muted">Segmented</div>
            <div className="dl-mt">
              <Segmented
                aria-label="Filter candidates"
                value={seg}
                onChange={setSeg}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'shortlisted', label: 'Shortlisted' },
                  { value: 'interviewing', label: 'Interviewing' },
                  { value: 'offered', label: 'Offered' },
                ]}
              />
            </div>
            <p className="dl-note">
              A real radiogroup, not styled tabs — arrow keys and screen readers work.
              The selected pill is a token-driven surface, which is what lets it read
              as glass rather than as a grey block.
            </p>

            <div className="t-caption dl-muted dl-mt">Field value (read mode)</div>
            <div className="dl-mt">
              <Field label="Role"><FieldValue value="Senior Data Engineer" /></Field>
              <Field label="Client details"><FieldValue /></Field>
            </div>
            <p className="dl-note">
              What a field looks like when there is nothing to type into it. Detail
              screens used to say this with AntD&rsquo;s <em>disabled</em> state, which
              measured 1.84:1 on /mrf while the label above it sat at 5.35 — the record
              was the least legible thing on screen, and only became readable once you
              were allowed to edit it.
            </p>
          </Surface>
        </div>
      </Section>

      {/* ---- motion ---- */}
      <Section
        title="Motion"
        note="Entrance animation is invisible one second after it runs — which is exactly why v1's motion was reported as not existing. Every entry here replays on demand, so it can actually be reviewed."
      >
        <div className="dl-motion-head">
          <Button emphasis="soft" icon={<ReloadOutlined />} onClick={() => setBeat((n) => n + 1)}>
            Replay all
          </Button>
          <span className="dl-muted t-footnote">
            Ambient motion (below) never stops — it does not need replaying.
          </span>
        </div>

        <div className="dl-grid dl-grid--3">
          {/* Ambient: continuous, no replay needed. These are what make a still frame
              look alive, and all three were absent from v1. */}
          <Surface tier={2}>
            <div className="t-caption dl-muted">Ambient · continuous</div>
            <ul className="dl-motion-list">
              <li><span className="ui-live-dot" aria-hidden /> Live indicator &mdash; 2.6s halo</li>
              <li><span className="dl-swatch-mini dl-swatch-mini--sweep" aria-hidden /> Hero light sweep &mdash; 22s</li>
              <li><span className="dl-swatch-mini dl-swatch-mini--rotor" aria-hidden /> Rotor watermark &mdash; 140s</li>
              <li><span className="dl-swatch-mini dl-swatch-mini--aurora" aria-hidden /> Aurora breathe &mdash; 26s</li>
            </ul>
            <p className="dl-note">
              All four are transform or opacity only. The rotor and aurora ride on one
              fixed plane, so they are excluded from scroll repaint.
            </p>
          </Surface>

          {/* Replayable, keyed on `beat` so remounting restarts the animation. */}
          <Surface tier={2} key={`enter-${beat}`}>
            <div className="t-caption dl-muted">Entrance · replayable</div>
            <div className="ui-stagger dl-motion-list">
              <div className="dl-motion-row">Staggered reveal &mdash; 55ms step</div>
              <div className="dl-motion-row">Second item</div>
              <div className="dl-motion-row">Third item</div>
              <div className="dl-motion-row">
                Count-up &mdash; <span className="t-metric-sm"><CountUp value={1284} /></span>
              </div>
            </div>
          </Surface>

          <Surface tier={2} key={`state-${beat}`}>
            <div className="t-caption dl-muted">State · event-driven</div>
            <div className="dl-motion-list">
              <div className="dl-motion-row ui-flash">Row flash &mdash; a live socket update</div>
              <div className="dl-motion-row">
                <span className="ui-attention dl-chip dl-chip--danger">
                  <WarningOutlined /> Action required
                </span>
              </div>
              <div className="dl-motion-row">
                <span className="ui-sheen dl-chip dl-chip--brand">Sheen sweep</span>
              </div>
            </div>
            <p className="dl-note">
              Press any button above, or hover a card, for the interaction layer &mdash;
              press is <code>scale(var(--press-scale))</code> at 90ms.
            </p>
          </Surface>
        </div>
      </Section>

      {/* ---- radius ---- */}
      <Section
        title="Button radius"
        note="The current value is 18px, up from v1's 14px. Pill is a legitimate iOS answer for prominent actions — pick by looking."
      >
        <Surface tier={2} padding="relaxed">
          <div className="dl-row dl-row--wrap">
            <Button emphasis="solid" className="dl-r14">14px &mdash; v1</Button>
            <Button emphasis="solid">18px &mdash; current</Button>
            <Button emphasis="solid" className="dl-rpill">Pill</Button>
          </div>
          <div className="dl-row dl-row--wrap dl-mt">
            <Button emphasis="soft" className="dl-r14">14px</Button>
            <Button emphasis="soft">18px</Button>
            <Button emphasis="soft" className="dl-rpill">Pill</Button>
          </div>
          <p className="dl-note">
            Inputs move with the button (<code>--radius-ctl</code>, now 15px). A 12px
            field beside an 18px button reads as a mistake rather than a hierarchy.
          </p>
        </Surface>
      </Section>

      {/* ---- states ---- */}
      <Section
        title="StateBlock"
        note="~40 raw <Spin> and <Empty> instances each decided independently what 'nothing here' looks like. An empty state must say why it is empty and offer the next step."
      >
        <div className="dl-grid dl-grid--3">
          <Surface tier={3} padding="none">
            <StateBlock
              variant="empty"
              title="No candidates yet"
              body="Nobody has been added to this role. Upload CVs or run a screening to populate the pipeline."
              action={{ label: 'Upload CVs', onClick: () => {} }}
            />
          </Surface>
          <Surface tier={3} padding="none">
            <StateBlock
              variant="error"
              title="This didn't load"
              body="The pipeline service did not respond. Your data is safe — this is a display problem."
              action={{ label: 'Try again', onClick: () => {} }}
            />
          </Surface>
          <Surface tier={3} padding="default">
            <StateBlock variant="loading" rows={5} />
          </Surface>
        </div>
      </Section>

    </div>
  );
}
