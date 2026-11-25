// Stage 3 (resumes): what each source folder means.
// docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, 5.2 (role from the folder name, R5).
//
// role / skills: used ONLY when the parser returns no role / no skills for the resume.
// null = no default (the folder name does not say one role), the parser's value or empty.
// year: the OneDrive sub-folder ('Legacy resumes/<year>') and the load order (oldest first, R8).
// Names follow the Stage 1 / Stage 2 defaults (Access plan 3.5, Stage 2 plan 4.3) where the role is the same.
//
// The key is the folder path relative to the archive root, '\' separated, exactly as on disk.
// A folder that is not listed here stops the inventory (no silent guess).

export const FOLDERS = Object.freeze({
  'Good Profiles Count from Outlook, Naukri - 2023': { year: '2023', role: null, skills: null },
  'Good Profiles Count from Outlook, Naukri - 2023\\Year 2023_Dot Net Profiles': { year: '2023', role: 'Dot Net Developer', skills: '.NET' },
  'Good Profiles Count from Outlook, Naukri - 2023\\Year 2023_Hyper Automation Profiles': { year: '2023', role: 'Hyper Automation Developer', skills: 'Hyper Automation, RPA' },
  'Good Profiles Count from Outlook, Naukri - 2023\\Year 2023_Other Profiles': { year: '2023', role: null, skills: null },
  'Good Profiles Count from Outlook, Naukri - 2023\\Year 2023_Testing Profiles': { year: '2023', role: 'QA Engineer', skills: 'Testing, QA' },
  'Good Profiles Count from Outlook, Naukri - 2023\\Year 2023_Web Profiles': { year: '2023', role: 'Web Developer', skills: 'Web Development' },
  'Year 2023_Excel Data\\Year 2023_Manual QA Excel Data': { year: '2023', role: 'QA Engineer', skills: 'Manual Testing, QA' },
  'Naukri Download Data 2023\\Naukri Resdex Resumes_2023\\Naukri Resume Data 2023 _Angular JS': { year: '2023', role: 'Angular Developer', skills: 'Angular' },
  'Naukri Download Data 2023\\Naukri Resdex Resumes_2023\\Naukri Resume Data 2023 _Automation Testing': { year: '2023', role: 'Automation Test Engineer', skills: 'Automation Testing' },
  'Naukri Download Data 2023\\Naukri Resdex Resumes_2023\\Naukri Resume Data 2023 _QA Automation': { year: '2023', role: 'QA Automation Engineer', skills: 'QA Automation, Testing' },
  'Naukri Download Data 2023\\Naukri Resdex Resumes_2023\\Naukri Resume Data 2023 _React JS': { year: '2023', role: 'React Developer', skills: 'React' },
  'Naukri Download Data 2023\\Naukri Resdex Resumes_2023\\Naukri Resume Data 2023_DevOps': { year: '2023', role: 'DevOps Engineer', skills: 'DevOps' },
  'Naukri Download Data 2023\\Naukri Resdex Resumes_2023\\Naukri Resume Data 2023_Dot Net': { year: '2023', role: 'Dot Net Developer', skills: '.NET' },
  'Naukri Download Data 2023\\Naukri Resdex Resumes_2023\\Naukri Resume Data 2023_NodeJS': { year: '2023', role: 'Node JS Developer', skills: 'Node.js' },
  'Naukri Good Profile Data Year 2024 - 2025\\Automation Testing & Lead_4-12 years': { year: '2024-25', role: 'Automation Test Lead', skills: 'Automation Testing' },
  'Naukri Good Profile Data Year 2024 - 2025\\BA QA': { year: '2024-25', role: null, skills: null },
  'Naukri Good Profile Data Year 2024 - 2025\\Dot Net Naveen': { year: '2024-25', role: 'Dot Net Developer', skills: '.NET' },
  'Naukri Good Profile Data Year 2024 - 2025\\Dotnet 5+ years': { year: '2024-25', role: 'Dot Net Developer', skills: '.NET' },
  'Naukri Good Profile Data Year 2024 - 2025\\Flutter 5+ yrs': { year: '2024-25', role: 'Flutter Developer', skills: 'Flutter' },
  'Naukri Good Profile Data Year 2024 - 2025\\IOS': { year: '2024-25', role: 'iOS Developer', skills: 'iOS' },
  'Naukri Good Profile Data Year 2024 - 2025\\Mendix All experience': { year: '2024-25', role: 'Mendix Developer', skills: 'Mendix' },
  'Naukri Good Profile Data Year 2024 - 2025\\Mern stack 3-5 yrs': { year: '2024-25', role: 'MERN Stack Developer', skills: 'MERN Stack' },
  'Naukri Good Profile Data Year 2024 - 2025\\QA Manual & Automation Testing_4+ years': { year: '2024-25', role: 'QA Engineer', skills: 'Manual Testing, Automation Testing' },
  'Naukri Good Profile Data Year 2024 - 2025\\ROR 5+ yrs': { year: '2024-25', role: 'Ruby on Rails Developer', skills: 'Ruby on Rails' },
  'Naukri Good Profile Data Year 2024 - 2025\\Sales 1-8 yrs': { year: '2024-25', role: 'Sales Executive', skills: 'Sales' },
  'Naukri Good Profile Data Year 2024 - 2025\\Sales 8+ yrs': { year: '2024-25', role: 'Sales Leader', skills: 'Sales' },
});

// What a "present" end date on a resume from this folder counts up to (decision S23): December of the folder's
// last year ('2023' -> '12/2023', '2024-25' -> '12/2025'), as MM/YYYY, a form experienceParser reads.
export function presentAsOf(year) {
  const m = String(year || '').match(/(\d{4})(?:\s*-\s*(\d{2,4}))?$/);
  if (!m) throw new Error(`folder year "${year}" has no readable year`);
  const last = m[2] ? (m[2].length === 2 ? Number(m[1].slice(0, 2) + m[2]) : Number(m[2])) : Number(m[1]);
  return `12/${last}`;
}

// Spreadsheets belong to Stage 2 (decision S17) and are not part of Stage 3.
export const STAGE2_EXT = new Set(['.xlsx', '.xls', '.xlsm', '.csv']);

// What the file really is, from its first bytes (the extension is not trusted: 46 ".doc" files are HTML,
// 2 are DOCX, and 5 saved e-mails have no usable extension).
export function sniffKind(buf) {
  const hex = buf.subarray(0, 4).toString('hex').toUpperCase();
  if (hex === '25504446') return 'pdf';
  if (hex === 'D0CF11E0') return 'ole2';
  if (hex === '504B0304') {
    if (buf.includes(Buffer.from('word/document.xml'))) return 'docx';
    if (buf.includes(Buffer.from('ppt/presentation.xml'))) return 'pptx';
    return 'zip_other';
  }
  if (hex.startsWith('FFD8FF')) return 'jpg';
  if (hex === '89504E47') return 'png';
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (/^(Received|Return-Path|From|MIME-Version|Delivered-To|X-[\w-]+):/i.test(head)) return 'email';
  // A browser form-upload body saved to disk ("------WebKitFormBoundary..."): the real file is inside.
  if (/^-{2,}(WebKitFormBoundary|[\w'()+,./:=?-]{10,})\r?\n/.test(head) && /Content-Disposition:\s*form-data/i.test(head)) return 'form_upload';
  if (head.startsWith('<')) return 'html';
  return 'unknown';
}

// How a file of a given kind (and extension) is read in Stage 3.
//   original      : PDF/DOCX read as they are (extractTextFromFile)
//   converted     : .doc -> <work>/converted/... .docx by 1b-convert.mjs (decision S19)
//   scanned       : image, text from the scanned-file reader (plan 5.3)
//   extracted     : saved e-mail or saved form-upload body; the PDF inside taken out by 1c-extract-email-pdfs.mjs (S21, option A)
//   unsupported   : not imported, outcome skipped_unsupported_type, listed for HR (S20)
export function routeOf(kind, ext) {
  if (ext === '.doc') return (kind === 'ole2' || kind === 'html' || kind === 'docx') ? 'converted' : 'unsupported';
  if (kind === 'pdf' || kind === 'docx') return 'original';
  if (kind === 'jpg' || kind === 'png') return 'scanned';
  if (kind === 'email' || kind === 'form_upload') return 'extracted';
  return 'unsupported';
}
