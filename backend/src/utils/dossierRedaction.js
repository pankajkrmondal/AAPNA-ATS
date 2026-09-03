/**
 * dossierRedaction.js — what may leave the building inside a candidate dossier,
 * and the guard that proves nothing else did.
 *
 * The dossier is the only artefact this system produces that is DESIGNED to be
 * emailed to someone with no ATS account, and once it is sent there is no
 * recall, no expiry and no audit of who forwards it on. Every control therefore
 * has to act BEFORE the bytes are written; nothing here can be fixed afterwards.
 *
 * Two mechanisms, deliberately overlapping:
 *
 *   1. A WHITELIST (CV_PROFILE_FIELDS below) is how fields get in. A column
 *      added to rpa_cv next month is invisible to the pack until somebody
 *      consciously adds it here. Same construction, and the same reason, as
 *      serializeRecording() in interviewRecording.service.js:55.
 *
 *   2. An ASSERTION (assertNoForbiddenFields) walks the finished model and
 *      throws if a forbidden key name reached it anyway — through a spread, a
 *      reused service return, or a helper someone extended. The whitelist is
 *      the mechanism; the assertion is what makes a future regression fail
 *      loudly in CI instead of quietly in a stranger's inbox.
 *
 * Pure: no Prisma, no Express, no config. That is a requirement rather than a
 * preference — these rules are the regression test for tracker row 5 and must
 * be runnable by `npm run test:unit` with no database, the same constraint
 * csvExport.js documents in its own header.
 *
 * Source: docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §8.
 */

/**
 * The ONLY rpa_cv columns that may appear in a dossier, in the order the HTML
 * and the XLSX render them, with the labels both use.
 *
 * One table drives three things — the SELECT, the section order and the labels
 * — so a field cannot be added to the pack without also deciding what it is
 * called and where it sits. Splitting them is how a column ends up selected but
 * unlabelled, or labelled but never rendered.
 *
 * @type {ReadonlyArray<[string, string]>}
 */
export const CV_PROFILE_FIELDS = Object.freeze([
  ['Name', 'Candidate name'],
  ['PositionApplied', 'Position applied for'],
  ['TotalExperienceYears', 'Total experience'],
  ['LastCompanyExperienceYears', 'Experience at last company'],
  ['CurrentCompany', 'Current company'],
  ['CurrentLocation', 'Current location'],
  ['NoticePeriod', 'Notice period'],
  ['HighestQualification', 'Highest qualification'],
  ['graduationdegree', 'Graduation — degree'],
  ['graduationspecialization', 'Graduation — specialisation'],
  ['postgraduationdegree', 'Post-graduation — degree'],
  ['postgraduationspecialization', 'Post-graduation — specialisation'],
  ['Top5KeySkills', 'Top 5 key skills'],
  ['EnglishCommunicationRating', 'English communication'],
  ['PreferredShift', 'Preferred shift'],
  ['LinkedInProfile', 'LinkedIn profile'],
  ['employment_history', 'Employment history'],
]);

/**
 * Contact details — whitelisted, but separately, because they are the one part
 * of the profile a recruiter can withhold per download (decision #10: included
 * by default, tick-box to remove). Kept out of CV_PROFILE_FIELDS so that
 * "included by default" is a caller's choice at one call site rather than a
 * condition sprinkled through the renderers.
 *
 * @type {ReadonlyArray<[string, string]>}
 */
export const CV_CONTACT_FIELDS = Object.freeze([
  ['EmailID', 'Email'],
  ['ContactNumber', 'Phone'],
]);

/**
 * Key names that must never appear anywhere in a dossier model — asserted, not
 * merely omitted (plan §8.2).
 *
 * Lower-cased on the way in and compared lower-cased, because these names arrive
 * from Prisma in three different conventions (CTC_LPA, vendorName, vendor_email)
 * and a guard that missed `VendorEmail` because it was listed as `vendoremail`
 * would be worse than no guard at all.
 */
export const FORBIDDEN_KEYS = Object.freeze(new Set([
  // Compensation — tracker row 5.
  'ctc_lpa',
  'expectedctc_lpa',
  'expectedctcnumeric',
  'hr_current_ctc',
  'hr_expected_ctc',
  // Vendor / sourcing identity — tracker row 5. Sourcing is internal; an
  // interviewer knowing a candidate came through an agency colours the review.
  'vendorname',
  'vendoremail',
  'vendor_email',
  'jobsource',
  'recruiterinfoaapna',
  'lockforninetydays',
  // Commercial.
  'budget_min',
  'budget_max',
  // Internal plumbing and live credentials.
  'cvmissingtoken',
  'cvmissingtokenstatus',
  'metadata',
  'missingdata',
  // Graph/Teams URLs that only work with the application's own token. Already
  // excluded by serializeRecording(); asserted here so it stays that way when a
  // dossier starts carrying recording metadata.
  'graph_content_url',
  'archive_item_id',
  'teams_web_url',
  'graph_recording_id',
  'online_meeting_id',
  'graph_event_id',
  'teams_join_url',
  'teams_passcode',
]));

/**
 * Whole records that are read by the services we reuse and must be dropped
 * before rendering rather than filtered field by field.
 *
 * getPipelineDetail() loads the offer; the dossier builder must not simply
 * forward that object. Offer terms, joining date and remarks are commercial and
 * none of them is an interviewer's business (plan §5.3, §8.2).
 */
export const FORBIDDEN_OBJECT_KEYS = Object.freeze(new Set([
  'offer',
  'offers',
  'rpa_offers',
]));

/**
 * Key-name SHAPES that are forbidden even under a name nobody has thought of.
 *
 * The literal list above catches today's columns. These catch tomorrow's: a
 * `current_ctc_numeric` added to the HR card, a `share_token`, a
 * `vendor_company`. A rename is exactly the change most likely to slip a
 * forbidden value past a list of exact names.
 */
export const FORBIDDEN_KEY_PATTERNS = Object.freeze([
  /(^|_)ctc(_|$)/i,
  /(^|_)token(s)?(_|$)/i,
  /(^|_)vendor(_|$)/i,
  /(^|_)budget(_|$)/i,
  /(^|_)salary(_|$)/i,
  /session_?id/i,
]);

/** Normalise a key for comparison — Prisma hands us three naming conventions. */
const normKey = (key) => String(key).trim().toLowerCase();

/**
 * True when a key name is forbidden, by exact name or by shape.
 *
 * NOTE the deliberate absence of `source`. rpa_candidate_pipeline.source is
 * forbidden as a VALUE (it names the vendor channel) but `source` is far too
 * common a word to ban as a key across a whole object graph — it would trip on
 * any future `{ source: 'archive' }`. It is kept out of the model by the
 * whitelist instead: the pipeline row is never spread into the dossier, only
 * named fields are copied across. See buildDossierModel().
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isForbiddenKey(key) {
  const k = normKey(key);
  if (FORBIDDEN_KEYS.has(k)) return true;
  return FORBIDDEN_KEY_PATTERNS.some((re) => re.test(k));
}

/**
 * Pick the profile fields a dossier may show, from an rpa_cv row.
 *
 * Returns [label, value] pairs rather than an object, because both renderers
 * want them in this order and neither wants to re-derive it. Null/empty values
 * are KEPT, not dropped: the HTML renders "—" for a missing notice period, and
 * a reader must be able to tell "we don't know" from "the dossier forgot to
 * include it" — the same distinction §3.1 requires of whole sections.
 *
 * @param {object|null} cv - an rpa_cv row (may be null: not every journey has one)
 * @param {{ includeContactDetails?: boolean }} [options]
 * @returns {Array<{ field: string, label: string, value: * }>}
 */
export function pickCvProfile(cv, { includeContactDetails = true } = {}) {
  const fields = includeContactDetails
    ? [...CV_PROFILE_FIELDS, ...CV_CONTACT_FIELDS]
    : [...CV_PROFILE_FIELDS];

  return fields.map(([field, label]) => ({
    field,
    label,
    value: cv ? (cv[field] ?? null) : null,
  }));
}

/**
 * Walk a finished dossier model and throw if anything forbidden reached it.
 *
 * Checks KEY NAMES, not free-text values, and that is a considered limit rather
 * than an oversight. An interviewer who writes "we discussed CTC expectations"
 * in their scorecard comments must not be able to break a recruiter's download;
 * a guard that fails closed on prose would be disabled within a week, and a
 * disabled guard protects nothing. Value-level leak detection belongs in the
 * automated scan over a BUILT pack (plan §10.3), where a false positive costs a
 * build rather than a working feature.
 *
 * Cycles are tracked because Prisma include-graphs are not always trees; without
 * the seen-set a self-referencing row would hang the request rather than fail it.
 *
 * @param {*} model - the redacted dossier model
 * @param {string} [path] - dotted path, for the error message
 * @throws {Error} naming the exact path, so the fix is obvious from CI output
 */
export function assertNoForbiddenFields(model, path = 'model') {
  walk(model, path, new Set());
}

function walk(node, path, seen) {
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`, seen));
    return;
  }

  // Dates, Decimals and BigInts are leaves — walking their internals produces
  // noise, and none of them can carry a forbidden key.
  if (node instanceof Date) return;

  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;

    if (isForbiddenKey(key)) {
      throw new Error(
        `Dossier redaction violation: forbidden field "${key}" at ${here}. `
        + 'This value must never leave the ATS inside a candidate dossier — see '
        + 'docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §8.2. If the field is '
        + 'genuinely safe to share, add it to the whitelist consciously; do not '
        + 'weaken the guard.',
      );
    }

    if (FORBIDDEN_OBJECT_KEYS.has(normKey(key)) && value !== null && value !== undefined) {
      throw new Error(
        `Dossier redaction violation: the whole "${key}" record reached the model at ${here}. `
        + 'Offer terms are commercial and are dropped, not filtered — see plan §5.3.',
      );
    }

    walk(value, here, seen);
  }
}

/**
 * The plain-language list of what was removed, for the READ-ME, the download
 * modal and the audit row.
 *
 * Written once here so all three say the same thing. A recruiter who is told in
 * the modal that CTC is stripped, and a recipient who reads a different list in
 * the pack, have been given two different promises about the same file.
 *
 * @param {{ includeContactDetails?: boolean }} [options]
 * @returns {string[]}
 */
export function redactionSummary({ includeContactDetails = true } = {}) {
  const removed = [
    'Current and expected compensation (CTC)',
    'Vendor / agency name, vendor contact and how the candidate was sourced',
    'Requisition budget range',
    'Offer details, joining date and offer remarks',
    'Internal tokens, tracking links and system identifiers',
  ];
  if (!includeContactDetails) {
    removed.push("The candidate's own email address and phone number (removed for this download)");
  }
  return removed;
}

export default {
  CV_PROFILE_FIELDS,
  CV_CONTACT_FIELDS,
  FORBIDDEN_KEYS,
  FORBIDDEN_OBJECT_KEYS,
  FORBIDDEN_KEY_PATTERNS,
  isForbiddenKey,
  pickCvProfile,
  assertNoForbiddenFields,
  redactionSummary,
};
