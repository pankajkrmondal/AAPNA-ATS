/**
 * FieldValue — the READ side of a field. `Field` is the input rhythm; this is what a
 * field looks like when there is nothing to type into it.
 *
 * WHY THIS EXISTS
 * Detail screens had no read-only presentation, so every one of them expressed "you
 * are viewing, not editing" with AntD's DISABLED state — a form full of greyed-out
 * inputs. Measured on /mrf's detail modal, that put the record's own content at
 * 1.84:1 in light and 1.91:1 in dark, against a 4.5:1 floor, while the LABEL naming
 * it sat at 5.35:1. The least legible thing on screen was the data, and it only
 * became readable once the user was allowed to type into it. Disabled is a statement
 * about permission; view mode is a statement about mode. They are not the same word.
 *
 * IT IS A FORM CONTROL, DELIBERATELY.
 * It accepts `value` and swallows the `onChange`/`aria-*` that AntD's `Form.Item`
 * clones onto its child, so it can be dropped in as the control of a NAMED Form.Item:
 *
 *   <Form.Item name="role">{isEditing ? <Input /> : <FieldValue />}</Form.Item>
 *
 * That is the whole point of the shape. The form store, `Form.useWatch`,
 * `isFieldsTouched()` and validation keep working across a mode switch, so toggling
 * to edit needs no re-seeding and cannot drop a value on the floor. `id` is kept, not
 * swallowed, so the Form.Item label still points at something.
 */

/**
 * @param {object} props
 * @param {*} [props.value]                    supplied by Form.Item, or passed directly
 * @param {React.ReactNode} [props.children]   wins over `value` when both are given
 * @param {React.ReactNode} [props.placeholder] shown when the value is empty
 * @param {boolean} [props.multiline]          preserve line breaks (long-form answers)
 * @param {string} [props.href]                render as a link rather than as text
 * @param {(value: *) => React.ReactNode} [props.format]  currency, dates, code->label
 */
export default function FieldValue({
  value,
  children,
  placeholder = '—',
  multiline = false,
  href,
  format,
  className = '',
  id,
  // Cloned on by Form.Item and deliberately dropped: there is nothing here to change.
  onChange: _onChange,
  ...rest
}) {
  const raw = children ?? (format ? format(value) : value);
  // `0` and `false` are values a user entered; only null/undefined/'' are absent.
  // When the field IS a link, the URL decides: a fixed label like "View Document"
  // is never empty, so without this a record with no JD would render a dead
  // affordance instead of the em dash that says "not provided".
  const empty = href !== undefined
    ? !href
    : (raw === null || raw === undefined || raw === '');

  const cls = [
    'ui-value',
    multiline ? 'ui-value--multi' : '',
    href && !empty ? 'ui-value--link' : '',
    className,
  ].filter(Boolean).join(' ');

  const body = empty
    ? <span className="ui-value__empty">{placeholder}</span>
    : raw;

  // An empty link is not a link — a bare arrow pointing at nothing is worse than the
  // em dash that says "not provided".
  if (href && !empty) {
    return (
      <a className={cls} id={id} href={href} target="_blank" rel="noreferrer" {...rest}>
        {body}
      </a>
    );
  }

  return <div className={cls} id={id} {...rest}>{body}</div>;
}
