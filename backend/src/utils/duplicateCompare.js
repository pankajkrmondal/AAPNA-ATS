/**
 * duplicateCompare.js — what a duplicate upload would change (L09).
 *
 * "If there is any duplicate, right now, REVIEW is showing what is the current
 * user name and his/her resume instead of a pure comparison of what data has
 * been there already vs what is new one and what changed since last resume."
 *
 * Given the candidate already in the ATS (rpa_cv) and the staged upload
 * (rpa_cv_tmp), this lists every field either side has, says how it changed,
 * and says what Merge will do with it — mirroring mergeDuplicates() in
 * hrUpload.service.js exactly:
 *
 *   EmailID, ContactNumber  combined (new values appended, none lost)
 *   employment_history      replaced when the new resume has one
 *   every other field       the new value wins; an empty new value keeps the old
 *
 * Pure and import-free, so it is unit-tested without a database
 * (tests/unit/duplicateCompare.test.js).
 */

export const CHANGE = Object.freeze({
  SAME: 'same',
  UPDATED: 'updated',
  ADDED: 'added',
  NOT_IN_NEW: 'not_in_new',
});

export const ON_MERGE = Object.freeze({
  KEPT: 'kept',
  REPLACED: 'replaced',
  ADDED: 'added',
  COMBINED: 'combined',
});

/**
 * The fields a recruiter compares, in the order the Review window shows them.
 * [rpa_cv / rpa_cv_tmp column, label, group, kind]
 */
export const COMPARE_FIELDS = Object.freeze([
  ['Name', 'Name', 'Contact', 'text'],
  ['EmailID', 'Email', 'Contact', 'emails'],
  ['ContactNumber', 'Phone', 'Contact', 'phones'],
  ['CurrentLocation', 'Current location', 'Contact', 'text'],
  ['LinkedInProfile', 'LinkedIn', 'Contact', 'text'],
  ['PositionApplied', 'Position applied for', 'Role', 'text'],
  ['TotalExperienceYears', 'Total experience (yrs)', 'Role', 'number'],
  ['LastCompanyExperienceYears', 'Experience at last company (yrs)', 'Role', 'number'],
  ['CurrentCompany', 'Current company', 'Role', 'company'],
  ['Top5KeySkills', 'Top 5 key skills', 'Role', 'list'],
  ['NoticePeriod', 'Notice period', 'Role', 'text'],
  ['CTC_LPA', 'Current CTC (LPA)', 'Compensation', 'number'],
  ['ExpectedCTC_LPA', 'Expected CTC (LPA)', 'Compensation', 'number'],
  ['HighestQualification', 'Highest qualification', 'Education', 'text'],
  ['graduationdegree', 'Graduation degree', 'Education', 'text'],
  ['graduationspecialization', 'Graduation specialisation', 'Education', 'text'],
  ['postgraduationdegree', 'PG degree', 'Education', 'text'],
  ['postgraduationspecialization', 'PG specialisation', 'Education', 'text'],
  ['a10th', '10th %', 'Education', 'number'],
  ['a12th', '12th %', 'Education', 'number'],
  ['graduation', 'Graduation %', 'Education', 'number'],
  ['postGraduation', 'PG %', 'Education', 'number'],
  ['employment_history', 'Employment history', 'Work history', 'history'],
  ['Gender', 'Gender', 'Other', 'text'],
  ['EnglishCommunicationRating', 'English communication', 'Other', 'number'],
  ['PreferredShift', 'Preferred shift', 'Other', 'text'],
  ['ReasonForJobChange', 'Reason for job change', 'Other', 'text'],
  ['WillingToTakeOnlineTest', 'Willing to take an online test', 'Other', 'text'],
  ['HasLaptopForInitialDays', 'Has a laptop for the first days', 'Other', 'text'],
  ['JobSource', 'Job source', 'Other', 'text'],
  ['RecruiterInfoAAPNA', 'Recruiter', 'Other', 'text'],
]);

const isBlank = (v) => {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined';
};

function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}

const splitList = (v, re = /[,;]/) => String(v ?? '').split(re).map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== 'null');

/** The company's name from a JSON or plain current-company value. */
function companyName(v) {
  const j = parseJson(v);
  if (Array.isArray(j)) return companyName(j[0]);
  if (j && typeof j === 'object') return String(j.Name || j.name || j.CompanyName || '').trim();
  return isBlank(v) ? '' : String(v).trim();
}

/** Employment history as "Company — Role (Start – End)" lines. */
function historyLines(v) {
  const j = parseJson(v);
  const list = Array.isArray(j) ? j : Array.isArray(j?.companies) ? j.companies : [];
  return list
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      const name = c.CompanyName || c.Company || c.Name || c.name || '';
      const role = c.Designation || c.Role || c.Title || '';
      const from = c.StartDate || c.From || '';
      const to = c.EndDate || c.To || '';
      const when = from || to ? ` (${from || '?'} – ${to || 'present'})` : '';
      return `${name}${role ? ` — ${role}` : ''}${when}`.trim();
    })
    .filter(Boolean);
}

/**
 * How a value reads in the Review window.
 * @param {string} kind
 * @param {*} v
 * @returns {string} '' when there is nothing
 */
export function displayValue(kind, v) {
  if (kind === 'company') return companyName(v);
  if (kind === 'history') return historyLines(v).join('\n');
  if (isBlank(v)) return '';
  if (kind === 'emails' || kind === 'phones' || kind === 'list') return splitList(v).join(', ');
  return String(v).trim();
}

/**
 * The comparable form of a value: case, spacing and formatting differences
 * that mean nothing are not reported as changes.
 */
export function comparable(kind, v) {
  switch (kind) {
    case 'emails':
      return splitList(v).map((x) => x.toLowerCase()).sort().join(',');
    case 'phones':
      return splitList(v).map((x) => x.replace(/[^0-9]/g, '').slice(-10)).filter(Boolean).sort().join(',');
    case 'list':
      return splitList(v).map((x) => x.toLowerCase()).sort().join(',');
    case 'number': {
      if (isBlank(v)) return '';
      const n = Number.parseFloat(String(v).replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? String(n) : String(v).trim().toLowerCase();
    }
    case 'company':
      return companyName(v).toLowerCase();
    case 'history':
      return historyLines(v).map((x) => x.toLowerCase().replace(/\s+/g, ' ')).join('|');
    default:
      return isBlank(v) ? '' : String(v).trim().toLowerCase().replace(/\s+/g, ' ');
  }
}

/** For combined fields: would the new upload add any value the record lacks? */
function addsValues(kind, existing, incoming) {
  const have = new Set(comparable(kind, existing).split(',').filter(Boolean));
  return comparable(kind, incoming).split(',').filter(Boolean).some((x) => !have.has(x));
}

/**
 * Field-by-field comparison of the candidate already in the ATS and the upload.
 *
 * @param {object|null} existing - the rpa_cv row (null when no match is left)
 * @param {object} incoming - the rpa_cv_tmp row
 * @returns {Array<{field: string, label: string, group: string, existing: string,
 *   incoming: string, change: string, on_merge: string}>} fields neither side has are left out
 */
export function compareCandidates(existing, incoming) {
  const out = [];
  for (const [field, label, group, kind] of COMPARE_FIELDS) {
    const oldText = existing ? displayValue(kind, existing[field]) : '';
    const newText = displayValue(kind, incoming?.[field]);
    if (!oldText && !newText) continue;

    const oldKey = existing ? comparable(kind, existing[field]) : '';
    const newKey = comparable(kind, incoming?.[field]);
    let change;
    if (!newKey) change = CHANGE.NOT_IN_NEW;
    else if (!oldKey) change = CHANGE.ADDED;
    else if (oldKey === newKey) change = CHANGE.SAME;
    else change = CHANGE.UPDATED;

    let onMerge;
    if (kind === 'emails' || kind === 'phones') {
      onMerge = !oldKey && newKey ? ON_MERGE.ADDED
        : newKey && addsValues(kind, existing?.[field], incoming?.[field]) ? ON_MERGE.COMBINED
          : ON_MERGE.KEPT;
    } else if (change === CHANGE.UPDATED) onMerge = ON_MERGE.REPLACED;
    else if (change === CHANGE.ADDED) onMerge = ON_MERGE.ADDED;
    else onMerge = ON_MERGE.KEPT;

    out.push({ field, label, group, existing: oldText, incoming: newText, change, on_merge: onMerge });
  }
  return out;
}

/** Counts per change kind, for the Review window's summary line. */
export function summariseChanges(fields) {
  const counts = { same: 0, updated: 0, added: 0, not_in_new: 0 };
  for (const f of fields) counts[f.change] = (counts[f.change] || 0) + 1;
  return counts;
}

/**
 * Which keys made the upload a duplicate: 'email', 'phone' or both.
 * @param {object} existing
 * @param {object} incoming
 * @returns {string[]}
 */
export function matchedBy(existing, incoming) {
  if (!existing || !incoming) return [];
  const by = [];
  const hit = (kind, field) => {
    const have = new Set(comparable(kind, existing[field]).split(',').filter(Boolean));
    return comparable(kind, incoming[field]).split(',').filter(Boolean).some((x) => have.has(x));
  };
  if (hit('emails', 'EmailID')) by.push('email');
  if (hit('phones', 'ContactNumber')) by.push('phone');
  return by;
}

export default { CHANGE, ON_MERGE, COMPARE_FIELDS, displayValue, comparable, compareCandidates, summariseChanges, matchedBy };
