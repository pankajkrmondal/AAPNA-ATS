// Stage 3 (resumes) constants shared by the transform, loader, check and rollback.
// docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md 5.2, 5.5, 5.7.
import crypto from 'node:crypto';

export const SOURCE_KIND = 'resume';
export const TAG = 'legacy_resume_migration';

// Outcome of a file that becomes no candidate (5.7 DDL values), by its transform status.
export const OUTCOME_OF_STATUS = Object.freeze({
  duplicate: 'skipped_duplicate_file',
  unsupported: 'skipped_unsupported_type',
  unreadable: 'rejected_unreadable',
  no_email: 'rejected_no_email',
  identity_in_archive: 'review_identity_conflict',
});
export const NEW_OUTCOMES = Object.freeze(['rejected_no_email', 'rejected_unreadable', 'skipped_duplicate_file', 'skipped_unsupported_type', 'review_identity_conflict']);

// Provenance key (5.2): source_file = the archive root, source_table = the folder (hashed if over 200
// characters; the archive root folder itself is "(root)"), source_row_id = the file's SHA-256 (#2 for a copy).
export const sourceTable = (folder) => {
  const t = folder || '(root)';
  return t.length <= 200 ? t : `sha256:${crypto.createHash('sha256').update(t).digest('hex')}`;
};

// Scalar columns of HR Upload's insert that an EXISTING candidate gets only when its own value is empty (5.5).
// EmailID / ContactNumber are added to (not filled); the CV, resume text and employment history have their own rules.
export const FILL_FIELDS = Object.freeze([
  'Name', 'PositionApplied', 'HighestQualification', 'TotalExperienceYears', 'LastCompanyExperienceYears',
  'CurrentLocation', 'CurrentCompany', 'Top5KeySkills', 'NoticePeriod', 'CTC_LPA', 'ExpectedCTC_LPA', 'JobSource',
  'RecruiterInfoAAPNA', 'EducationalScoresPercentage', 'a10th', 'a12th', 'graduation', 'postGraduation',
  'graduationdegree', 'graduationspecialization', 'postgraduationdegree', 'postgraduationspecialization',
  'Gender', 'EnglishCommunicationRating', 'PreferredShift', 'ReasonForJobChange', 'WillingToTakeOnlineTest',
  'HasLaptopForInitialDays', 'LinkedInProfile',
]);

// rpa_cv column -> its key in missingData (getMissingFields); same name unless listed.
export const MISSING_KEY_OF = Object.freeze({
  a10th: '10th (in percentage)', a12th: '12th (in percentage)',
  graduation: 'Graduation (in percentage)', postGraduation: 'PostGraduation (in percentage)',
});

// Columns that hold JSON (compared key-order-independently: jsonb reorders keys).
export const JSON_FIELDS = Object.freeze(['employment_history', 'resume_technical_terms']);
export const NUMERIC_FIELDS = Object.freeze(['TotalExperienceYearsNumeric', 'ExpectedCTCNumeric', 'NoticePeriodDays']);

export const empty = (v) => v === null || v === undefined || String(v).trim() === '' || ['null', 'candidate'].includes(String(v).trim().toLowerCase());
export const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
export const plain = (v) => (v === null || v === undefined ? null : typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : typeof v === 'object' && v.constructor?.name === 'Decimal' ? v.toString() : v);
// NUL characters (U+0000) removed from every string, nested ones included: PostgreSQL refuses them in text and jsonb
// ("invalid byte sequence for encoding UTF8: 0x00"). Found in the production load of 26 Nov 2026 for 1 of 4,489
// candidates (two education fields and its search-entry data, folder 17). Used for the fields (asText) and for the
// search-entry data (4-load, 4d-retry-vectors).
export const noNul = (v) => {
  if (typeof v === 'string') return v.includes('\u0000') ? v.replace(/\u0000/g, '') : v;
  if (Array.isArray(v)) return v.map(noNul);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noNul(x)]));
  return v;
};
// A text column whose parsed value is a list: written as the items joined with ", " (as HR would type it).
// Found in the production load of 26 Nov 2026: for 1 of 4,489 candidates the parser returned
// postgraduationspecialization as 3 strings, and rpa_cv.create refused it (the column is text). The transform output
// is left as it is (fingerprints fixed after B3); the loader writes asText(), and 4c-check-batch / certify compare
// against asText(), so the stored text equals the transform's list. JSON columns keep their arrays.
export const asText = (k, raw) => {
  const v = noNul(raw);
  if (!Array.isArray(v) || JSON_FIELDS.includes(k)) return v;
  const items = v.filter((x) => x !== null && x !== undefined && String(x).trim() !== '').map((x) => String(x).trim());
  return items.length ? items.join(', ') : null;
};
export const textFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, asText(k, v)]));
export const readLines = (fs, f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
