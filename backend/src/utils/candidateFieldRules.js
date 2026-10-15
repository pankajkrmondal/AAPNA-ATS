/**
 * The candidate field rules shared by the public missing-details form and the
 * recruiter Edit form (Phase 3 "Do Now", N18). The screen checks the same
 * rules (frontend/src/constants/candidateFields.js); the server checks them
 * again because the public form is reachable without logging in.
 *
 * Works on rpa_cv column names. Only fields present in `fields` are checked:
 * a form that does not send a field never fails on it. Old values already in
 * the database are never re-validated.
 */
import { firstValidPhone } from './phone.js';

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Number from a form value: 12, "12", "12.5" — not "12 LPA". */
function strictNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const RANGE_RULES = [
  { field: 'CTC_LPA', label: 'CTC (LPA)', min: 0, max: 200 },
  { field: 'ExpectedCTC_LPA', label: 'Expected CTC (LPA)', min: 0, max: 200 },
  { field: 'TotalExperienceYears', label: 'Total experience', min: 0, max: 60 },
  { field: 'LastCompanyExperienceYears', label: 'Last company experience', min: 0, max: 60 },
  { field: 'a10th', label: '10th percentage', min: 0, max: 100 },
  { field: 'a12th', label: '12th percentage', min: 0, max: 100 },
  { field: 'graduation', label: 'Graduation percentage', min: 0, max: 100 },
  { field: 'postGraduation', label: 'Post graduation percentage', min: 0, max: 100 },
];

/**
 * @param {Record<string, unknown>} fields - rpa_cv columns being written
 * @param {Record<string, unknown>} [existing] - the current row, for the
 *   last-company vs total experience check when only one of them is sent
 * @returns {Array<{field: string, message: string}>} empty when everything is valid
 */
export function validateCandidateFields(fields = {}, existing = {}) {
  const errors = [];

  if (present(fields.ContactNumber) && !firstValidPhone(fields.ContactNumber)) {
    errors.push({ field: 'ContactNumber', message: 'Enter a 10-digit mobile number (for example 98765 43210 or +91 98765 43210).' });
  }
  if (present(fields.EmailID) && !EMAIL_RE.test(String(fields.EmailID).trim())) {
    errors.push({ field: 'EmailID', message: 'Enter a valid email address.' });
  }

  for (const rule of RANGE_RULES) {
    if (!present(fields[rule.field])) continue;
    const n = strictNumber(fields[rule.field]);
    if (n === null) {
      errors.push({ field: rule.field, message: `${rule.label} must be a number.` });
    } else if (n < rule.min || n > rule.max) {
      errors.push({ field: rule.field, message: `${rule.label} must be between ${rule.min} and ${rule.max}.` });
    }
  }

  // Last-company experience cannot exceed total experience. Uses the value
  // being saved, else the stored one; an unparseable stored value is ignored.
  const total = strictNumber(present(fields.TotalExperienceYears) ? fields.TotalExperienceYears : existing.TotalExperienceYears);
  const last = strictNumber(present(fields.LastCompanyExperienceYears) ? fields.LastCompanyExperienceYears : existing.LastCompanyExperienceYears);
  const touched = present(fields.TotalExperienceYears) || present(fields.LastCompanyExperienceYears);
  if (touched && total !== null && last !== null && last > total) {
    errors.push({ field: 'LastCompanyExperienceYears', message: `Last company experience cannot be more than total experience (${total} years).` });
  }

  return errors;
}

/** The errors as one sentence for a 400 response. */
export function describeFieldErrors(errors) {
  return errors.map((e) => e.message).join(' ');
}

export default { validateCandidateFields, describeFieldErrors };
