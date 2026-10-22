/**
 * evalgroundRow.js — reading everything an Evalground export says about ONE
 * candidate, not just their three section scores.
 *
 * WHY THIS EXISTS. Evalground has no API, and it produces no per-candidate
 * report file: what HR can export is one workbook per TEST with one ROW per
 * candidate (47 columns, identical across the 2025 and 2026 sample exports in
 * docs/). The import has always read that file — and then kept 7 of the 47
 * columns, discarding every correct/wrong/unattempted count, every difficulty
 * split, the duration, the attempt date and the whole test-specific topic tail.
 * The candidate dossier therefore had nothing to show beyond three numbers, and
 * the pack said so: "the original report is not yet stored in the ATS".
 *
 * So this parses the row properly, once, at import time. See
 * docs/phase3/ASSESSMENT-REPORT-UPLOAD-PLAN.md §4.
 *
 * DETERMINISTIC, NOT AI. The rest of this import asks an LLM to read each row,
 * because the columns HR pastes in vary and an email address must be recognised
 * however it is labelled. These fields are different: the 47 headers have been
 * byte-identical across every export we have seen, and a hallucinated "S2 Wrong"
 * would be a wrong number in front of an interviewer with nothing to flag it.
 * Header lookup cannot invent a value; when a header is missing the field is
 * null, which the pack renders honestly as "—".
 *
 * TWO RULES ABOUT ABSENCE, both learned from the real file:
 *
 *   1. Blank is blank, zero is zero. `S1 Result` is empty in every sample. It
 *      must land as null, never as a falsy 0 that renders as a score of nought.
 *   2. The topic tail is DISCOVERED, never hard-coded. "Sql, Coding, Python, Py
 *      Test, Playwright, Pywinauto" are that one test's topics; the next test
 *      HR runs will have others. Anything that is not a known header is a topic.
 *
 * Pure: no Prisma, no config, no network — so `npm run test:unit` can pin the
 * parsing without a database, the same constraint dossierRedaction.js documents.
 */

/** Normalise a header for lookup: case, padding and doubled spaces all vary. */
const normHeader = (key) => String(key ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Section-scoped headers, generated rather than typed out three times. */
function sectionHeaders(n) {
  return [
    `section ${n} marks`, `section ${n}`,
    `s${n} correct`, `s${n} wrong`, `s${n} unattempted`,
    `s${n} easy correct`, `s${n} medium correct`, `s${n} hard correct`,
    `s${n} result`,
  ];
}

/**
 * Every header Evalground's own export is known to emit.
 *
 * Its only job is to answer "is this column a topic?" — a column NOT in here is
 * one this test defined, and belongs in the topic table. Adding a header here
 * therefore REMOVES it from the topic list, which is exactly what you want for
 * a column we read by name and exactly what you do not want for a real topic.
 */
export const EVALGROUND_FIXED_HEADERS = Object.freeze(new Set([
  'candidate name', 'candidate location', 'candidate email', 'contact number',
  'candidate resume', 'started on', 'previous assessments', 'duration',
  'marks scored', 'percentage', 'result', 'report', 'certificate', 'public report',
  ...sectionHeaders(1), ...sectionHeaders(2), ...sectionHeaders(3),
  'total correct', 'total wrong', 'total unattempted',
  'marked as',
]));

/** Text that Evalground uses to mean "nothing here". */
const EMPTY_TOKENS = new Set(['', '-', '--', 'n/a', 'na', 'null', 'undefined']);

/**
 * Column headings that must never be promoted into the dossier as a "topic".
 *
 * The topic tail is discovered rather than listed — anything that is not a known
 * Evalground header is treated as a per-topic score — which is what makes the
 * parser survive a new test, and also what would carry a column called
 * "Expected CTC" or "Mobile" into a file emailed outside the company. The
 * dossier's redaction guard cannot help: it checks key names, and a topic
 * reaches the model as `{label, value}` data.
 *
 * Matched against the heading with spaces treated as underscores, so
 * "Current CTC", "current_ctc" and "CurrentCTC" all fail the same way.
 */
export const SUSPECT_TOPIC_LABEL = /(ctc|salary|compensation|package|remuneration|stipend|lpa|pay|email|e[-_ ]?mail|phone|mobile|contact|address|aadhaar|pan\b|passport|dob|birth|resume|cv\b|linkedin|url|http)/i;

/** Whether a discovered column heading is too risky to render in a pack. */
export function isSuspectTopicLabel(label) {
  return SUSPECT_TOPIC_LABEL.test(String(label ?? '').replace(/[\s_]+/g, ' '));
}

/**
 * A cell as text, with the vendor's several spellings of "empty" folded to null.
 *
 * Inner whitespace is collapsed because the export pads liberally —
 * `"  37 minutes  27 seconds "` — and that padding survives into a table cell.
 */
export function cleanText(value) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim().replace(/\s+/g, ' ');
  return EMPTY_TOKENS.has(out.toLowerCase()) ? null : out;
}

/**
 * A cell as a number, or null — never NaN, and never a 0 conjured from a blank.
 *
 * Percentages arrive as `90.49122807` and counts as strings, depending on
 * whether the file was read as CSV or XLSX; both go through Number() the same
 * way. A value that is not a number at all (a stray "Passed" in a count column)
 * is null rather than an exception: one odd cell must not fail an import.
 */
export function toNumber(value) {
  const text = cleanText(value);
  if (text === null) return null;
  const n = Number(text.replace(/[%,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * `"27 Jul  2026, 15:59"` → a Date, or null when it is anything else.
 *
 * Built in the server's own timezone rather than UTC on purpose: Evalground
 * prints a local wall-clock time with no offset, so treating it as UTC would
 * move every assessment by hours. The verbatim text is stored alongside and is
 * what the dossier actually renders; this Date exists for sorting and for
 * anyone who later wants to query by it.
 */
export function parseStartedOn(value) {
  const text = cleanText(value);
  if (!text) return null;
  const m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:,)?(?:\s+(\d{1,2}):(\d{2}))?/.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (month === -1) return null;
  const date = new Date(
    Number(m[3]), month, Number(m[1]),
    m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, 0, 0,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whether a `Public Report` URL is actually openable.
 *
 * It usually is not. Evalground truncates the column at 62 characters, cutting
 * the report id mid-way —
 * `https://evalground.com/code4/#/candidatereport/2c6f9fd3-0424-47` — in all
 * three sample exports, so what we store is a link that cannot resolve. It is
 * kept verbatim anyway (someone has to be able to see what the vendor sent), but
 * a truncated URL must never be rendered as a link: a dead link in a pack sent
 * outside the company reads as our bug, not the vendor's.
 *
 * A genuine report id is a 36-character UUID. Anything shorter is a stub.
 */
export function isUsableReportUrl(url) {
  const text = cleanText(url);
  if (!text || !/^https?:\/\//i.test(text)) return false;
  const m = /candidatereport\/([^/?#\s]+)/i.exec(text);
  if (!m) return true; // some other, unfamiliar shape — not provably truncated
  return m[1].length >= 32;
}

/**
 * Everything one export row says about one candidate.
 *
 * @param {object} row - a sheet row as `{ header: value }` (XLSX.utils.sheet_to_json)
 * @returns {null|{
 *   rawRow: object, startedOnText: string|null, startedOn: Date|null,
 *   durationText: string|null, attemptStatus: string|null, markedAs: string|null,
 *   publicReportUrl: string|null, publicReportUsable: boolean,
 *   totals: {correct: number|null, wrong: number|null, unattempted: number|null},
 *   sections: Array<object>, topics: Array<{label: string, value: *}>
 * }} null when the row carries nothing this parser recognises
 */
export function parseEvalgroundRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;

  // One pass, so a 47-column row is not scanned once per field.
  const byHeader = new Map();
  const extras = [];
  for (const [key, value] of Object.entries(row)) {
    const norm = normHeader(key);
    // XLSX names unlabelled columns __EMPTY, __EMPTY_1 … — a blank column in the
    // export is not a topic the candidate was tested on.
    if (!norm || /^__empty/i.test(norm)) continue;
    byHeader.set(norm, value);
    if (!EVALGROUND_FIXED_HEADERS.has(norm)) extras.push([String(key).trim(), value]);
  }

  const at = (header) => (byHeader.has(header) ? byHeader.get(header) : null);

  const sections = [];
  for (let n = 1; n <= 3; n += 1) {
    const entry = {
      index: n,
      marks: toNumber(at(`section ${n} marks`) ?? at(`section ${n}`)),
      correct: toNumber(at(`s${n} correct`)),
      wrong: toNumber(at(`s${n} wrong`)),
      unattempted: toNumber(at(`s${n} unattempted`)),
      easy_correct: toNumber(at(`s${n} easy correct`)),
      medium_correct: toNumber(at(`s${n} medium correct`)),
      hard_correct: toNumber(at(`s${n} hard correct`)),
      result: cleanText(at(`s${n} result`)),
    };
    // A section the test did not have is dropped; a section that exists but
    // scored zero is kept, because 0 is an answer and absence is not.
    const hasAnything = Object.entries(entry)
      .some(([key, value]) => key !== 'index' && value !== null);
    if (hasAnything) sections.push(entry);
  }

  const topics = extras
    // A column we do not recognise becomes a "topic", and topics are RENDERED
    // into a pack that goes to someone outside the company. That is safe for
    // "Sql: 6" and not at all safe for a column somebody adds to their
    // Evalground test called "Current CTC", "Mobile" or "Candidate Email" —
    // and the dossier's own guard cannot catch those, because it inspects key
    // NAMES and these arrive as {label, value} data.
    //
    // So the discovery rule keeps its "anything unrecognised" breadth for the
    // archive (rawRow keeps every column) but refuses to promote a column into
    // the pack when its heading looks like compensation, contact details or an
    // identifier. Erring toward dropping a genuine topic is the right way to be
    // wrong here: a missing score is a gap, a leaked phone number is not.
    .filter(([label]) => !isSuspectTopicLabel(label))
    .map(([label, value]) => {
      const asNumber = toNumber(value);
      return { label, value: asNumber === null ? cleanText(value) : asNumber };
    });

  const totals = {
    correct: toNumber(at('total correct')),
    wrong: toNumber(at('total wrong')),
    unattempted: toNumber(at('total unattempted')),
  };

  const startedOnText = cleanText(at('started on'));
  const durationText = cleanText(at('duration'));
  const publicReportUrl = cleanText(at('public report'));

  const detail = {
    rawRow: row,
    startedOnText,
    startedOn: parseStartedOn(startedOnText),
    durationText,
    attemptStatus: cleanText(at('report')),
    markedAs: cleanText(at('marked as')),
    publicReportUrl,
    publicReportUsable: isUsableReportUrl(publicReportUrl),
    totals,
    sections,
    topics,
  };

  // Nothing recognisable at all — a file that is not an Evalground export, or a
  // trailing blank row. Returning null keeps a half-empty "breakdown" out of the
  // database, where it would render as a table of dashes in a candidate's pack.
  // A column we do not recognise is only EVIDENCE of an Evalground row when it
  // actually carries something: any sheet at all has columns, and a file of
  // empty headers would otherwise be stored as a breakdown made entirely of
  // dashes — which is what a candidate's pack would then print.
  const foundSomething = sections.length > 0
    || topics.some((t) => t.value !== null)
    || Object.values(totals).some((v) => v !== null)
    || startedOnText !== null
    || durationText !== null;

  return foundSomething ? detail : null;
}

export default {
  EVALGROUND_FIXED_HEADERS,
  SUSPECT_TOPIC_LABEL,
  isSuspectTopicLabel,
  cleanText,
  toNumber,
  parseStartedOn,
  isUsableReportUrl,
  parseEvalgroundRow,
};
