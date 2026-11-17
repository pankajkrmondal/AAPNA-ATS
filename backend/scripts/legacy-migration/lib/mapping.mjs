// Column mapping for the MS Access import.
// Source of truth: docs/Phase 4/PLAN-MS-Access-Data-Migration-Mapping.md, sections 3.4 to 3.6.
// One-time import: this file is not used by the application.

export const SOURCE_KIND = 'ms_access';
export const TAG = 'ms_access_migration';

/** Header text as compared: lower case, single spaces, no space around "/" or before "(". */
export const normHeader = (h) => String(h).toLowerCase().replace(/\s+/g, ' ').trim().replace(/\s*\/\s*/g, '/');

// rpa_cv column <- Access header variants (already normalised with normHeader).
const ALIASES = {
  _date: ['date'],
  Name: ['name'],
  Heat: ['heat'],
  NoticePeriod: ['notice period'],
  ContactNumber: ['phone', 'contact number'],
  EmailID: ['email id', 'e-mail id', 'email', 'email address'],
  HighestQualification: ['qualification', 'quaification'],
  TotalExperienceYears: ['experience', 'experience ( & months)', 'experience (year & months)', 'experience(& months)'],
  LastCompanyExperienceYears: ['in last company', 'year in last company', 'years in last company', 'experience in last company', 'last company'],
  CurrentLocation: ['location'],
  CTC_LPA: ['ctc', 'ctc (lpa)'],
  ExpectedCTC_LPA: ['ectc'],
  JobSource: ['source'],
  RecruiterInfoAAPNA: ['hr owner'],
  FinalStatus: ['final status', 'status'],
  TechRoundOne: ['technical skype/telephonic', 'technical 1st round', 'technical skype/telephonic/f2f - 1st round'],
  TechRoundTwo: ['technical f2f', 'technical 2nd round', 'technical 2', 'technical skype/telephonic/f2f - 2nd round'],
  TechRoundThree: ['technical 3rd round'],
  HRInterview: ['hr interview'],
  PositionApplied: ['role', 'job profile', 'profile name'],
  Top5KeySkills: ['key skills'],
  CurrentCompany: ['current company name'],
  Gender: ['gender'],
};
// Columns that can appear more than once in a table and are joined with a label.
const HR_COMMENT = ['hr quick comments', 'quickie comments', 'quicky comments - hr updates', 'hr owner feedback', 'hr screening comments'];
const MANAGERIAL = ['magerial interview', 'managerial interview'];
const CEO = ['ceo interview', 'ceo feedback'];
// Known columns the plan leaves out of rpa_cv (3.4). They stay in the provenance raw row.
const KNOWN_UNMAPPED = ['action taken/comments - hr', 'mail sent date', '3'];

const direct = new Map();
for (const [field, list] of Object.entries(ALIASES)) for (const a of list) direct.set(a, field);

/**
 * What one Access column feeds.
 * @returns {{kind:string, field?:string, den?:string}|null} null = not mapped and not expected.
 */
export function classifyHeader(header) {
  const h = normHeader(header);
  if (direct.has(h)) return { kind: 'direct', field: direct.get(h) };
  if (HR_COMMENT.includes(h)) return { kind: 'hrComment' };
  if (MANAGERIAL.includes(h)) return { kind: 'managerial' };
  if (CEO.includes(h)) return { kind: 'ceo' };
  let m = h.match(/^iq score(?:\/(\d+))?$/);
  if (m) return { kind: 'score', field: 'IQScore', den: m[1] || null };
  m = h.match(/^tech score ?(?:\/(\d+))?$/);
  if (m) return { kind: 'score', field: 'TechScore', den: m[1] || null };
  if (KNOWN_UNMAPPED.includes(h)) return { kind: 'knownUnmapped' };
  return null;
}

// Hyper Automation Clean Sheet has no column names: map by position (3.6).
export const HYPER_TABLE = 'Hyper Automation Clean Sheet';
export const HYPER_POSITIONS = {
  Field1: 'Date', Field2: 'Name', Field3: 'Heat', Field4: 'Notice Period', Field5: 'HR Quick comments',
  Field6: 'Phone', Field7: 'Email ID', Field8: 'Qualification', Field9: 'Experience', Field10: 'in Last Company',
  Field11: 'Location', Field12: 'CTC', Field13: 'ECTC', Field14: 'Source', Field15: 'HR Owner',
  Field16: 'IQ Score', Field17: 'Tech Score/25', Field18: 'Status', Field19: 'Technical Skype/Telephonic',
  Field20: 'Technical F2F', Field21: 'Managerial Interview', Field22: 'HR Interview',
};
export const HYPER_HEADER_ROW_ID = '1';

// Unnamed columns that hold real data (3.6). kind: appendTo = added to that notes field.
export const EXTRA_COLUMNS = {
  'Dot Net  March 2024': {
    Field23: { kind: 'appendTo', field: 'ManagerialOrCEOFeedback' },
    Field24: { kind: 'appendTo', field: 'HRInterview' },
    Field25: { kind: 'appendTo', field: 'HRInterview' },
    Field26: { kind: 'appendTo', field: 'HRInterview' },
  },
  Mobile: { Field21: { kind: 'appendTo', field: 'ManagerialOrCEOFeedback' } },
  'UI UX Designer': {
    Field24: { kind: 'direct', field: 'Top5KeySkills' },
    Field25: { kind: 'uiuxCompany' },
    Field26: { kind: 'direct', field: 'Gender' },
    Field27: { kind: 'direct', field: 'EnglishCommunicationRating' },
    Field28: { kind: 'direct', field: 'PreferredShift' },
    Field32: { kind: 'uiuxMarks' },
    // Yes/No answers to unknown form questions: not imported, kept in raw_row (decision 2, Q5).
    Field30: { kind: 'knownUnmapped' }, Field31: { kind: 'knownUnmapped' },
    Field34: { kind: 'knownUnmapped' }, Field37: { kind: 'knownUnmapped' },
  },
};

// Default role and key skills per table, used only when the row's own cell is blank (3.5).
export const TABLE_DEFAULTS = {
  'Accountant Role': ['Accountant', 'Accounts, Finance'],
  'Android Developer': ['Android Developer', 'Android'],
  Angular: ['Angular Developer', 'Angular'],
  BA: ['Business Analyst', 'Business Analysis'],
  'BD Manager - Middle East': ['BD Manager - Middle East', 'Business Development, Sales'],
  'BDE Junior': ['Business Development Executive (Junior)', 'Business Development, Sales'],
  'Build & Release': ['Build and Release Engineer', 'Build and Release'],
  'Customer Success Clean data': ['Customer Success', 'Customer Success'],
  'Dot Net': ['Dot Net Developer', '.NET'],
  'Dot Net  March 2024': ['Dot Net Developer', '.NET'],
  'Dot Net Developer 2024': ['Dot Net Developer', '.NET'],
  'DotNet 22 April': ['Dot Net Developer', '.NET'],
  'Hyper Automation Clean Sheet': ['Hyper Automation Developer', 'Hyper Automation, RPA'],
  'IT Support': ['IT Support', 'IT Support'],
  'Kony Hcl voltmx': ['Kony / HCL Volt MX Developer', 'Kony, HCL Volt MX'],
  Mobile: ['Mobile Developer', 'Mobile Development'],
  'Node JS': ['Node JS Developer', 'Node.js'],
  Others: ['', ''],
  PHP: ['PHP Developer', 'PHP'],
  'Power BI': ['Power BI Developer', 'Power BI'],
  QA: ['QA Engineer', 'Testing, QA'],
  'QA 20 Sept': ['QA Engineer', 'Testing, QA'],
  "Rakhi Ma'am cv": ['', ''],
  React: ['React Developer', 'React'],
  ROR: ['Ruby on Rails Developer', 'Ruby on Rails'],
  'Sales Leader': ['Sales Leader', 'Sales'],
  'UI UX Designer': ['UI/UX Designer', 'UI, UX'],
  UKG: ['UKG Consultant', 'UKG'],
};

// Load order: the pilot first, then by earliest data (3.12, R8).
export const RUN_ORDER = [
  'Build & Release', 'Power BI', 'Others', 'Mobile', 'PHP', 'BA', 'IT Support', 'Node JS', 'Dot Net',
  'QA', 'QA 20 Sept', 'Angular', 'React', 'Dot Net  March 2024', 'Dot Net Developer 2024', 'DotNet 22 April',
  'ROR', 'BDE Junior', 'Hyper Automation Clean Sheet', 'Sales Leader', 'Kony Hcl voltmx', 'UKG',
  'Android Developer', 'Accountant Role', 'UI UX Designer', 'BD Manager - Middle East',
  'Customer Success Clean data', "Rakhi Ma'am cv",
];

// Name column out of place by one row (decision of 17 Nov 2026: repair).
// In `DotNet 22 April` the Name cell of a row holds the name of the person on the NEXT row,
// inside four runs of rows; every other column is on the right row. Row numbers are the
// positional row ids written by the extract (r1 = first row of the table).
//   fromRowAbove  rows whose name is taken from the Name cell of the row above
//   blank         the row just before a run: its Name cell holds the next person's name, so
//                 its own name is not known and is left empty
//   review        rows at the edge of a run with no evidence either way: kept as they are, listed for HR
// The row count is checked so the rule cannot be applied to a different copy of the table.
export const NAME_ROW_REPAIR = {
  'DotNet 22 April': {
    column: 'Name',
    rowCount: 992,
    fromRowAbove: [[141, 144], [226, 316], [330, 338], [361, 475]],
    blank: [140, 329, 360],
    review: [145, 225, 328],
  },
};

// Legacy history fields: the ATS has no other copy of these (3.9).
export const HISTORY_FIELDS = ['HRQuickcomments', 'TechRoundOne', 'TechRoundTwo', 'TechRoundThree', 'ManagerialOrCEOFeedback', 'HRInterview'];

// Every rpa_cv text column the import can fill, in a fixed order.
export const CV_FIELDS = [
  'Name', 'EmailID', 'ContactNumber', 'PositionApplied', 'Top5KeySkills', 'HighestQualification',
  'TotalExperienceYears', 'LastCompanyExperienceYears', 'CurrentLocation', 'CurrentCompany',
  'CTC_LPA', 'ExpectedCTC_LPA', 'NoticePeriod', 'JobSource', 'RecruiterInfoAAPNA', 'Gender',
  'Heat', 'IQScore', 'TechScore', 'FinalStatus', ...HISTORY_FIELDS,
  'EnglishCommunicationRating', 'PreferredShift', 'EducationalScoresPercentage', 'a10th', 'a12th', 'graduation', 'postGraduation',
];
