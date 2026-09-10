/**
 * Segmented — a pill selector with a sliding glass indicator.
 *
 * Replaces the ad-hoc tab bars that each invented their own geometry: `.admin-tab`
 * (38px tall, 999 radius, gradient when active), `.screening-tabs`, and the bare
 * AntD Segmented used on the dashboard hero. Three controls doing one job, none of
 * which agreed on height or on what "selected" looks like.
 *
 * Built on real <button>s in a radiogroup rather than AntD's Segmented so the active
 * indicator can be a token-driven surface. AntD's own indicator is painted from its
 * theme tokens and cannot read --material-thick or --depth-1, which is what makes the
 * selected pill read as a pane of glass rather than a grey block.
 *
 * KEYBOARD: A ROVING TABINDEX, NOT A ROW OF TAB STOPS.
 * The first version gave every option `tabIndex=0`, so a group of four options was
 * four tab stops — eight consecutive Tab presses landed on segmented buttons and
 * crossing the control bar cost ~16 stops instead of 5. It also declared
 * `role="radio"` while handling no arrow keys, which is an ARIA contract claimed and
 * not honoured: a screen-reader user is told this is a radio group and then finds the
 * documented navigation does nothing.
 *
 * The correct pattern, and the one implemented here: the group is ONE tab stop
 * (`tabIndex=0` on the selected option, `-1` on the rest); Left/Up and Right/Down move
 * selection and focus together; Home/End jump to the ends. Disabled options are
 * skipped rather than focused-and-ignored.
 */
import { useCallback, useRef } from 'react';

/**
 * @param {object} props
 * @param {Array<{value: string|number, label: React.ReactNode, disabled?: boolean}>} props.options
 * @param {string|number} props.value
 * @param {(value: string|number) => void} props.onChange
 * @param {string} [props['aria-label']]  name the group; a bare radiogroup is unlabelled
 */
export default function Segmented({
  options = [],
  value,
  onChange,
  className = '',
  'aria-label': ariaLabel,
  ...rest
}) {
  const ref = useRef(null);

  /** Indices that can actually receive focus. */
  const enabled = options.reduce((acc, o, i) => (o.disabled ? acc : [...acc, i]), []);

  const focusIndex = useCallback((i) => {
    const el = ref.current?.querySelectorAll('.ui-segmented__item')[i];
    if (el) el.focus();
  }, []);

  const move = useCallback((delta) => {
    if (!enabled.length) return;
    const current = options.findIndex((o) => o.value === value);
    // Position within the ENABLED list, so a disabled option in the middle is
    // stepped over rather than landed on.
    const pos = enabled.indexOf(current);
    const from = pos === -1 ? 0 : pos;
    // Wrap, which is what a radiogroup does — arrowing past the end returns to the
    // start rather than dead-ending.
    const next = enabled[(from + delta + enabled.length) % enabled.length];
    onChange?.(options[next].value);
    focusIndex(next);
  }, [enabled, options, value, onChange, focusIndex]);

  const onKeyDown = useCallback((e) => {
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowLeft': case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': {
        e.preventDefault();
        const first = enabled[0];
        if (first !== undefined) { onChange?.(options[first].value); focusIndex(first); }
        break;
      }
      case 'End': {
        e.preventDefault();
        const last = enabled[enabled.length - 1];
        if (last !== undefined) { onChange?.(options[last].value); focusIndex(last); }
        break;
      }
      default: break;
    }
  }, [move, enabled, options, onChange, focusIndex]);

  // Which option carries the group's single tab stop. Falls back to the first
  // enabled option when `value` matches nothing, so the group is never unreachable.
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected !== -1 ? selected : (enabled[0] ?? -1);

  return (
    <div
      ref={ref}
      className={['ui-segmented', className].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      {...rest}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            tabIndex={i === tabStop ? 0 : -1}
            className={`ui-segmented__item${active ? ' ui-segmented__item--active' : ''}`}
            onClick={() => !opt.disabled && onChange?.(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
