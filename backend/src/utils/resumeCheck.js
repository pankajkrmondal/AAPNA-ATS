/**
 * resumeCheck.js — is the file on a candidate's record actually a resume? (U01)
 *
 * An .xlsx bulk upload used to save the WORKBOOK as every row's resume, so the
 * interview panel received a spreadsheet holding every other candidate's
 * details. This is the one rule every surface uses to decide whether a resume
 * is on file: the panel pack, the Schedule window's warning, and the drawer's
 * "View resume".
 *
 * Two halves:
 *   - resumeStatus(cv): from what is stored (URL, item id, the uploadResume
 *     missing-data flag). No download, so the Schedule window can ask it cheaply.
 *   - checkResumeBytes(buffer): the final say once the file has been downloaded,
 *     using the bytes (fileSignature.js), because a URL does not always carry a
 *     file name.
 *
 * Pure: no Prisma, no Graph (tests/unit/resumeCheck.test.js).
 */
import { sniffDocumentType } from './fileSignature.js';

/** The only formats that travel as a resume. */
export const RESUME_EXTENSIONS = Object.freeze(['.pdf', '.doc', '.docx']);

export const RESUME_CONTENT_TYPES = Object.freeze({
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});

/** What resumeStatus() returns. */
export const RESUME_STATUS = Object.freeze({
  OK: 'ok',
  MISSING: 'missing',
  NOT_A_RESUME: 'not_a_resume',
});

const VIEWER_PAGE = new Set(['aspx', 'asp', 'html', 'htm', 'php', 'jsp']);
// OneDrive / SharePoint sharing links say the file kind in the path: /:w:/ Word,
// /:x:/ Excel, /:b:/ PDF, /:p:/ PowerPoint.
const SHARE_LINK_KIND = { w: '.docx', x: '.xlsx', b: '.pdf', p: '.pptx' };

const blank = (v) => {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'null' || s === 'undefined';
};

const extOf = (s) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(s || '').trim());
  return m ? m[1].toLowerCase() : '';
};

/**
 * The file extension a stored resume URL names, or '' when it does not say.
 * Reads the path, then SharePoint's `?file=` parameter (Doc.aspx viewer links),
 * then the sharing-link kind (`/:x:/`).
 *
 * @param {string|null} url
 * @returns {string} lowercase, with the dot
 */
export function resumeFileExtension(url) {
  if (blank(url)) return '';
  const raw = String(url).trim().split('#')[0];
  const [pathPart, query = ''] = raw.split('?');

  let pathExt = '';
  try { pathExt = extOf(decodeURIComponent(pathPart)); } catch { pathExt = extOf(pathPart); }
  if (pathExt && !VIEWER_PAGE.has(pathExt)) return `.${pathExt}`;

  try {
    const file = new URLSearchParams(query).get('file');
    const fileExt = extOf(file);
    if (fileExt && !VIEWER_PAGE.has(fileExt)) return `.${fileExt}`;
  } catch { /* not a parseable query string */ }

  const kind = /\/:([a-z]):\//i.exec(pathPart)?.[1]?.toLowerCase();
  return SHARE_LINK_KIND[kind] || '';
}

/**
 * Whether the record's missing-data JSON says the resume is still owed
 * (`uploadResume`, set on every Excel-upload row).
 * @param {string|object|null} missingData
 */
export function isResumeFlagged(missingData) {
  let obj = missingData;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return false; }
  }
  return Boolean(obj) && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, 'uploadResume');
}

/**
 * Is there a resume on file, judged from the record alone (no download)?
 *
 * @param {{cvFileUrl?: string|null, cv_file_item_id?: string|null, missingData?: string|object|null}|null} cv
 * @returns {'ok'|'missing'|'not_a_resume'}
 */
export function resumeStatus(cv) {
  if (!cv) return RESUME_STATUS.MISSING;
  if (blank(cv.cvFileUrl) && blank(cv.cv_file_item_id)) return RESUME_STATUS.MISSING;
  // A file is stored, but the record says the resume is still owed: the file
  // is the Excel workbook the row came from (or something else that is not it).
  if (isResumeFlagged(cv.missingData)) return RESUME_STATUS.NOT_A_RESUME;
  const ext = resumeFileExtension(cv.cvFileUrl);
  if (ext && !RESUME_EXTENSIONS.includes(ext)) return RESUME_STATUS.NOT_A_RESUME;
  return RESUME_STATUS.OK;
}

/** True only for a pdf, doc or docx resume that is not flagged as still owed. */
export function isRealResume(cv) {
  return resumeStatus(cv) === RESUME_STATUS.OK;
}

/**
 * The downloaded file's final check: the bytes, not the name, decide.
 *
 * @param {Buffer} buffer
 * @returns {{ok: boolean, ext: string, contentType: string|null}} `ext` is what
 *   the bytes say ('' when they say nothing recognisable)
 */
export function checkResumeBytes(buffer) {
  const ext = sniffDocumentType(buffer);
  const ok = RESUME_EXTENSIONS.includes(ext);
  return { ok, ext, contentType: ok ? RESUME_CONTENT_TYPES[ext] : null };
}

/**
 * Which side's resume a merge keeps (U01). The URL and the drive-item id are
 * ONE pair and always come from the same side: picking each separately (the
 * old per-field prefer()) could pair a new URL with the old item id, and the
 * pack fetches by item id first, so it attached the OLD resume.
 *
 * The incoming side wins only with a real resume (resumeStatus 'ok'); a null
 * or non-resume incoming pair never replaces what the candidate already has.
 *
 * @param {object|null} incoming - {cvFileUrl, cv_file_item_id, missingData}
 * @param {object|null} existing - same shape
 * @returns {{cvFileUrl: string|null, cv_file_item_id: string|null, from: 'incoming'|'existing'}}
 */
export function pickResumePair(incoming, existing) {
  const pairOf = (c) => ({
    cvFileUrl: blank(c?.cvFileUrl) ? null : c.cvFileUrl,
    cv_file_item_id: blank(c?.cv_file_item_id) ? null : c.cv_file_item_id,
  });
  if (resumeStatus(incoming) === RESUME_STATUS.OK) return { ...pairOf(incoming), from: 'incoming' };
  return { ...pairOf(existing), from: 'existing' };
}

/**
 * The missing-data JSON without the "resume still owed" flag, for a record
 * that does have one. Returns the same type it was given (string or object).
 * @param {string|object|null} missingData
 */
export function withoutResumeFlag(missingData) {
  if (!isResumeFlagged(missingData)) return missingData;
  const obj = typeof missingData === 'string' ? JSON.parse(missingData) : { ...missingData };
  delete obj.uploadResume;
  return typeof missingData === 'string' ? JSON.stringify(obj) : obj;
}

/** Number of fields a missing-data JSON (string or object) still lists. */
export function missingFieldCount(missingData) {
  let obj = missingData;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return 0; }
  }
  return obj && typeof obj === 'object' ? Object.keys(obj).length : 0;
}

export default {
  RESUME_EXTENSIONS, RESUME_CONTENT_TYPES, RESUME_STATUS,
  resumeFileExtension, isResumeFlagged, resumeStatus, isRealResume, checkResumeBytes,
  pickResumePair, withoutResumeFlag, missingFieldCount,
};
