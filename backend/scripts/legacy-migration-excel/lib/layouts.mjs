// Stage 2 (Excel and Naukri) layouts and column mapping.
// Source of truth: docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, section 4,
// and PLAN-MS-Access-Data-Migration-Mapping.md section 4.2. One-time import; not used by the application.
//
// Layout A  AAPNA tracker, same headers as the Access tables: the Stage 1 alias list, imported read-only.
// Layout B  Naukri Resdex download (sheet "Candidate Details").
// Layout C  Naukri job-application export (sheet "MySheet").
// Layout D  Rakhi Ma'am cv.xlsx, sheet "Intern Profile".
import { classifyHeader as classifyAccessHeader, normHeader, HISTORY_FIELDS as ACCESS_HISTORY, CV_FIELDS as ACCESS_CV_FIELDS } from '../../legacy-migration/lib/mapping.mjs';

export { normHeader };
export const SOURCE_KIND = 'excel';
export const TAG = 'legacy_excel_migration';
export const HISTORY_FIELDS = ACCESS_HISTORY;
// Stage 1 fields plus the degree columns the Naukri layouts carry.
export const CV_FIELDS = [...ACCESS_CV_FIELDS, 'graduationdegree', 'graduationspecialization', 'postgraduationdegree', 'postgraduationspecialization'];

// Load order of the layouts (plan 2.2, Wave 2): trackers, intern sheet, Resdex, applications.
export const LAYOUT_ORDER = ['A', 'D', 'B', 'C'];
export const LAYOUT_NAMES = { A: 'AAPNA tracker', B: 'Naukri Resdex download', C: 'Naukri job-application export', D: 'Intern sheet' };

// Spreadsheets and sheets that are not loaded, with the reason (recorded in the manifest).
export function skipReason(file, sheet) {
  if (/karya keeper/i.test(file)) return 'Not candidate data: staff timesheet (plan 4.1)';
  if (/^candidate insights$/i.test(sheet.trim())) return 'Naukri summary statistics; no candidate rows';
  if (/rakhi ma'am cv/i.test(file) && /^exp & fresher$/i.test(sheet.trim())) return "Already imported in Stage 1 as the MS Access table \"Rakhi Ma'am cv\" (plan 4.1)";
  return null;
}

// ── Header classification ───────────────────────────────────────────────────
// A classification is { kind, field? }. kind:
//   direct      the value goes to `field` through the field's value rule
//   date        createdAt
//   email, phone
//   hrComment   joined into HRQuickcomments
//   managerial, ceo, score, appendTo   (layout A, as Stage 1)
//   jobTitle    layout C role: the text before the first " | "
//   ug, ugSpec, pg, pgSpec, postPg, doctorate   degrees
//   ans         a screening question; `target` says which field it fills, or null
//   knownUnmapped   kept in the provenance raw row only
const B_MAP = {
  'candidate name': { kind: 'direct', field: 'Name' },
  'contact no.': { kind: 'phone' },
  email: { kind: 'email' },
  'work exp': { kind: 'direct', field: 'TotalExperienceYears' },
  'annual salary': { kind: 'direct', field: 'CTC_LPA' },
  'current location': { kind: 'direct', field: 'CurrentLocation' },
  'current employer': { kind: 'direct', field: 'CurrentCompany' },
  designation: { kind: 'direct', field: 'PositionApplied' },
  'resume title': { kind: 'direct', field: 'Top5KeySkills' },
  'u.g. course': { kind: 'ug' },
  'p. g. course': { kind: 'pg' },
  'post p. g. course': { kind: 'postPg' },
  'last active date': { kind: 'date' },
  'preferred location': { kind: 'knownUnmapped' },
  'age/date of birth': { kind: 'knownUnmapped' },
  'postal address': { kind: 'knownUnmapped' },
  'resume id': { kind: 'knownUnmapped' },
  '#': { kind: 'knownUnmapped' },
};
const C_MAP = {
  'job title': { kind: 'jobTitle' },
  'date of application': { kind: 'date' },
  name: { kind: 'direct', field: 'Name' },
  'email id': { kind: 'email' },
  'phone number': { kind: 'phone' },
  'current location': { kind: 'direct', field: 'CurrentLocation' },
  'total experience': { kind: 'direct', field: 'TotalExperienceYears' },
  'curr. company name': { kind: 'direct', field: 'CurrentCompany' },
  'key skills': { kind: 'direct', field: 'Top5KeySkills' },
  'annual salary': { kind: 'direct', field: 'CTC_LPA' },
  'notice period/availability to join': { kind: 'direct', field: 'NoticePeriod' },
  'under graduation degree': { kind: 'ug' },
  'ug specialization': { kind: 'ugSpec' },
  'post graduation degree': { kind: 'pg' },
  'pg specialization': { kind: 'pgSpec' },
  'doctorate degree': { kind: 'doctorate' },
  gender: { kind: 'direct', field: 'Gender' },
  'latest pipeline stage': { kind: 'direct', field: 'FinalStatus' },
};
// Layout C columns the plan leaves out of rpa_cv (Access plan 4.2, last row): kept in raw_row.
const C_UNMAPPED = [
  'preferred locations', 'curr. company designation', 'department', 'role', 'industry', 'resume headline', 'summary',
  'ug university/institute name', 'ug graduation year', 'pg university/institute name', 'pg graduation year',
  'doctorate specialization', 'doctorate university/institute name', 'doctorate graduation year',
  'marital status', 'home town/city', 'pin code', 'work permit for usa', 'date of birth', 'permanent address',
  'last workflow activity', 'last workflow activity by', 'time of last workflow activity update',
  'pipeline status updated by', 'time when stage updated', 'download', 'downloaded by', 'time of download',
  'viewed', 'viewed by', 'time of view', 'emailed', 'emailed by', 'time of email',
  'calling status', 'calling status updated by', 'time of calling activity update',
  // Naukri's channel ("Hot Vacancy", "Broadcast"): JobSource is "Naukri <year>" (decision S11).
  'source',
];
const D_MAP = {
  name: { kind: 'direct', field: 'Name' },
  'email id': { kind: 'email' },
  'phone number': { kind: 'phone' },
  'intership/position applied for': { kind: 'direct', field: 'PositionApplied' },
};

// Screening questions (layout C) are matched by keywords in the question text (plan 4.3).
export function classifyQuestion(q) {
  const s = q.toLowerCase();
  if (/expected ctc/.test(s)) return 'ExpectedCTC_LPA';
  if (/current ctc/.test(s)) return 'CTC_LPA';
  if (/notice period/.test(s)) return 'NoticePeriod';
  if (/english/.test(s) && /rate|rating/.test(s)) return 'EnglishCommunicationRating';
  if (/shift/.test(s)) return 'PreferredShift';
  return null;
}

/** What one column of a sheet of the given layout feeds; null = not expected (reported as unmapped). */
export function classifyHeader(layout, header) {
  const h = normHeader(header);
  if (layout === 'A') return classifyAccessHeader(header);
  if (/^comment \d$/.test(h) && (layout === 'B' || layout === 'C')) return { kind: 'hrComment' };
  if (layout === 'B') return B_MAP[h] || null;
  if (layout === 'C') {
    if (C_MAP[h]) return C_MAP[h];
    if (/^comment \d by$|^time comment \d posted$/.test(h) || C_UNMAPPED.includes(h)) return { kind: 'knownUnmapped' };
    const m = String(header).match(/^\s*Ans\((.*)\)\s*$/is);
    if (m) return { kind: 'ans', question: m[1].replace(/\s+/g, ' ').trim(), target: classifyQuestion(m[1]) };
    return null;
  }
  if (layout === 'D') return D_MAP[h] || null;
  return null;
}

/** Layout of a sheet from its header row; null = a header set never seen before (stops the transform). */
export function detectLayout(headers) {
  const hs = new Set(headers.map(normHeader).filter(Boolean));
  if (hs.has('candidate name') && hs.has('resume id') && hs.has('contact no.')) return 'B';
  if (hs.has('job title') && hs.has('date of application') && hs.has('email id')) return 'C';
  if (hs.has('intership/position applied for') && hs.has('email id') && hs.size <= 6) return 'D';
  if (hs.has('hr owner') && hs.has('email id') && hs.has('name')) return 'A';
  return null;
}

/** Header row: the first of the first 10 rows that holds a name column and 3 or more cells. 0-based, -1 = none. */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = (rows[i] || []).map((c) => normHeader(c ?? '')).filter(Boolean);
    if (cells.length >= 3 && (cells.includes('name') || cells.includes('candidate name'))) return i;
  }
  return -1;
}

// ── Defaults per file (R5): used only when the row's own cell is blank ─────
// Layout A: the file's own most common Role / Key Skills value, or the Stage 1 table default
// for the same role. Layout B: the role in the file name. Layout D: intern.
const FILE_DEFAULTS = [
  [/^BDA\.xlsx$/i, 'Business Development Executive', 'Business Development'],
  [/Decisions Developer/i, 'Decisions and RPA Developer', 'Decisions, RPA'],
  [/Dot Net Developer/i, 'Dot Net Developer', '.NET'],
  [/QA Testing/i, 'QA Engineer', 'Testing, QA'],
  [/_Android\.xlsx$/i, 'Android Developer', 'Android'],
  [/_Business Analyst\.xlsx$/i, 'Business Analyst', 'Business Analysis'],
  [/devops/i, 'DevOps Engineer', 'DevOps'],
  [/_Flutter\.xlsx$/i, 'Flutter Developer', 'Flutter'],
  [/_iOs\.xlsx$/i, 'iOS Developer', 'iOS'],
  [/_NodeJS\.xlsx$/i, 'Node JS Developer', 'Node.js'],
  [/Rakhi Ma'am cv\.xlsx$/i, 'Intern', ''],
];
/** [role, skills] defaults for a unit, or null when the layout needs one and the file name gives none. */
export function fileDefaults(layout, file) {
  const base = file.split(/[\\/]/).pop();
  for (const [re, role, skills] of FILE_DEFAULTS) if (re.test(base)) return [role, skills];
  return layout === 'C' ? ['', ''] : null; // layout C: Job Title is on every row
}

/** JobSource for a unit (decision S11). Layout A and D: null = the row's own Source column, if any. */
export function jobSourceOf(layout, file) {
  if (layout !== 'B' && layout !== 'C') return null;
  const top = file.split(/[\\/]/)[0];
  const range = top.match(/(20\d\d)\s*-\s*(20\d\d)/);
  if (range) return `Naukri ${range[1]}-${range[2].slice(2)}`;
  const one = top.match(/(20\d\d)/);
  if (one) return `Naukri ${one[1]}`;
  return undefined; // a Naukri folder with no year: stops that file (plan 4.3)
}
