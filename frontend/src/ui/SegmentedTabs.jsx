/**
 * SegmentedTabs — a `Segmented` control driving a set of lazily-mounted panes.
 *
 * WHY THIS EXISTS RATHER THAN A SECOND COPY ON EACH PAGE
 * `.screening-tabs` was an AntD `<Tabs>` hand-dressed as a capsule, used on
 * /filtering and /analytics. Swapping both to `Segmented` means both pages need the
 * same "render the active pane" wiring; written twice it would drift, which is the
 * whole reason the shared class existed in the first place.
 *
 * MOUNTING SEMANTICS ARE COPIED FROM ANTD ON PURPOSE.
 * AntD's `<Tabs>` mounts a pane the first time it becomes active and then LEAVES IT
 * MOUNTED (`destroyInactiveTabPane` defaults to false). Rendering only the active
 * pane instead would have been simpler and would have quietly changed behaviour on
 * both screens: /analytics' four panes hold `<Table>`s whose pagination would reset
 * on every round-trip, and /filtering's keyword pane holds a `<Form>` that would
 * remount. Reproducing AntD's behaviour is what keeps this swap a purely visual
 * change — which is the only thing it was approved to be.
 *
 * NO `role="tabpanel"` ON THE PANES. `Segmented` is a radiogroup, not a tablist, so
 * a tabpanel role would name a relationship no element on the page implements. That
 * is the same ARIA-contract-claimed-and-not-honoured mistake documented in
 * Segmented.jsx's own header; not repeating it here.
 */
import { useState } from 'react';
import Segmented from './Segmented';

/**
 * @param {object} props
 * @param {Array<{key: string, label: React.ReactNode, children: React.ReactNode, disabled?: boolean}>} props.items
 * @param {string} props.activeKey
 * @param {(key: string) => void} props.onChange
 * @param {string} [props['aria-label']]  names the group; a bare radiogroup is unlabelled
 */
export default function SegmentedTabs({
  items = [],
  activeKey,
  onChange,
  className = '',
  'aria-label': ariaLabel,
}) {
  const [mounted, setMounted] = useState(() => new Set());

  // Adjusting state from a prop during render, which is React's documented pattern
  // for exactly this: it re-runs the component before committing, so the pane is
  // mounted in the same paint rather than one frame late. Seeds the initial key too,
  // so `onChange` stays a pure pass-through and callers cannot forget to feed it.
  if (activeKey != null && !mounted.has(activeKey)) {
    setMounted((prev) => new Set(prev).add(activeKey));
  }

  return (
    <>
      <Segmented
        className={['ui-segmented-tabs', className].filter(Boolean).join(' ')}
        aria-label={ariaLabel}
        value={activeKey}
        onChange={onChange}
        options={items.map(({ key, label, disabled }) => ({ value: key, label, disabled }))}
      />
      {items.map((item) => (mounted.has(item.key) ? (
        <div
          key={item.key}
          className="ui-segmented-tabs__pane"
          hidden={item.key !== activeKey}
        >
          {item.children}
        </div>
      ) : null))}
    </>
  );
}
