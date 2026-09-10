/**
 * Button — one geometry, parameterised.
 *
 * Replaces twelve distinct treatments across 224 call sites: `.cta-primary`,
 * `.cta-secondary`, `.btn-sheen`, `.admin-top-btn`, `.admin-tab`,
 * `.screening-action-btn`, `.dash-hero__cmd`, plus five inline geometries. Those
 * differed in height (38/40/42/44/46/48), radius (6/8/10/999) and hover behaviour,
 * and no two pages agreed on which meant what.
 *
 * THE PROP MODEL
 *   size      how big            sm | md | lg
 *   tone      which hue          brand | neutral | danger | success
 *   emphasis  how much of it     solid | soft | text
 *
 * Splitting tone from emphasis is what avoids a twelve-entry lookup table: a danger
 * button and a brand button differ only in which token feeds them, so "destructive
 * secondary" is `tone="danger" emphasis="soft"` rather than a new class someone has
 * to invent and name.
 *
 * Every visual value lives in ui.css reading tokens. Nothing here sets a style.
 */
import { Button as AntButton } from 'antd';

const SIZES = { sm: 'ui-btn--sm', md: 'ui-btn--md', lg: 'ui-btn--lg' };
const TONES = { brand: '', neutral: 'ui-btn--neutral', danger: 'ui-btn--danger', success: 'ui-btn--success' };
const EMPHASES = { solid: 'ui-btn--solid', soft: 'ui-btn--soft', text: 'ui-btn--text' };

/**
 * @param {object} props
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {'brand'|'neutral'|'danger'|'success'} [props.tone='brand']
 * @param {'solid'|'soft'|'text'} [props.emphasis='soft']
 * @param {boolean} [props.iconOnly]  square; pass an `icon` and no children
 * @param {boolean} [props.block]
 * @param {string} [props.className]
 */
export default function Button({
  size = 'md',
  tone = 'brand',
  emphasis = 'soft',
  iconOnly = false,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'ui-btn',
    SIZES[size] || SIZES.md,
    TONES[tone] ?? TONES.brand,
    EMPHASES[emphasis] || EMPHASES.soft,
    iconOnly ? 'ui-btn--icon' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    // `type="default"` deliberately, for every variant: AntD's own `primary` type
    // brings a background and shadow that would then have to be fought with
    // !important on each rule below. Letting it stay neutral means ui.css owns the
    // entire appearance and a preset can change all of it.
    <AntButton type="default" className={classes} {...rest}>
      {children}
    </AntButton>
  );
}
