/**
 * experienceParser.js — resume date reading and total-experience arithmetic.
 *
 * Dependency-free and side-effect-free (no Prisma, no logger, no config) so it
 * can be unit-tested with `npm run test:unit` — same reasoning as csvExport.js.
 * See src/tests/experienceParser.test.js.
 *
 * Extracted from hrUpload.service.js on 2026-08-11 while fixing the defect QA
 * filed as "Total Experience is not updating on the Search Candidate page". The
 * logic had two copies in that file (one inline, one in an unused
 * calculateExperience() helper), and the inline one had this shape:
 *
 *     if (employmentHistory.length > 0) TotalExperienceYears = <date arithmetic>
 *
 * — so ANY resume with a history row took the computed value, even when every
 * date in it was in a format parseResumeDate() could not read. Those all scored
 * 0 months, and the candidate was stored as "0 years" no matter what their CV
 * said. Because "0" is a non-empty string it also passed the missing-data check,
 * so nothing ever chased it. The rule is now "computed WINS, but only when it
 * computed something" — see resolveExperienceYears().
 */

/** Words that mean "still working here". */
const PRESENT_WORDS = ['present', 'current', 'till date', 'now', 'ongoing', 'date'];

/**
 * Read a date the way a resume writes one.
 *
 * The parser prompt asks for dates VERBATIM ("StartDate exactly as mentioned in
 * resume"), so this has to cope with whatever the candidate typed. Every format
 * missed here silently costs that candidate real experience, which is why the
 * separator handling is deliberately generous.
 *
 * @param {*} value
 * @returns {Date|null}
 */
export function parseResumeDate(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  if (PRESENT_WORDS.some((k) => v.includes(k))) return new Date();

  // MM/YYYY, MM-YYYY, MM.YYYY, MM YYYY
  let m = v.match(/^(\d{1,2})[/\-.\s](\d{4})$/);
  if (m) return new Date(Number(m[2]), Number(m[1]) - 1, 1);

  // YYYY/MM, YYYY-MM, YYYY.MM
  m = v.match(/^(\d{4})[/\-.](\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);

  // Month name + year, any separator: "June 2022", "Jun-2022", "Jun'22", "Jun 22".
  // A 2-digit year reads as 20xx; resumes do not write 19xx roles this way often
  // enough to justify a windowing rule.
  m = v.match(/^([a-z]{3,})[\s\-.,']*(\d{2}|\d{4})$/);
  if (m) {
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    const parsed = new Date(`${m[1]} 1, ${year}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  // Bare year — "2022". January, the same assumption the MM/YYYY branch makes
  // about the day.
  m = v.match(/^(\d{4})$/);
  if (m) return new Date(Number(m[1]), 0, 1);

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whole months between two dates. Returns 0 for an unusable pair — including a
 * reversed one, since "2024 to 2021" is a parse artefact, not negative
 * experience to subtract from the running total.
 *
 * @param {Date|null} start
 * @param {Date|null} end
 * @returns {number}
 */
export function monthsBetween(start, end) {
  if (!start || !end) return 0;
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return months > 0 ? months : 0;
}

/**
 * Normalise the parsed EmploymentHistory into the shape stored on
 * rpa_cv.employment_history, and total it up in one pass.
 *
 * `lastCompanyMonths` is the FIRST entry's span: the parser is prompted for
 * most-recent-first.
 *
 * @param {Array<{CompanyName?: string, StartDate?: string, EndDate?: string}>} history
 * @returns {{companies: Array, totalMonths: number, lastCompanyMonths: number}}
 */
export function summariseEmploymentHistory(history) {
  const rows = Array.isArray(history) ? history : [];
  let totalMonths = 0;
  let lastCompanyMonths = 0;

  const companies = rows.map((job, index) => {
    const months = monthsBetween(parseResumeDate(job?.StartDate), parseResumeDate(job?.EndDate));
    if (months > 0) {
      totalMonths += months;
      if (index === 0) lastCompanyMonths = months;
    }
    return {
      CompanyName: job?.CompanyName || null,
      StartDate: job?.StartDate || null,
      EndDate: job?.EndDate || null,
      // This job's own span. Previously derived from the LENGTH of the history
      // array, so every row whose dates would not parse reported 0 years worked.
      YearsWorked: months > 0 ? +(months / 12).toFixed(2) : null,
    };
  });

  return { companies, totalMonths, lastCompanyMonths };
}

/**
 * The value to store for an experience field.
 *
 * A sum of real employment spans beats whatever the model asserted — but only
 * when the dates actually produced one. Zero computed months means the dates
 * were unreadable (or absent), and the resume's own statement is then the best
 * information available. Returning null rather than "0" matters: null is what
 * getMissingFields() flags for follow-up, "0" silently reads as a fresher.
 *
 * @param {number} computedMonths  months summed from the employment history
 * @param {*} statedValue          what the parser said the total was
 * @returns {string|null}
 */
export function resolveExperienceYears(computedMonths, statedValue) {
  if (computedMonths > 0) return String(+(computedMonths / 12).toFixed(2));
  if (statedValue === null || statedValue === undefined || statedValue === '') return null;
  return String(statedValue);
}

/** Upper bound of rpa_cv.TotalExperienceYearsNumeric — Decimal(5,2). */
export const MAX_EXPERIENCE_YEARS = 1000;

/**
 * Whether a parsed numeric experience is storable.
 *
 * TotalExperienceYearsNumeric is Decimal(5,2), so anything at or above 1000 is
 * rejected by Postgres and Prisma turns that into a thrown create/update that
 * loses the whole candidate. parseExperienceNumeric() takes the FIRST number in
 * the string, so a CV stating "since 2019" yields 2019 — survivable while this
 * column was fed a computed span or a hardcoded default, a live crash path now
 * that the parser's own value is trusted.
 *
 * @param {number|null} numeric
 * @returns {boolean}
 */
export function isStorableExperience(numeric) {
  if (numeric === null || numeric === undefined) return false;
  return Number.isFinite(numeric) && numeric >= 0 && numeric < MAX_EXPERIENCE_YEARS;
}

export default {
  parseResumeDate,
  monthsBetween,
  summariseEmploymentHistory,
  resolveExperienceYears,
  isStorableExperience,
  MAX_EXPERIENCE_YEARS,
};
