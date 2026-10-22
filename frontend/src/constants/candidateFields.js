/**
 * Candidate field lists and rules shared by the public missing-details form
 * (MissingJdUpload) and the recruiter Edit form on Candidates (Phase 3 "Do
 * Now", N18). The server applies the same rules again in
 * backend/src/utils/candidateFieldRules.js; keep the two in step.
 */

export const QUALIFICATION_OPTIONS = [
  'BE / BTech', 'MCA', 'BCA', 'BSc', 'BCom', 'BBA', 'BA',
  'MTech', 'MSc', 'MBA', 'MA', 'Diploma', 'Other (please specify)',
];
export const QUALIFICATION_OTHER = 'Other (please specify)';

export const NOTICE_PERIOD_OPTIONS = [
  'Immediate', '15 days', '30 days', '45 days', '60 days', '90 days', 'More than 90 days',
];

export const SHIFT_OPTIONS = ['2pm - 11pm/3pm - 12am', '4pm - 1am', 'Flexible', 'Others'];

export const ENGLISH_RATING_OPTIONS = [1, 2, 3, 4, 5];

/** "None" in the Recruiter (AAPNA) list: the candidate came on their own. */
export const RECRUITER_NONE = 'None';

/**
 * Every 10-digit mobile number in a phone field, as the server reads it: the
 * last 10 digits of each part split on , ; or /. "+91 98765 43210" and
 * "098765-43210" both give "9876543210".
 * @param {string|number|null|undefined} value
 * @returns {string|null} the first usable number, or null
 */
export function firstValidPhone(value) {
  if (value == null) return null;
  for (const part of String(value).split(/[,;/]/)) {
    const digits = part.replace(/[^0-9]/g, '');
    if (digits.length >= 10) return digits.slice(-10);
  }
  return null;
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/** antd Form rule: a 10-digit mobile number (blank allowed; add `required` separately). */
export const phoneRule = {
  validator: (_, value) => (blank(value) || firstValidPhone(value)
    ? Promise.resolve()
    : Promise.reject(new Error('Enter a 10-digit mobile number (for example 98765 43210 or +91 98765 43210).'))),
};

/** antd Form rule: an email address (blank allowed). */
export const emailRule = {
  validator: (_, value) => (blank(value) || EMAIL_RE.test(String(value).trim())
    ? Promise.resolve()
    : Promise.reject(new Error('Enter a valid email address.'))),
};

/**
 * antd Form rule: a plain number within [min, max] (blank allowed).
 * @param {string} label - e.g. "Expected CTC (LPA)"
 */
export function rangeRule(label, min, max) {
  return {
    validator: (_, value) => {
      if (blank(value)) return Promise.resolve();
      const s = String(value).trim();
      if (!NUMBER_RE.test(s)) return Promise.reject(new Error(`${label} must be a number.`));
      const n = Number(s);
      if (n < min || n > max) return Promise.reject(new Error(`${label} must be between ${min} and ${max}.`));
      return Promise.resolve();
    },
  };
}

export const ctcRule = (label) => rangeRule(label, 0, 200);
export const experienceRule = (label) => rangeRule(label, 0, 60);
export const percentRule = (label) => rangeRule(label, 0, 100);

/**
 * antd Form rule factory: last-company experience may not exceed total.
 * @param {string} totalField - the form field holding total experience
 */
export function notMoreThanTotalRule(totalField) {
  return ({ getFieldValue }) => ({
    validator: (_, value) => {
      const total = String(getFieldValue(totalField) ?? '').trim();
      const last = String(value ?? '').trim();
      if (!NUMBER_RE.test(total) || !NUMBER_RE.test(last)) return Promise.resolve();
      return Number(last) > Number(total)
        ? Promise.reject(new Error(`Last company experience cannot be more than total experience (${total} years).`))
        : Promise.resolve();
    },
  });
}

/**
 * The options for a Select, keeping a stored value that is not in the list
 * (old free-text data) so editing a candidate never silently drops it.
 * @param {Array<string|number>} list
 * @param {unknown} current
 */
export function optionsKeeping(list, current) {
  const opts = list.map((v) => ({ value: v, label: String(v) }));
  if (!blank(current) && !list.some((v) => String(v) === String(current))) {
    opts.push({ value: current, label: `${current} (old value)` });
  }
  return opts;
}
