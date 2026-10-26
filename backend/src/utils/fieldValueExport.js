/**
 * fieldValueExport.js — the one layout every ONE-RECORD export uses (L12).
 *
 *     Field            | Value
 *     WORKFLOW         |
 *     MRF Raise Status | COMPLETED
 *     ...              |
 *                      |
 *     SUBMITTED MRF    |
 *     Position         | QA Automation Engineer
 *
 * Column A is the field, column B its value. A section is a heading row (its
 * name in capitals in column A, column B empty) with a blank row before it,
 * because neither a CSV nor the community xlsx writer can make a row bold.
 *
 * Why (Harish, 23 Oct): a single record laid out across the page — one header
 * row and one data row, or a section/item/detail/value grid — makes the reader
 * scroll sideways to find one value. Read top to bottom, it reads like the
 * screen it came from. List exports (one row per candidate, per MRF…) keep
 * their columns: those are sorted and filtered, not read.
 *
 * Pure and import-free, shared by the CSV exports (through runExport) and the
 * dossier workbook (through aoa_to_sheet).
 */

/** The two columns, in csvExport.js column form. */
export const FIELD_VALUE_COLUMNS = Object.freeze([
  Object.freeze({ header: 'Field', key: 'field' }),
  Object.freeze({ header: 'Value', key: 'value' }),
]);

/** How a section name reads in column A. */
export function sectionHeading(section) {
  return String(section ?? '').trim().toUpperCase();
}

/**
 * Sectioned rows to Field | Value rows: a heading row where the section
 * changes, with a blank row before every heading but the first.
 *
 * @param {Array<{section?: string, field?: *, value?: *}>} rows
 * @returns {Array<{field: *, value: *}>}
 */
export function toFieldValueRows(rows) {
  const out = [];
  let current;
  for (const r of rows || []) {
    const section = String(r?.section ?? '').trim();
    if (section !== current) {
      if (out.length) out.push({ field: '', value: '' });
      if (section) out.push({ field: sectionHeading(section), value: '' });
      current = section;
    }
    out.push({ field: r?.field ?? '', value: r?.value ?? '' });
  }
  return out;
}

/**
 * The same rows as an array of arrays for XLSX.utils.aoa_to_sheet, with the
 * Field | Value header row first.
 *
 * @param {Array<{section?: string, field?: *, value?: *}>} rows
 * @returns {Array<[*, *]>}
 */
export function toFieldValueAoa(rows) {
  return [
    FIELD_VALUE_COLUMNS.map((c) => c.header),
    ...toFieldValueRows(rows).map((r) => [r.field, r.value]),
  ];
}

export default { FIELD_VALUE_COLUMNS, sectionHeading, toFieldValueRows, toFieldValueAoa };
