/**
 * Field — one input rhythm: label, control, hint, error.
 *
 * Replaces `style={{ height: 42, borderRadius: 8 }}` written by hand on every input
 * in the app — MRF.jsx alone repeats it on six. Because it was inline, no stylesheet
 * could reach it, so control height was unreachable by the density axis and radius
 * was unreachable by a preset.
 *
 * Hint and error occupy the same slot: showing both at once means the user reads the
 * hint they have already failed to follow. Error wins, which is what they need next.
 */
import { useId, cloneElement, isValidElement } from 'react';

/**
 * @param {object} props
 * @param {React.ReactNode} [props.label]
 * @param {React.ReactNode} [props.hint]   guidance shown before an error exists
 * @param {React.ReactNode} [props.error]  replaces the hint when present
 * @param {boolean} [props.required]
 * @param {React.ReactNode} props.children  the control
 */
export default function Field({
  label,
  hint,
  error,
  required = false,
  className = '',
  children,
  ...rest
}) {
  // Generated rather than required from the caller, so the label/description
  // association cannot be forgotten — the usual reason inputs end up unlabelled.
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div
      className={['ui-field', error ? 'ui-field--invalid' : '', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {label && (
        <label className="ui-field__label" htmlFor={id}>
          {label}
          {required && <span className="ui-field__required" aria-hidden>*</span>}
        </label>
      )}

      {/* The control is cloned only to receive the id and aria wiring. Anything else
          about it stays the caller's — this component styles the frame, not the
          input. A caller's own id/aria wins, so a control that already manages its
          accessibility is not silently overwritten. */}
      {isValidElement(children)
        ? cloneElement(children, {
          id: children.props.id ?? id,
          'aria-describedby': children.props['aria-describedby'] ?? describedBy,
          'aria-invalid': children.props['aria-invalid'] ?? (error ? true : undefined),
        })
        : children}

      {error
        ? <div className="ui-field__error" id={`${id}-error`} role="alert">{error}</div>
        : hint
          ? <div className="ui-field__hint" id={`${id}-hint`}>{hint}</div>
          : null}
    </div>
  );
}
