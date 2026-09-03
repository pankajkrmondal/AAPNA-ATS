/**
 * candidateDossier.export.js — turning a dossier model into the file a recruiter
 * emails out.
 *
 * The view half of the feature; candidateDossier.service.js is the model half
 * and has already redacted everything that reaches here. Nothing in this file
 * queries the database or decides what may be shared — if a value is in the
 * model, it is shareable, and if it is not, no renderer can conjure it.
 *
 * THREE OUTPUTS, ONE PACK:
 *   Candidate-Dossier.html   the primary artefact. Self-contained.
 *   Candidate-Summary.xlsx   the same data as four sheets, for a team that works
 *                            in Excel (the Evalground sheet, the Interview
 *                            Evaluation Format).
 *   READ-ME.txt              who generated it, what was deliberately left out,
 *                            and the request to delete it.
 *
 * WHY NOT A SINGLE PDF (plan §2.1): it would need pdfkit or puppeteer — the
 * latter dragging a ~170 MB Chromium into the deploy — and still could not carry
 * a resume as a re-openable file. The HTML prints to PDF with Ctrl+P, which is
 * the same outcome for the reader and no new dependency for us. `xlsx` and
 * `adm-zip` were already in package.json.
 *
 * THE ACCEPTANCE CRITERION this file exists to satisfy (tracker row 5): the pack
 * must open outside the ATS, with no login and no internet. That is why the HTML
 * has no <img src="http…">, no CDN, no webfont and no JavaScript — see
 * renderDossierHtml. A dossier that needs our server to be up is a dossier that
 * stops working the month someone actually needs it.
 */
import AdmZip from 'adm-zip';
import XLSX from 'xlsx';

import config from '../config/index.js';
import { formatDate, formatDateTime, stringifyCell } from '../utils/csvExport.js';

/**
 * HTML-escape. Applied to EVERY interpolated value without exception.
 *
 * This is a real XSS boundary, not decoration. Resume-parsed fields and
 * interviewer free text both reach this file, both originate outside the
 * application, and the output is opened by someone we have no other channel to
 * warn — the same threat model that made csvExport.js grow its injection guard.
 * `'` is escaped as well as `"` so the helper is safe inside single-quoted
 * attributes too, rather than being safe only where it happens to be used today.
 *
 * @param {*} value
 * @returns {string}
 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/*
 * ---------------------------------------------------------------------------
 * TURNING JSON COLUMNS INTO SOMETHING A HUMAN READS
 * ---------------------------------------------------------------------------
 * rpa_cv carries several JSON columns — CurrentCompany, employment_history —
 * and stringifyCell()'s last resort for an object is JSON.stringify(). That is
 * right for a CSV, where a cell is one string and a machine may read it back;
 * it is wrong for a pack an interviewer opens, where it printed
 *
 *   Current company   {"Name":"Hexaware Technologies","Website":""}
 *
 * to a reader who has never seen a JSON document (reported from a real download,
 * 2026-09-03). Nothing in this pack may render as an object or an array literal.
 *
 * The helpers below are deliberately GENERIC rather than a special case per
 * column: the whitelist in dossierRedaction.js is what decides which fields
 * appear, and a JSON column added there next month must not be able to
 * reintroduce this bug. So they work from the shape of the value —
 *
 *   { Name: 'X', Website: '' }                  →  X          (empties dropped)
 *   { companies: [ {...}, {...} ] }             →  a table    (wrapper unwrapped)
 *   [ 'a', 'b' ]                                →  a, b
 *
 * — and humanise the keys themselves ("CompanyName" → "Company name"), because
 * a JSON key is a developer's name for a thing, not a reader's.
 */

/**
 * Plain objects only. Dates and Prisma Decimals are LEAVES: they are objects to
 * `typeof` but they have one obvious printed form, and walking their internals
 * would turn a score into a bag of implementation fields.
 */
function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Date)
    && typeof value.toFixed !== 'function';
}

/**
 * Empty all the way down — `''`, `[]`, `{}`, `{ Website: '' }`.
 *
 * Needed because "no value" arrives in as many shapes as the value itself does,
 * and a profile row that renders `Website:` with nothing after it reads as a
 * broken pack rather than as a field the candidate never filled in.
 */
function isEmptyValue(value, depth = 0) {
  if (value === null || value === undefined || value === '') return true;
  if (depth > 5) return false;
  if (Array.isArray(value)) return value.every((v) => isEmptyValue(v, depth + 1));
  if (isPlainObject(value)) {
    const vals = Object.values(value);
    return vals.length === 0 || vals.every((v) => isEmptyValue(v, depth + 1));
  }
  return false;
}

/**
 * A string that is really a record — parse it, so it can be rendered as one.
 *
 * NOT the same problem as a JSON column. rpa_cv stores some of these fields as
 * TEXT holding serialised JSON rather than as a JSON type, so `CurrentCompany`
 * reaches the renderer as the 43-character string `{"Name":"…","Website":""}`
 * while `employment_history` arrives as a parsed object. Both look identical to
 * the reader, so both have to be handled, or the fix only lands on half the
 * profile (reported from a real pack, 2026-09-03).
 *
 * Conservative on purpose: only a value that is bracketed at BOTH ends is even
 * offered to JSON.parse, and only an object or an array is accepted back. A
 * candidate whose notice period is literally "30" must not become the number 30,
 * and a scorecard remark that happens to open with a brace must survive as prose.
 * Parsing is safe here — the result is escaped like any other value on the way
 * out, and JSON.parse cannot execute anything.
 */
function coerceStructured(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!/^[[{]/.test(trimmed) || !/[\]}]$/.test(trimmed)) return value;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) || isPlainObject(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

/** `CompanyName` / `company_name` / `YearsWorked` → `Company name`, `Years worked`. */
function humanizeKey(key) {
  const words = String(key)
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : String(key);
}

/**
 * Reading order for the keys of an unknown object.
 *
 * JSON key order is whatever the parser wrote, and employment_history arrives
 * `EndDate, StartDate, CompanyName, YearsWorked` — which reads backwards. What
 * the thing IS comes first, then when it started, then when it ended.
 */
const KEY_RANK = [
  /name|title|company|employer|organi[sz]ation|institut|school|college|university|role|designation|degree/i,
  /start|from|since|joined|begin/i,
  /end|till|until|left/i,
];
const rankKey = (key) => {
  const i = KEY_RANK.findIndex((re) => re.test(key));
  return i === -1 ? KEY_RANK.length : i;
};

/** An object's non-empty entries, in reading order. Ids are plumbing, not content. */
function entriesOf(obj) {
  return Object.entries(obj)
    .filter(([k, v]) => !isEmptyValue(v) && !/^(id|_id|uuid|guid)$/i.test(k))
    .map(([k, v], i) => ({ k, v, i, r: rankKey(k) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ k, v }) => [k, v]);
}

/**
 * Drop wrapper objects that carry no information of their own.
 *
 * `employment_history` is `{ companies: [ … ] }`: the key names the container,
 * not a fact about the candidate, and rendering it as a heading called
 * "Companies" inside a row already labelled "Employment history" is noise.
 */
function unwrapContainer(value) {
  let node = value;
  for (let guard = 0; isPlainObject(node) && guard < 5; guard += 1) {
    const entries = entriesOf(node);
    if (entries.length !== 1) break;
    const [, only] = entries[0];
    if (!Array.isArray(only) && !isPlainObject(only)) break;
    node = only;
  }
  return node;
}

/**
 * Any model value as one line of plain text — for the spreadsheet, the READ-ME
 * and grid cells, none of which can carry a nested table.
 *
 * The HTML uses valueToHtml() instead, but both go through the same shape rules,
 * so an employment history cannot read one way in the report and another in the
 * workbook.
 */
function valueToText(value, depth = 0) {
  const raw = coerceStructured(value);
  if (isEmptyValue(raw)) return '';
  if (depth > 4) return stringifyCell(raw);

  const node = isPlainObject(raw) ? unwrapContainer(raw) : raw;

  if (Array.isArray(node)) {
    const items = node.filter((i) => !isEmptyValue(i));
    const parts = items.map((i) => valueToText(i, depth + 1)).filter(Boolean);
    // Scalars are a list ("Selenium, CI/CD"); records need a stronger separator
    // than the "; " already used between their own fields.
    const scalars = items.every((i) => !Array.isArray(i) && !isPlainObject(i));
    return parts.join(scalars ? ', ' : ' | ');
  }

  if (isPlainObject(node)) {
    const entries = entriesOf(node);
    // One fact left standing is that fact, not "Name: X" — the row's own label
    // ("Current company") has already said what it is.
    if (entries.length === 1) return valueToText(entries[0][1], depth + 1);
    return entries
      .map(([k, v]) => `${humanizeKey(k)}: ${valueToText(v, depth + 1)}`)
      .join('; ');
  }

  return stringifyCell(node);
}

/**
 * Display text for a model value, via the same converter the CSV exports use.
 *
 * Reused rather than reimplemented because the model carries every awkward type
 * this codebase produces — Prisma Decimal scores, Date objects, string arrays
 * (Top5KeySkills) and JSON columns (employment_history) — and two renderers
 * disagreeing about how to print an employment history is exactly the sort of
 * difference nobody notices until a candidate's dates read differently in the
 * HTML and the spreadsheet.
 *
 * Empty renders as an em dash rather than blank: "we have no value" and "this
 * row is broken" must look different to a reader.
 */
function text(value, { empty = '—' } = {}) {
  if (value === null || value === undefined || value === '') return empty;
  const out = valueToText(value);
  return out === '' ? empty : out;
}

/** `<td>` with escaped content. */
const td = (value, attrs = '') => `<td${attrs ? ` ${attrs}` : ''}>${esc(text(value))}</td>`;

/**
 * A section wrapper that renders "No records" rather than vanishing.
 *
 * An interviewer must be able to tell "there were no scorecards" from "the
 * dossier forgot to include them" (plan §3.1). A section that disappears when
 * empty makes those two indistinguishable, and the reader will assume whichever
 * suits them. The Scorecard Report modal already guards against exactly this.
 *
 * @param {number} n - section number, as printed
 * @param {string} title
 * @param {string} body - pre-escaped HTML, or '' for none
 * @param {string} [emptyNote] - what "none" means here, in the reader's terms
 */
function section(n, title, body, emptyNote = 'No records.') {
  const content = body && body.trim() ? body : `<p class="empty">${esc(emptyNote)}</p>`;
  return `<section><h2><span class="num">${n}</span>${esc(title)}</h2>${content}</section>`;
}

/** A two-column label/value table from [{label, value}] rows. */
function fieldTable(rows) {
  if (!rows.length) return '';
  return `<table class="fields"><tbody>${rows
    .map((r) => `<tr><th>${esc(r.label)}</th><td>${valueToHtml(r.value)}</td></tr>`)
    .join('')}</tbody></table>`;
}

/**
 * The union of the keys across a list of records, in reading order.
 *
 * A list of records renders as a table, and a table needs one column set. Rows
 * from a resume parser are not always uniform — one job carries YearsWorked and
 * the next does not — so the columns are the union, and a record missing a key
 * gets an empty cell rather than the list falling back to prose.
 */
function unionKeys(records) {
  const order = new Map();
  for (const record of records) {
    for (const [k] of entriesOf(record)) if (!order.has(k)) order.set(k, order.size);
  }
  return [...order.keys()].sort((a, b) => rankKey(a) - rankKey(b) || order.get(a) - order.get(b));
}

/**
 * Any model value as HTML the reader can parse at a glance.
 *
 * Three shapes, three presentations, chosen because they are what the data
 * actually is rather than what it is stored as:
 *
 *   a list of records  → a small table, one column per field
 *   a record           → labelled lines
 *   anything else      → text
 *
 * Everything that reaches an attribute or a text node goes through esc() — this
 * function walks candidate-supplied, resume-parsed JSON, which is the least
 * trusted input in the system (see esc's own note).
 *
 * @param {*} value
 * @param {number} [depth] - recursion guard; deep values fall back to one line
 * @returns {string} HTML, never empty ('—' when there is nothing to show)
 */
function valueToHtml(value, depth = 0) {
  const raw = coerceStructured(value);
  if (isEmptyValue(raw)) return '—';
  if (depth > 3) return esc(text(raw));

  const node = isPlainObject(raw) ? unwrapContainer(raw) : raw;

  if (Array.isArray(node)) {
    const items = node.filter((i) => !isEmptyValue(i));
    if (!items.length) return '—';
    if (items.every((i) => !Array.isArray(i) && !isPlainObject(i))) {
      return esc(items.map((i) => valueToText(i)).filter(Boolean).join(', '));
    }
    if (items.every(isPlainObject)) {
      const keys = unionKeys(items);
      if (keys.length) {
        return dataTable(keys.map(humanizeKey), items.map((r) => keys.map((k) => r[k])));
      }
    }
    return `<ul>${items.map((i) => `<li>${valueToHtml(i, depth + 1)}</li>`).join('')}</ul>`;
  }

  if (isPlainObject(node)) {
    const entries = entriesOf(node);
    if (!entries.length) return '—';
    // The row's own label has already named the thing, so a lone remaining fact
    // is printed bare: "Current company → Hexaware Technologies", not
    // "Current company → Name: Hexaware Technologies".
    if (entries.length === 1) return valueToHtml(entries[0][1], depth + 1);
    return `<ul class="kv">${entries
      .map(([k, v]) => `<li><span class="k">${esc(humanizeKey(k))}</span>${valueToHtml(v, depth + 1)}</li>`)
      .join('')}</ul>`;
  }

  return esc(text(node));
}

/** A data table from a header list and row arrays. */
function dataTable(headers, rows) {
  if (!rows.length) return '';
  return '<div class="scroll"><table class="grid"><thead><tr>'
    + headers.map((h) => `<th>${esc(h)}</th>`).join('')
    + '</tr></thead><tbody>'
    + rows.map((cells) => `<tr>${cells.map((c) => td(c)).join('')}</tr>`).join('')
    + '</tbody></table></div>';
}

/**
 * The stylesheet, inline.
 *
 * No webfont: a system font stack renders identically offline, and a Google
 * Fonts link would break the "no internet" acceptance test while looking fine on
 * every machine we tested it on. The brand mark is set in type for the same
 * reason — the company logo is a remote PNG in the email layout
 * (emailLayout.service.js:37) and embedding a base64 copy here would add weight
 * to every pack for no gain the reader can perceive.
 *
 * @media print exists because Ctrl+P is the documented way to get a PDF out of
 * this file: it drops the page furniture, forces sensible page breaks between
 * sections, and prevents a scorecard table splitting across two pages.
 */
const STYLES = `
:root{--ink:#1b2430;--muted:#5b6875;--line:#dfe4ea;--band:#0f4c3a;--warn:#8a5300;--bg:#fff}
*{box-sizing:border-box}
body{margin:0;background:#f4f6f8;color:var(--ink);
  font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.page{max-width:920px;margin:0 auto;background:var(--bg);padding:0 0 48px}
header.band{background:var(--band);color:#fff;padding:28px 36px}
.mark{font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;margin-bottom:14px}
header.band h1{margin:0 0 4px;font-size:26px;line-height:1.2}
header.band .role{font-size:15px;opacity:.92}
header.band .meta{margin-top:14px;font-size:12px;opacity:.85;line-height:1.7}
.confidential{background:#fdf3d7;border-bottom:1px solid #e8d9a8;color:var(--warn);
  padding:12px 36px;font-size:12.5px;font-weight:600}
.status{padding:16px 36px;border-bottom:1px solid var(--line);font-size:14px}
.status.closed{background:#fdecec;color:#8a1f1f;font-weight:600}
.status.paused{background:#fdf3d7;color:var(--warn);font-weight:600}
section{padding:26px 36px;border-bottom:1px solid var(--line)}
section:last-of-type{border-bottom:0}
h2{font-size:15px;margin:0 0 16px;text-transform:uppercase;letter-spacing:.06em;color:var(--band)}
h2 .num{display:inline-block;min-width:26px;height:22px;line-height:22px;text-align:center;
  background:var(--band);color:#fff;border-radius:3px;margin-right:10px;font-size:12px}
h3{font-size:14px;margin:22px 0 8px}
p{margin:0 0 10px}
ul{margin:0 0 12px;padding-left:20px}
li{margin-bottom:4px}
.empty{color:var(--muted);font-style:italic}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%}
table.fields th{width:34%;text-align:left;vertical-align:top;padding:7px 12px 7px 0;
  color:var(--muted);font-weight:600}
table.fields td{padding:7px 0;vertical-align:top}
table.grid{font-size:13px;margin-bottom:6px}
table.grid th{text-align:left;background:#eef1f4;padding:8px 10px;border:1px solid var(--line);white-space:nowrap}
table.grid td{padding:8px 10px;border:1px solid var(--line);vertical-align:top}
table.fields td .scroll{margin:2px 0 0}
table.fields td table.grid{margin-bottom:0;font-size:12.5px}
ul.kv{margin:0;padding:0;list-style:none}
ul.kv li{margin-bottom:3px}
ul.kv .k{color:var(--muted);font-weight:600;margin-right:6px}
.card{border:1px solid var(--line);border-radius:5px;padding:16px 18px;margin-bottom:16px}
.card h3{margin-top:0}
.tags{color:var(--muted);font-size:12.5px;margin-bottom:10px}
.tags b{color:var(--ink)}
.quote{background:#f7f9fa;border-left:3px solid var(--band);padding:12px 16px;margin:0 0 14px;
  white-space:pre-wrap}
.note{color:var(--muted);font-size:12.5px}
.linkbox{border:1px solid #cfe3d8;border-left:4px solid var(--band);background:#f2f8f5;
  border-radius:5px;padding:14px 18px;margin:16px 0 6px}
.linkbox .linktitle{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:var(--band);margin:0 0 10px}
a.reportlink{display:inline-block;background:var(--band);color:#fff;font-weight:700;font-size:13.5px;
  text-decoration:none;padding:8px 18px;border-radius:4px;margin:0 8px 6px 0;letter-spacing:.02em;
  border:1px solid var(--band)}
a.reportlink:hover{background:#0b3a2c;border-color:#0b3a2c}
.linkbox .note{margin-bottom:0}
footer{padding:24px 36px;color:var(--muted);font-size:12px;line-height:1.7}
@media print{
  body{background:#fff}
  .page{max-width:none}
  section{page-break-inside:auto;border-bottom:0;padding:18px 0}
  .card,table.grid tr,.linkbox{page-break-inside:avoid}
  h2{page-break-after:avoid}
  header.band{color:#000;background:#fff;border-bottom:3px solid #000;padding:0 0 14px}
  .confidential,.status{padding-left:0;padding-right:0}
  /* Printers drop background colours by default, which would leave the report
     button as invisible white-on-white. Ink, not fill, on paper. */
  a.reportlink{background:#fff;color:var(--band);border:1.5px solid var(--band)}
  footer{padding-left:0;padding-right:0}
}
`;

/**
 * Render the self-contained HTML dossier.
 *
 * @param {object} model - from buildDossierModel()
 * @returns {string} a complete HTML document
 */
export function renderDossierHtml(model) {
  const { candidate, generated, status } = model;
  const days = config.dossier.deletionDays;

  // ---- 4. Progress so far --------------------------------------------------
  const stagesHtml = dataTable(
    ['Stage', 'What happened', 'Outcome', 'Reason', 'Decided by', 'When'],
    model.stages.map((s) => [
      s.stage_label,
      s.event_type === 'note' ? 'Note' : s.event_type,
      s.outcome,
      s.reason || s.notes,
      s.decided_by,
      formatDateTime(s.decided_at),
    ]),
  );

  // ---- 6. Per-round scorecards --------------------------------------------
  const scorecardsHtml = model.scorecards.map((c) => {
    const tags = [
      c.recommendation ? `<b>Recommendation:</b> ${esc(c.recommendation)}` : null,
      c.avg_score !== null ? `<b>Average score:</b> ${esc(c.avg_score)}` : null,
      c.final_rating !== null ? `<b>Overall rating:</b> ${esc(c.final_rating)}` : null,
      c.submitted_at ? `<b>Submitted:</b> ${esc(formatDate(c.submitted_at))}` : null,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');

    const skills = dataTable(
      ['Skill', 'Rating', 'Interviewer remark'],
      c.skills.map((s) => [s.label, s.rating, s.remark]),
    );

    const hr = c.hr_round
      ? fieldTable([
        { label: 'Strengths', value: c.hr_round.strengths },
        { label: 'Areas of concern', value: c.hr_round.weakness },
        { label: 'Communication', value: c.hr_round.communication_comments },
        { label: 'Attitude', value: c.hr_round.attitude_comments },
        { label: 'Relocation', value: c.hr_round.relocation },
        { label: 'Notice period', value: c.hr_round.notice_period },
        { label: 'Other observations', value: c.hr_round.other_observation },
        { label: 'Final feedback', value: c.hr_round.final_feedback },
      ])
      : '';

    return '<div class="card">'
      + `<h3>${esc(c.stage_label)}${c.interviewer ? ` — ${esc(c.interviewer)}` : ''}</h3>`
      + (tags ? `<div class="tags">${tags}</div>` : '')
      + skills
      + (c.comments ? `<div class="quote">${esc(c.comments)}</div>` : '')
      + hr
      + '</div>';
  }).join('');

  // Rounds still owed a scorecard. Stated rather than omitted, so "no feedback
  // yet" is never mistaken for "feedback was withheld".
  const pendingHtml = model.scorecards_pending.length
    ? `<p class="note">Still awaited: ${esc(model.scorecards_pending
      .map((p) => `${p.stage_label}${p.interviewer ? ` (${p.interviewer})` : ''}`)
      .join(', '))}.</p>`
    : '';

  // ---- 7. Screening and assessment scores ----------------------------------
  const zekoHtml = dataTable(
    ['Round', 'Overall', 'Technical', 'Communication', 'Taken on'],
    model.zeko.map((z) => [
      z.round, z.overall_score, z.technical_score, z.communication_score, formatDate(z.taken_at),
    ]),
  );

  // The screening assessment itself, rendered into the pack (plan §6.7).
  //
  // This is the alternative to sending the reader off to the vendor's own page:
  // the same assessment, with compensation removed by buildZekoReportSection(),
  // in a file that works offline and cannot be withdrawn from under them. What
  // was withheld is stated rather than silently applied — a reader comparing
  // this against a Zeko screenshot must be able to tell that something was
  // removed on purpose, not conclude the ATS renders reports badly.
  const zekoDetailHtml = model.zeko
    .filter((z) => z.report_detail)
    .map((z) => {
      const d = z.report_detail;
      const tags = [
        d.verdict ? `<b>Verdict:</b> ${esc(d.verdict)}` : null,
        d.fit_percentage !== null && d.fit_percentage !== undefined
          ? `<b>Fit:</b> ${esc(d.fit_percentage)}%` : null,
        d.parameters_total
          ? `<b>Requirements met:</b> ${esc(d.parameters_met)} of ${esc(d.parameters_total)}` : null,
        d.red_flag_count !== null && d.red_flag_count !== undefined
          ? `<b>Red flags:</b> ${esc(d.red_flag_count)}` : null,
      ].filter(Boolean).join(' &nbsp;·&nbsp; ');

      // text() rather than esc() alone: the vendor's arrays are not guaranteed to
      // hold strings, and one object in a summary list would print as JSON.
      const list = (title, items) => (items && items.length
        ? `<h3>${esc(title)}</h3><ul>${items.map((i) => `<li>${esc(text(i, { empty: '' }))}</li>`).join('')}</ul>`
        : '');

      return '<div class="card">'
        + `<h3>${esc(z.round)}${d.round_name ? ` — ${esc(d.round_name)}` : ''}</h3>`
        + (tags ? `<div class="tags">${tags}</div>` : '')
        + list('Summary', d.summary)
        + list('Red flags', d.red_flags)
        + dataTable(
          ['Requirement', 'Met?', 'What the candidate said', 'Assessment'],
          d.parameters.map((p) => [
            `${p.name}${p.required ? ' (must-have)' : ''}`,
            p.met ? 'Yes' : 'No',
            p.answer,
            p.remark,
          ]),
        )
        + list('Strengths', d.strengths)
        + list('Areas of concern', d.concerns)
        + list('Recommendation', d.recommendation)
        + list('Suggested development', d.improvements)
        + (d.soft_skills?.length
          ? `<h3>Communication and thinking</h3>${dataTable(
            ['Area', 'Rating', 'Assessment'],
            // "Not assessed" rather than a dash or a rating: the screening AI
            // stamps "weak" on skills it never got the chance to observe, and
            // passing that on would misrepresent a real candidate to someone
            // about to interview them.
            d.soft_skills.map((s) => [
              s.area,
              s.assessed ? s.rating : 'Not assessed in this interview',
              s.comment,
            ]),
          )}`
          : '')
        + (d.withheld_count
          ? `<p class="note">${esc(d.withheld_count)} item(s) from this report were removed before `
            + 'it was included here, because they concerned compensation.</p>'
          : '')
        + '</div>';
    }).join('');

  // The full screening report, as a link rather than a column: the URL is long,
  // it would wreck the table on paper, and it needs a sentence of its own
  // explaining that it opens without a login — which is both its whole value to
  // the reader and the reason they should not forward it on.
  //
  // A hyperlink is not an external RESOURCE: nothing is fetched when the file is
  // opened, so the pack still renders complete on a machine with no network
  // (tracker row 5). It simply does nothing until the reader clicks it.
  //
  // It is rendered as a BUTTON rather than an inline word. In the first packs it
  // was a plain underlined round name inside a grey footnote, and readers
  // scrolled straight past the one thing in section 6 they were meant to click.
  const zekoLinked = model.zeko.filter((z) => z.report_link);
  const zekoLinksHtml = zekoLinked.length
    ? '<div class="linkbox"><p class="linktitle">Full screening report</p><p>'
      + zekoLinked
        // target=_blank so the dossier itself is never navigated away from — the
        // reader is mid-way through a pack they cannot get back to by pressing
        // Back on a file:// URL from a ZIP they may have opened from a temp
        // folder. rel closes the two holes target=_blank opens: window.opener
        // access from the vendor's page, and the referrer.
        .map((z) => `<a href="${esc(z.report_link)}" class="reportlink" `
          + 'target="_blank" rel="noopener noreferrer">'
          + `Open the ${esc(z.round)} report &rarr;</a>`)
        .join('')
      + '</p><p class="note">Opens in a browser with no login, so please treat '
      + (zekoLinked.length > 1 ? 'these links' : 'this link')
      + ' as confidential and do not forward '
      + (zekoLinked.length > 1 ? 'them' : 'it')
      + '.</p></div>'
    : '';

  const assessmentHtml = model.assessments.map((a) => {
    const rows = a.sections.map((s) => [s.label, s.score]);
    if (a.overall_percentage !== null) rows.push(['Overall', `${a.overall_percentage}%`]);
    if (a.result) rows.push(['Result', a.result]);
    return `<h3>${esc(a.test_name)}</h3>${dataTable(['Section', 'Score'], rows)}`;
  }).join('');

  // ---- 8/9. Interviews and recordings --------------------------------------
  const interviewsHtml = dataTable(
    ['Round', 'Interviewer', 'Scheduled', 'Did it happen?'],
    model.interviews.map((i) => [
      i.stage_label,
      i.interviewer,
      formatDateTime(i.scheduled_start_at),
      // Null is a genuine third state — nobody has confirmed either way — and
      // must not be printed as "did not happen".
      i.occurrence === 'held' ? 'Yes' : i.occurrence === 'no_show' ? `No-show (${i.no_show_party || 'unrecorded'})` : 'Not confirmed',
    ]),
  );

  const recordingsHtml = dataTable(
    ['Round', 'Recorded on', 'Length', 'How to watch'],
    model.recordings.map((r) => [
      r.stage_label,
      formatDateTime(r.recorded_start_at),
      r.duration_seconds !== null ? `${Math.round(r.duration_seconds / 60)} min` : null,
      'Ask the recruiter',
    ]),
  );

  const manifestHtml = dataTable(
    ['Item', 'In this pack?', 'Note'],
    model.manifest.map((m) => [m.item, m.included ? 'Yes' : 'No', m.note]),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Every link in this pack opens in a new tab, including any added later: a
     reader who follows one and loses the dossier behind it often cannot get it
     back, because the file was opened from a ZIP in a temp folder. No href, so
     this changes only the target and not how anything resolves. -->
<base target="_blank">
<title>Candidate dossier — ${esc(candidate.name)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">

<header class="band">
  <div class="mark">AAPNA Infotech · Candidate dossier</div>
  <h1>${esc(candidate.name)}</h1>
  <div class="role">${esc(text(candidate.position, { empty: 'Position not recorded' }))}</div>
  <div class="meta">
    ${candidate.mrf_ref ? `Requisition: ${esc(candidate.mrf_ref)}<br>` : ''}
    Prepared by ${esc(generated.by)} on ${esc(formatDateTime(generated.at))}
  </div>
</header>

<div class="confidential">
  CONFIDENTIAL — prepared for a named interviewer. Please do not forward this pack, and delete it
  within ${esc(days)} days of the interview.
</div>

<div class="status${status.closed ? ' closed' : status.state === 'paused' ? ' paused' : ''}">
  ${esc(status.headline)}
</div>

${section(1, 'Candidate profile', fieldTable(model.profile), 'No candidate profile is on file.')}

${section(2, 'The position', fieldTable(model.position), 'No requisition details are on file.')}

${section(3, 'Progress so far', stagesHtml, 'No decisions have been recorded on this application yet.')}

${section(4, 'Consolidated interviewer feedback',
    model.consolidated_feedback ? `<div class="quote">${esc(model.consolidated_feedback)}</div>` : '',
    'No interviewer has submitted a scorecard yet, so there is nothing to consolidate.')}

${section(5, 'Interviewer scorecards', scorecardsHtml + pendingHtml,
    'No scorecards have been submitted for this candidate.')}

${section(6, 'AI screening', zekoHtml + zekoDetailHtml + zekoLinksHtml,
    'No AI screening round has been completed for this candidate.')}

${section(7, 'Assessment results', assessmentHtml,
    'No written assessment result has been recorded for this candidate.')}

${section(8, 'Interview history', interviewsHtml,
    'No interviews have been booked for this candidate.')}

${section(9, 'Interview recordings', recordingsHtml,
    'No interview recordings exist for this candidate.')}

${section(10, 'What is in this pack', manifestHtml)}

<footer>
  <p><b>What has been removed from this pack, deliberately:</b></p>
  <p>${model.redaction.map((r) => esc(r)).join('<br>')}</p>
  <p>Generated from the AAPNA Infotech ATS on ${esc(formatDateTime(generated.at))} by
  ${esc(generated.by)}. This download has been recorded against their name.</p>
</footer>

</div>
</body>
</html>`;
}

/**
 * Render the XLSX summary.
 *
 * Sheet 1 is TRANSPOSED — Section | Field | Value, one row per field — for the
 * reason mrfDetail.export.js documents at length: a single-row sheet carrying
 * this many fields is unreadable, because you scroll sideways forever to find
 * one value. The other three sheets are genuinely list-shaped and stay that way.
 *
 * @param {object} model
 * @returns {Buffer}
 */
export function renderDossierWorkbook(model) {
  const book = XLSX.utils.book_new();
  // valueToText, not stringifyCell: the spreadsheet is offered as a format in its
  // own right ("Spreadsheet only"), so a JSON blob is no more acceptable in a
  // cell than it is in the report.
  const cell = (v) => (v === null || v === undefined ? '' : valueToText(v));

  // --- Sheet 1: Summary (transposed) ---------------------------------------
  const summary = [['Section', 'Field', 'Value']];
  summary.push(['Dossier', 'Candidate', cell(model.candidate.name)]);
  summary.push(['Dossier', 'Position', cell(model.candidate.position)]);
  summary.push(['Dossier', 'Requisition', cell(model.candidate.mrf_ref)]);
  summary.push(['Dossier', 'Prepared by', cell(model.generated.by)]);
  summary.push(['Dossier', 'Prepared on', formatDateTime(model.generated.at)]);
  summary.push(['Dossier', 'Application status', cell(model.status.headline)]);
  for (const f of model.profile) summary.push(['Candidate profile', f.label, cell(f.value)]);
  for (const f of model.position) summary.push(['Position', f.label, cell(f.value)]);
  if (model.scorecard_overall) {
    summary.push(['Scores', 'Rounds scored', cell(model.scorecard_overall.rounds_scored)]);
    summary.push(['Scores', 'Average score', cell(model.scorecard_overall.average)]);
    summary.push(['Scores', 'Scorecards outstanding', cell(model.scorecard_overall.outstanding)]);
  }
  if (model.consolidated_feedback) {
    summary.push(['Feedback', 'Consolidated interviewer feedback', model.consolidated_feedback]);
  }
  for (const r of model.redaction) summary.push(['Removed from this pack', r, '']);

  const s1 = XLSX.utils.aoa_to_sheet(summary);
  s1['!cols'] = [{ wch: 24 }, { wch: 34 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(book, s1, 'Summary');

  // --- Sheet 2: Scorecards (one row per round × skill) ----------------------
  const cards = [['Round', 'Interviewer', 'Recommendation', 'Average score', 'Skill', 'Rating', 'Remark']];
  for (const c of model.scorecards) {
    if (!c.skills.length) {
      cards.push([c.stage_label, cell(c.interviewer), cell(c.recommendation), cell(c.avg_score), '', '', '']);
      continue;
    }
    for (const s of c.skills) {
      cards.push([
        c.stage_label, cell(c.interviewer), cell(c.recommendation), cell(c.avg_score),
        cell(s.label), cell(s.rating), cell(s.remark),
      ]);
    }
  }
  const s2 = XLSX.utils.aoa_to_sheet(cards);
  s2['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 16 }, { wch: 13 }, { wch: 24 }, { wch: 8 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(book, s2, 'Scorecards');

  // --- Sheet 3: Stage history ----------------------------------------------
  const stages = [['Stage', 'Event', 'Outcome', 'Reason / note', 'Decided by', 'When']];
  for (const s of model.stages) {
    stages.push([
      s.stage_label, s.event_type, cell(s.outcome), cell(s.reason || s.notes),
      cell(s.decided_by), formatDateTime(s.decided_at),
    ]);
  }
  const s3 = XLSX.utils.aoa_to_sheet(stages);
  s3['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 46 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(book, s3, 'Stage History');

  // --- Sheet 4: Assessments (Zeko + Evalground together) --------------------
  const assess = [['Source', 'Test / round', 'Item', 'Score']];
  for (const z of model.zeko) {
    assess.push(['AI screening', z.round, 'Overall', cell(z.overall_score)]);
    assess.push(['AI screening', z.round, 'Technical', cell(z.technical_score)]);
    assess.push(['AI screening', z.round, 'Communication', cell(z.communication_score)]);
    // Carried in the spreadsheet too: "Spreadsheet only" is one of the three
    // formats, and a recruiter who picks it should not silently lose either the
    // assessment or the link to the full report.
    const d = z.report_detail;
    if (d) {
      if (d.verdict) assess.push(['AI screening', z.round, 'Verdict', cell(d.verdict)]);
      if (d.parameters_total) {
        assess.push(['AI screening', z.round, 'Requirements met', `${d.parameters_met} of ${d.parameters_total}`]);
      }
      for (const p of d.parameters) {
        assess.push([
          'AI screening', z.round,
          `Requirement — ${p.name}${p.required ? ' (must-have)' : ''}`,
          `${p.met ? 'Met' : 'Not met'}${p.answer ? ` — ${p.answer}` : ''}`,
        ]);
      }
      for (const s of d.soft_skills) {
        assess.push([
          'AI screening', z.round, `Communication — ${s.area}`,
          s.assessed ? cell(s.rating) : 'Not assessed',
        ]);
      }
    }
    if (z.report_link) {
      assess.push(['AI screening', z.round, 'Full report link (opens with no login)', z.report_link]);
    }
  }
  for (const a of model.assessments) {
    for (const s of a.sections) assess.push(['Assessment', a.test_name, cell(s.label), cell(s.score)]);
    if (a.overall_percentage !== null) {
      assess.push(['Assessment', a.test_name, 'Overall %', cell(a.overall_percentage)]);
    }
    if (a.result) assess.push(['Assessment', a.test_name, 'Result', cell(a.result)]);
  }
  const s4 = XLSX.utils.aoa_to_sheet(assess);
  s4['!cols'] = [{ wch: 16 }, { wch: 30 }, { wch: 26 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(book, s4, 'Assessments');

  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * The plain-text note that opens the pack.
 *
 * Deliberately the first thing in the ZIP and deliberately not HTML: it must be
 * readable by someone who unzips the folder and looks at it in Notepad without
 * opening anything else. It carries the only control that exists once the file
 * has been sent — the request to delete it — which is why HR were asked to
 * approve it (decision #12) rather than it being added as a nicety.
 *
 * @param {object} model
 * @returns {string}
 */
export function renderReadMe(model) {
  const days = config.dossier.deletionDays;
  const lines = [
    'CANDIDATE DOSSIER — CONFIDENTIAL',
    '================================',
    '',
    `Candidate : ${text(model.candidate.name)}`,
    `Position  : ${text(model.candidate.position)}`,
    `Prepared  : ${formatDateTime(model.generated.at)} by ${text(model.generated.by)}`,
    '',
    'WHAT IS IN THIS FOLDER',
    '----------------------',
    'Candidate-Dossier.html   Open this first. It works in any web browser, with no',
    '                         login and no internet connection. Press Ctrl+P to save',
    '                         it as a PDF.',
    'Candidate-Summary.xlsx   The same information as a spreadsheet (4 sheets).',
    ...(model.zeko?.some((z) => z.report_detail)
      ? [
        '',
        'Section 6 of the report sets out the AI screening assessment in full,',
        'with compensation details removed.',
      ]
      : []),
    ...(model.zeko?.some((z) => z.report_link)
      ? [
        '',
        'The report also carries a link to the full AI screening report. That link',
        'opens in a browser WITHOUT a login, so anyone you forward it to can read the',
        'screening report in full. Please treat it as confidential.',
      ]
      : []),
    '',
    'WHAT HAS BEEN REMOVED, DELIBERATELY',
    '-----------------------------------',
    ...model.redaction.map((r) => `  - ${r}`),
    '',
    'WHAT IS NOT INCLUDED IN THIS VERSION',
    '------------------------------------',
    ...model.manifest.filter((m) => !m.included).map((m) => `  - ${m.item}: ${m.note}`),
    '',
    'PLEASE',
    '------',
    'This pack contains personal information about a real person who applied for a',
    'job with us. Please do not forward it, and please delete it (and any copies)',
    `within ${days} days of completing the interview.`,
    '',
    'This download has been recorded in the ATS against the name of the person who',
    'generated it. If you have questions about the candidate, or need the resume or',
    'a recording, please reply to the recruiter who sent you this pack.',
    '',
  ];
  return lines.join('\r\n');
}

/**
 * Filename for the pack.
 *
 * Named after the candidate and the role rather than an id, because it lands in
 * an inbox alongside other attachments and "dossier.zip" is unfindable a week
 * later. Non-ASCII and path characters are stripped: this string becomes a
 * filename on someone else's machine, on an operating system we do not know.
 *
 * @param {object} model
 * @param {string} ext - 'zip' | 'html' | 'xlsx'
 * @returns {string}
 */
export function dossierFilename(model, ext) {
  const slug = (s) => String(s || '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const stamp = formatDateTime(model.generated.at).replace(/[: ]/g, '-');
  const parts = ['AAPNA-ATS_Dossier', slug(model.candidate.name)];
  if (model.candidate.position) parts.push(slug(model.candidate.position));
  return `${parts.filter(Boolean).join('_')}_${stamp}.${ext}`;
}

/**
 * Build the ZIP.
 *
 * @param {object} model
 * @param {Array<{name: string, buffer: Buffer}>} [attachments] - files already
 *   fetched by collectAttachments(); their names carry the `attachments/` prefix
 *   so the ZIP's folder structure comes from one place.
 * @returns {Buffer}
 */
export function packDossierZip(model, attachments = []) {
  const zip = new AdmZip();
  zip.addFile('READ-ME.txt', Buffer.from(renderReadMe(model), 'utf8'));
  zip.addFile('Candidate-Dossier.html', Buffer.from(renderDossierHtml(model), 'utf8'));
  zip.addFile('Candidate-Summary.xlsx', renderDossierWorkbook(model));
  for (const file of attachments) zip.addFile(file.name, file.buffer);
  return zip.toBuffer();
}

/** Content types by format. */
const CONTENT_TYPE = {
  zip: 'application/zip',
  html: 'text/html; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Build the pack in the requested format and hand back bytes plus a filename.
 *
 * Attachments only exist in the ZIP. Choosing "Report only" or "Spreadsheet
 * only" is choosing a single file, so a resume has nowhere to go — the manifest
 * inside the report still names it, which is why that choice stays honest rather
 * than silently dropping something the recruiter asked for.
 *
 * @param {object} model
 * @param {'zip'|'html'|'xlsx'} format
 * @param {Array<{name: string, buffer: Buffer}>} [attachments]
 * @returns {{ buffer: Buffer, filename: string, contentType: string }}
 */
export function buildPack(model, format = 'zip', attachments = []) {
  const fmt = CONTENT_TYPE[format] ? format : 'zip';
  const buffer = fmt === 'html' ? Buffer.from(renderDossierHtml(model), 'utf8')
    : fmt === 'xlsx' ? renderDossierWorkbook(model)
      : packDossierZip(model, attachments);
  return { buffer, filename: dossierFilename(model, fmt), contentType: CONTENT_TYPE[fmt] };
}

/**
 * Send the pack as a download.
 *
 * A sibling of sendCsv() (csvExport.js:226) and buffered for the same reason,
 * which matters MORE here than it does there: catchAsync hands a mid-request
 * throw to errorHandler, which calls res.status().json(). Bytes already on the
 * wire would leave the recipient with a truncated ZIP — and a truncated ZIP
 * still opens, showing some of the files and silently missing others. In a file
 * whose entire purpose is completeness, that is the worst available failure.
 *
 * Content-Length is deliberately not set: compression() rewrites the body.
 *
 * @param {import('express').Response} res
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} contentType
 * @param {Record<string, string|number>} [extraHeaders]
 */
export function sendPack(res, buffer, filename, contentType, extraHeaders = {}) {
  // Legacy `filename=` must be ASCII; `filename*=` carries the real one.
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');

  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v !== undefined && v !== null) res.setHeader(k, String(v));
  }

  return res.status(200).end(buffer);
}

export default {
  renderDossierHtml,
  renderDossierWorkbook,
  renderReadMe,
  packDossierZip,
  dossierFilename,
  buildPack,
  sendPack,
  esc,
};
