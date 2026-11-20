// Value rules for the Excel layouts that Stage 1's rules.mjs does not cover (plan 4.4).
// Pure functions: no database, no file access. A cell is [kind, value] as written by
// 1-extract-excel.mjs (kind s = text, n = number, d = date 'YYYY-MM-DD', b = boolean, e = error).
import * as R from '../../legacy-migration/lib/rules.mjs';
import { parseExperienceNumeric } from '../../../src/utils/candidateParser.js';

/** Trimmed text; an Excel error cell (#N/A, #VALUE!) is empty. */
export const text = (cell) => (cell && cell[0] !== 'e' ? R.text(cell) : '');

// Naukri writes "NA", "Not Mentioned", "Not Pursuing Pg" where there is no value.
const NA = /^(na|n\/a|#n\/a|none|nil|null|-+|not mentioned|not disclosed|not specified|not pursuing pg|not pursuing graduation|not pursuing)$/i;
export const blank = (cell) => { const s = text(cell).replace(/\s+/g, ' '); return NA.test(s) ? '' : s; };
/** blank() as a cell, so Stage 1 rules can run on it. */
export const asCell = (cell) => ['s', blank(cell)];
/**
 * The cell untouched unless it is an "NA" placeholder or an error. For emails and phones: their
 * rules split on line breaks (Naukri puts a second number on its own line), so whitespace
 * must not be collapsed first.
 */
export const unlessNa = (cell) => (blank(cell) ? cell : ['s', '']);

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Dates. "18 Apr 2023" and "29-Jan-2025" here; anything else through Stage 1 rule V1. */
export function parseDate(cell, today = new Date()) {
  const s = text(cell);
  const m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*[\s,-]+(\d{4})\b/);
  if (!m) return R.parseDate(cell && cell[0] === 'e' ? null : cell, today);
  const d = Number(m[1]); const mo = MONTHS[m[2].toLowerCase()]; const y = Number(m[3]);
  if (!mo) return { date: null, warn: 'date_unreadable' };
  return R.parseDate(['s', `${d}-${mo}-${y}`], today);
}

/**
 * Experience. Naukri states months: "6Y 7 M", "5 Year(s) 6 Month(s)", "Fresher".
 * Display "6 Years 7 Months"; numeric years + months / 12. Anything else: Stage 1 rule V4.
 */
export function experience(cell) {
  const s = blank(cell);
  if (!s) return { value: '', numeric: null, warn: null };
  if (/^fresher$/i.test(s)) return { value: 'Fresher', numeric: 0, warn: null };
  const m = s.match(/^(\d+)\s*(?:y|yrs?|years?|year\(s\))\s*(?:(\d+)\s*(?:m|months?|month\(s\)))?$/i);
  if (m) {
    const y = Number(m[1]); const mo = Number(m[2] || 0);
    if (mo > 11 || y > 60) return { value: s, numeric: null, warn: 'experience_out_of_range' };
    const parts = [];
    if (y || !mo) parts.push(`${y} ${y === 1 ? 'Year' : 'Years'}`);
    if (mo) parts.push(`${mo} ${mo === 1 ? 'Month' : 'Months'}`);
    return { value: parts.join(' '), numeric: Math.round((y + mo / 12) * 100) / 100, warn: null };
  }
  const r = R.cleanExperience(['s', s]);
  return { value: r.value, numeric: null, warn: r.warn };
}

/** Numeric experience of a display text written by experience() or by Stage 1 rule V4. */
export function experienceNumeric(display) {
  if (!display) return null;
  const s = String(display);
  if (/^fresher$/i.test(s)) return 0;
  const m = s.match(/^(?:(\d+)\s+Years?)?\s*(?:(\d+)\s+Months?)?$/);
  if (m && (m[1] || m[2])) return Math.round((Number(m[1] || 0) + Number(m[2] || 0) / 12) * 100) / 100;
  return parseExperienceNumeric(s); // "5.5" and the like, as the ATS reads them
}

/** CTC in LPA. "INR 6.0 L", "Rs 4.20 Lakhs", "500000" (rupees): currency stripped, then Stage 1 rule V5. */
export function ctc(cell) {
  const s = blank(cell).replace(/^(?:inr|rs\.?|₹)\s*/i, '').trim();
  if (!s) return { value: '', warn: null };
  return R.cleanCtc(['s', s]);
}

/** Notice period: Naukri text kept as written ("15 Days or less"); a plain number becomes "30 days". */
export const notice = (cell) => R.cleanNotice(asCell(cell));

/** Layout C role: "HR Intern role | AAPNA Infotech | WFH" -> "HR Intern role". */
export const jobTitleRole = (cell) => blank(cell).split('|')[0].trim();

/** Layout C shift question: "Are you ok with 11 am to 8 pm shift?" + "Yes" -> "11 am to 8 pm shift: Yes". */
export function shiftAnswer(question, cell) {
  const a = blank(cell);
  if (!a) return '';
  const what = (question.match(/with\s+(.*?)\s*\??$/i) || [])[1] || question.replace(/\?$/, '');
  return `${what}: ${a}`;
}

/** Names: trimmed, single spaces, without surrounding quotes. */
export const name = (cell) => text(cell).replace(/\s+/g, ' ').replace(/^["'“”]+|["'“”]+$/g, '').trim();
