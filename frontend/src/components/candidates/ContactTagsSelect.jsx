import { Select } from 'antd';

/**
 * Tag input for a candidate's other emails or phone numbers (U05), used by
 * both Edit candidate forms. A value is added on Enter, on a separator, or
 * when the box loses focus (antd tags mode), so nothing typed is lost on Save.
 * Phones do not split on spaces: "98765 43210" is one number.
 *
 * @param {{ kind: 'email'|'phone' } & import('antd').SelectProps} props
 */
export default function ContactTagsSelect({ kind, ...props }) {
  return (
    <Select
      mode="tags"
      tokenSeparators={kind === 'email' ? [',', ';', ' '] : [',', ';', '/']}
      suffixIcon={null}
      notFoundContent={null}
      placeholder={kind === 'email' ? 'Type an email and press Enter' : 'Type a number and press Enter'}
      style={{ width: '100%' }}
      {...props}
    />
  );
}
