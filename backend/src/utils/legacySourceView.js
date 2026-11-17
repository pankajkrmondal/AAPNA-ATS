/**
 * legacySourceView.js — the legacy-import label and the Search Candidate
 * "Source" filter (Phase 4, docs/Phase 4/SCOPE-Legacy-Source-Label-and-Filter.md).
 *
 * Pure: row/value in, plain object out. No Prisma, no Express, so the rules
 * (what the label says, what each filter value selects, that a vendor never
 * sees any of it) are cheap to test, the same reason referralView.js and
 * vendorScope.js live in utils.
 *
 * The columns: rpa_cv.legacy_source ('ms_access' | 'excel' | 'resume' | NULL)
 * and rpa_cv.legacy_relation ('imported' | 'matched' | NULL). Set by the import
 * script, cleared by clearLegacyLabel() when a fresh resume arrives.
 */

/** Source key -> name shown on screen. Decision of 17 Nov 2026: the source by name. */
export const LEGACY_SOURCE_NAMES = Object.freeze({
  ms_access: 'MS Access',
  excel: 'Excel',
  resume: 'Old resume',
});

/** The source keys, in the order the filter lists them. */
export const LEGACY_SOURCES = Object.freeze(Object.keys(LEGACY_SOURCE_NAMES));

/** Filter values besides the per-source keys. */
export const LEGACY_FILTER_ANY = 'any';
export const LEGACY_FILTER_NONE = 'none';

/** The two columns, as a Prisma `omit` fragment, for vendor callers. */
export const LEGACY_COLUMNS = Object.freeze({
  legacy_source: true,
  legacy_relation: true,
});

/**
 * What the chip says. "MS Access" for a candidate the import created,
 * "Also in MS Access" for one that was already in the ATS (decision 2).
 *
 * @param {string|null|undefined} source
 * @param {string|null|undefined} relation
 * @returns {string} '' when there is no label
 */
export function legacyLabel(source, relation) {
  const name = LEGACY_SOURCE_NAMES[source];
  if (!name) return '';
  return relation === 'matched' ? `Also in ${name}` : name;
}

/**
 * Map the legacy columns of an rpa_cv row to API fields. A vendor caller's
 * query never selects the columns, so the keys are absent and this maps to "no
 * label": absence fails closed, as in referralView.js.
 *
 * @param {object|null} cv
 * @returns {{legacySource: string, legacyRelation: string, legacyLabel: string}}
 */
export function mapLegacyFields(cv) {
  const source = LEGACY_SOURCE_NAMES[cv?.legacy_source] ? cv.legacy_source : '';
  const relation = source ? (cv.legacy_relation === 'matched' ? 'matched' : 'imported') : '';
  return {
    legacySource: source,
    legacyRelation: relation,
    legacyLabel: legacyLabel(source, relation),
  };
}

/**
 * The Prisma condition for the "Source" filter, or null for no condition.
 * Unknown values are ignored rather than refused, like the other list filters.
 *
 *   'any'       candidates with any legacy source
 *   'none'      candidates with no legacy source
 *   'ms_access' (and the other source keys) candidates from that source,
 *               both "imported" and "also in"
 *
 * @param {string|undefined} value
 * @returns {object|null}
 */
export function legacySourceWhere(value) {
  if (value === LEGACY_FILTER_ANY) return { legacy_source: { not: null } };
  if (value === LEGACY_FILTER_NONE) return { legacy_source: null };
  if (LEGACY_SOURCES.includes(value)) return { legacy_source: value };
  return null;
}

/**
 * The fields that remove the label. Spread into the update a fresh resume
 * makes (duplicate merge, email intake). Decision of 17 Nov 2026: the label
 * goes when a fresh resume is uploaded; a manual edit keeps it.
 *
 * @returns {{legacy_source: null, legacy_relation: null}}
 */
export function clearLegacyLabel() {
  return { legacy_source: null, legacy_relation: null };
}

export default {
  LEGACY_SOURCE_NAMES, LEGACY_SOURCES, LEGACY_COLUMNS, LEGACY_FILTER_ANY, LEGACY_FILTER_NONE,
  legacyLabel, mapLegacyFields, legacySourceWhere, clearLegacyLabel,
};
