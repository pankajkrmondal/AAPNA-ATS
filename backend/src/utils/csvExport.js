/**
 * csvExport.js — RFC 4180 CSV writer + download response helper.
 *
 * Deliberately dependency-free and side-effect-free (no Prisma, no logger, no
 * config) so it can be unit-tested with `npm run test:unit` without a database
 * or an Express app. See src/tests/csvExport.test.js.
 *
 * Why hand-rolled rather than `xlsx` (already a dependency): SheetJS's
 * `sheet_to_csv` emits no UTF-8 BOM, has no CSV-injection guard, and drags a
 * whole workbook model in to produce a flat file — we'd wrap it anyway.
 *
 * Known limitation, documented rather than hacked around: a bare 10-digit
 * phone number ("9876543210") is displayed by Excel as a NUMBER when the file
 * is opened by double-click, so a leading zero would be lost. Forcing text
 * would require emitting `="…"`, which is a formula — precisely what the
 * injection guard below exists to stop. The CSV itself is correct; Excel's
 * Data → From Text/CSV importer preserves it as text, as do Google Sheets and
 * LibreOffice.
 */

/**
 * Excel reads a CSV as the system codepage unless it sees this.
 * Written as an escape, not a literal — an invisible character in source is
 * one careless editor save away from vanishing.
 */
const BOM = '\uFEFF';

/** RFC 4180 §2.1 row terminator. */
const EOL = '\r\n';

/**
 * CSV-injection guard.
 *
 * A cell starting with = + - @ TAB or CR is evaluated as a formula by Excel /
 * LibreOffice / Google Sheets — the attack this defends against is a candidate
 * putting `=cmd|'/c calc'!A1` in a resume field that a recruiter later opens.
 *
 * Guarding is not free: the apostrophe we prepend IS visible when Excel opens
 * a CSV (unlike typing it into a cell). Blanket-guarding the whole OWASP set
 * would therefore render every Indian phone number as `'+91 98765 43210`, on
 * every row of every export — a lot of ugliness to stop a threat that isn't
 * one, since a value made only of digits and separators cannot reference a
 * cell or call a function.
 *
 * So: = @ TAB CR are always guarded, while a leading + or - is guarded only
 * when the value is not purely numeric-looking.
 */
const ALWAYS_DANGEROUS = /^[=@\t\r]/;
const SIGN_LEAD = /^[+-]/;
/** Phone numbers, signed amounts, "(020) 1234-5678" — data, not formulas. */
const NUMERIC_LIKE = /^[+-]?[\d\s().-]+$/;

function needsInjectionGuard(text) {
  if (ALWAYS_DANGEROUS.test(text)) return true;
  return SIGN_LEAD.test(text) && !NUMERIC_LIKE.test(text);
}

/**
 * Fixed export timezone. Not the server's local zone on purpose — a CSV
 * produced from staging and one from production must format the same instant
 * identically, or the two files can't be diffed.
 *
 * Exported because the dossier is no longer the only thing that renders one of
 * these instants for a reader. The public recording-share page prints the same
 * expiry the pack does, and formatting one of them in the server's local zone
 * had the page and the file naming different days for the same link.
 */
export const EXPORT_TIMEZONE = process.env.EXPORT_TZ || 'Asia/Kolkata';
const TZ = EXPORT_TIMEZONE;

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

const dateTimeFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

const toDate = (value) => {
  // Guard the empties explicitly: new Date(null) and new Date('') are NOT
  // "Invalid Date" — null coerces to 0, i.e. the epoch. A null timestamp
  // column would otherwise export as 1970-01-01.
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** @returns {string} `YYYY-MM-DD`, or '' when the value isn't a usable date. */
export function formatDate(value) {
  const d = toDate(value);
  return d ? dateFmt.format(d) : '';
}

/** @returns {string} `YYYY-MM-DD HH:mm`, or '' when the value isn't a usable date. */
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '';
  // en-CA gives "2026-08-10, 14:32" — drop the comma for a cleaner cell.
  return dateTimeFmt.format(d).replace(', ', ' ').replace(/,/g, '');
}

/**
 * Convert any value this codebase can produce into cell text.
 *
 * Handles every type that actually reaches an export: Prisma BigInt ids
 * (rpa_cv.id, rpa_candidate_pipeline.id), Prisma Decimal scores, Dates,
 * booleans, string arrays (Top5KeySkills) and JSON columns (CurrentCompany,
 * employment_history).
 *
 * @param {*} value
 * @param {{ type?: 'date'|'datetime' }} [column]
 * @returns {string}
 */
export function stringifyCell(value, column = {}) {
  if (value === null || value === undefined) return '';

  // BigInt: the global JSON replacer in app.js only covers res.json(), so a
  // CSV writer has to handle this itself or String() throws.
  if (typeof value === 'bigint') return value.toString();

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (value instanceof Date) {
    return column.type === 'date' ? formatDate(value) : formatDateTime(value);
  }

  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';

  if (typeof value === 'string') {
    // A date column whose value arrived as an ISO string still formats.
    if (column.type === 'date') return formatDate(value);
    if (column.type === 'datetime') return formatDateTime(value);
    return value;
  }

  if (typeof value === 'object') {
    // Prisma Decimal (and decimal.js) — has toFixed but isn't a number.
    if (typeof value.toFixed === 'function') return value.toString();
    // Semicolon-joined, not comma, so the cell stays readable inside quotes.
    if (Array.isArray(value)) {
      return value.map((v) => stringifyCell(v, column)).filter((s) => s !== '').join('; ');
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

/**
 * Encode one cell. EVERY field is quoted — the simplest provably-correct
 * RFC 4180 output, so no comma, quote, CR or LF in a value can break a row.
 *
 * `guard` is true only for values that were genuinely strings, so a real
 * negative number (-5) or a formatted date is never apostrophe-prefixed.
 */
function encodeCell(text, guard) {
  const s = guard && needsInjectionGuard(text) ? `'${text}` : text;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Resolve a dotted path ('currentCompany.Name') against a row, null-safe. */
function readPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

/**
 * @typedef {object} CsvColumn
 * @property {string}   header    Column heading as it appears in the file.
 * @property {string}  [key]      Dotted path into the row.
 * @property {Function}[value]    (row) => any. Takes precedence over `key`.
 * @property {'date'|'datetime'} [type] Date formatting for this column.
 * @property {boolean} [numeric]  Opt out of injection guarding so values like
 *                                "-5" or "+91…" stay numeric/plain in Excel.
 *                                Use ONLY for columns whose values are numbers
 *                                the user may want to SUM.
 */

/**
 * Serialise rows to a complete CSV document (BOM + header + rows).
 *
 * @param {Array<object>} rows
 * @param {CsvColumn[]} columns
 * @returns {string}
 */
export function buildCsv(rows, columns) {
  const lines = [columns.map((c) => encodeCell(String(c.header ?? ''), false)).join(',')];

  for (const row of rows || []) {
    lines.push(columns.map((col) => {
      const raw = typeof col.value === 'function' ? col.value(row) : readPath(row, col.key);
      const text = stringifyCell(raw, col);
      return encodeCell(text, typeof raw === 'string' && !col.numeric);
    }).join(','));
  }

  return BOM + lines.join(EOL) + EOL;
}

/**
 * `AAPNA-ATS_Candidates_2026-08-10-14-32.csv`
 * @param {string} base
 * @param {Date} [at]
 */
export function csvFilename(base, at = new Date()) {
  const stamp = formatDateTime(at).replace(/[: ]/g, '-');
  const slug = String(base).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `AAPNA-ATS_${slug}_${stamp}.csv`;
}

/**
 * Send a CSV as a file download.
 *
 * Buffered (res.end) rather than streamed on purpose: catchAsync hands a
 * mid-request throw to errorHandler, which calls res.status().json(). If we
 * had already streamed bytes, the client would receive a TRUNCATED CSV that
 * opens perfectly well — a silent data-loss bug. Worst case at the row cap is
 * a few tens of MB, which buffers trivially.
 *
 * Content-Length is deliberately not set: compression() rewrites the body.
 *
 * @param {import('express').Response} res
 * @param {string} csv
 * @param {string} filename
 * @param {Record<string, string|number>} [extraHeaders]
 */
export function sendCsv(res, csv, filename, extraHeaders = {}) {
  // Legacy `filename=` must be ASCII; `filename*=` carries the real one.
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v !== undefined && v !== null) res.setHeader(k, String(v));
  }

  return res.status(200).end(Buffer.from(csv, 'utf8'));
}

export default { buildCsv, csvFilename, sendCsv, stringifyCell, formatDate, formatDateTime };
