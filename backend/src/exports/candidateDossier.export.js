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
 *   READ-ME.txt              who generated it, what this version does not
 *                            include, and the request to delete it.
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
import {
  EXPORT_TIMEZONE, formatDate, formatDateTime, stringifyCell,
} from '../utils/csvExport.js';
import { toFieldValueAoa } from '../utils/fieldValueExport.js';
import {
  collectConcerns, entryTone, feedbackItems, itemLine, journeyStrip, journeySummary, noteInterviewer, noteItemText,
  panelJourney, parseRoundNote, verdictOf,
} from '../utils/panelFeedback.js';
import { AAPNA_MARK_DATA_URI } from './aapnaMark.js';

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

/** What an empty section says — a fact, not an explanation. */
const EMPTY = {
  profile: 'No profile on file.',
  position: 'No requisition details on file.',
  progress: 'No decisions yet.',
  feedback: 'No feedback yet.',
  scorecards: 'No scorecards submitted.',
  screening: 'No AI screening completed.',
  assessment: 'No assessment results.',
  interviews: 'No interviews booked.',
  recordings: 'No recordings.',
};

/** How an event type reads to a person ("note" is "Note", "moved" is "Moved"…). */
function eventLabel(type) {
  const t = String(type || '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : '';
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
        // One card per record, not a grid (L12): employment history and the
        // like are read one entry at a time.
        return recordList(items.map((r) => ({
          rows: keys.map((k) => ({ label: humanizeKey(k), value: r[k] })),
        })));
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

/**
 * Records read top to bottom (L12): one small card per record, each a list of
 * label / value lines, instead of a grid that runs off the page. Rows with no
 * value are left out so a card shows what is known; a record with nothing at
 * all still shows its title.
 *
 * @param {Array<{title?: string, rows: Array<{label: string, value: *}>}>} records
 * @returns {string} HTML ('' for no records)
 */
function recordList(records) {
  if (!records.length) return '';
  return records.map((r) => {
    const rows = (r.rows || []).filter((row) => !isEmptyValue(coerceStructured(row.value)));
    return '<div class="rec">'
      + (r.title ? `<h4>${esc(r.title)}</h4>` : '')
      + fieldTable(rows)
      + '</div>';
  }).join('');
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
 * The AAPNA design tokens, shared by the download's stylesheet and the panel
 * cuts' (PANEL_STYLES): frontend/src/theme/themeConfig.js and the branded
 * email's BRAND (emailLayout.service.js). One set, so the two can't drift.
 */
const AAPNA_TOKENS = `:root{--ac:#7a922e;--acd:#5a6e1f;--tint:#eef3da;--tint2:#f6f9eb;--tintln:#dbe5bd;--canvas:#f7f6f3;
  --tx:#2b2b2b;--tx2:#5f6664;--ln:#dde1df;--ln2:#eaebe8;
  --ok:#4a7c59;--okbg:#e7f1ea;--hold:#8a6400;--holddot:#c99a1c;--holdbg:#fbf1d3;--bad:#c0392b;--badbg:#fbeae8;--badln:#f0c4be}`;

/**
 * The stylesheet, inline.
 *
 * No webfont: the font stack names Inter (the ATS app's font) first and falls
 * back to system fonts, so the file renders offline; a Google Fonts link would
 * break the "no internet" acceptance test while looking fine on every machine
 * we tested it on. The AAPNA mark is embedded (exports/aapnaMark.js, 8 KB as
 * base64) rather than linked, for the same reason: the email layout's logo is
 * a remote PNG (emailLayout.service.js).
 *
 * U03d (18 Nov): the AAPNA look of the panel cuts (olive tokens, a white page
 * on the canvas, numbered olive headings, rounded records), for the download's
 * own nine sections and every record in them. Only the look changed.
 *
 * @media print exists because Ctrl+P is the documented way to get a PDF out of
 * this file: it drops the page furniture, forces sensible page breaks between
 * sections, and prevents a scorecard table splitting across two pages.
 */
const STYLES = `
${AAPNA_TOKENS}
*{box-sizing:border-box}
body{margin:0;padding:22px;background:var(--canvas);color:var(--tx);font:14px/1.6 Inter,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.page{max-width:920px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border-top:6px solid var(--ac);
  box-shadow:0 1px 3px rgba(16,24,20,.06),0 10px 28px rgba(16,24,20,.08);padding:0 0 12px}
header.band{background:#fff;color:var(--tx);padding:20px 36px 18px}
.mark{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.mark img{width:34px;height:34px;display:block}
.mark .wm{font-weight:800;color:var(--acd);font-size:15px}
.mark .doc{margin-left:auto;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--acd);
  background:var(--tint);border-radius:999px;padding:3px 12px}
header.band h1{margin:0 0 2px;font-size:26px;line-height:1.25;font-weight:800}
header.band .role{font-size:15px;color:var(--tx2)}
header.band .meta{margin-top:12px;font-size:12.5px;line-height:1.7;color:var(--tx2)}
.confidential{background:var(--holdbg);border-top:1px solid #efe0b0;border-bottom:1px solid #efe0b0;color:var(--hold);
  padding:9px 36px;font-size:12.5px;font-weight:600}
.status{padding:12px 36px;border-bottom:1px solid var(--ln2);background:var(--tint2);color:var(--acd);font-size:14px;font-weight:600}
.status.closed{background:var(--badbg);color:var(--bad)}
.status.paused{background:var(--holdbg);color:var(--hold)}
section{padding:24px 36px;border-bottom:1px solid var(--ln2)}
section:last-of-type{border-bottom:0}
h2{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:800;margin:0 0 16px;text-transform:uppercase;letter-spacing:.08em;color:var(--acd)}
h2 .num{display:inline-flex;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:24px;border-radius:50%;
  background:var(--ac);color:#fff;font-size:12px;letter-spacing:0}
h3{font-size:14.5px;margin:22px 0 8px}
p{margin:0 0 10px}
ul{margin:0 0 12px;padding-left:20px}
li{margin-bottom:4px}
a{color:var(--acd)}
.empty{color:var(--tx2);font-style:italic}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%}
table.fields th{width:34%;text-align:left;vertical-align:top;padding:6px 14px 6px 0;color:var(--tx2);font-weight:600}
table.fields td{padding:6px 0;vertical-align:top}
table.grid{font-size:13px;margin-bottom:6px}
table.grid th{text-align:left;background:var(--tint2);padding:8px 10px;border:1px solid var(--ln);white-space:nowrap}
table.grid td{padding:8px 10px;border:1px solid var(--ln);vertical-align:top}
table.fields td .scroll{margin:2px 0 0}
table.fields td table.grid{margin-bottom:0;font-size:12.5px}
ul.kv{margin:0;padding:0;list-style:none}
ul.kv li{margin-bottom:3px}
ul.kv .k{color:var(--tx2);font-weight:600;margin-right:6px}
.card{border:1px solid var(--ln);border-left:4px solid var(--ac);border-radius:10px;padding:14px 18px;margin-bottom:14px}
.rec{border:1px solid var(--ln);border-left:3px solid var(--ac);border-radius:8px;padding:8px 14px 4px;margin:0 0 10px}
.rec h4{margin:2px 0 4px;font-size:13.5px}
.rec table.fields th{width:30%;padding:4px 12px 4px 0}
.rec table.fields td{padding:4px 0}
.notesbox{background:var(--tint2);border:1px dashed var(--tintln);border-radius:8px;padding:10px 14px;margin:10px 0 0}
.notesbox .k{display:block;color:var(--tx2);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px}
.attempt{color:var(--hold);font-weight:700;font-size:12.5px}
.card h3{margin-top:0}
.tags{color:var(--tx2);font-size:12.5px;margin-bottom:10px}
.tags b{color:var(--tx)}
.quote{background:var(--tint2);border-left:3px solid var(--tintln);border-radius:0 8px 8px 0;padding:10px 14px;margin:0 0 14px;
  white-space:pre-wrap}
.note{color:var(--tx2);font-size:12.5px}
.linkbox{border:1px solid var(--tintln);border-left:4px solid var(--ac);background:var(--tint2);
  border-radius:8px;padding:14px 18px;margin:16px 0 6px}
.linkbox .linktitle{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--acd);margin:0 0 10px}
a.reportlink{display:inline-block;background:var(--acd);color:#fff;font-weight:700;font-size:13px;
  text-decoration:none;padding:7px 16px;border-radius:8px;margin:0 8px 6px 0;border:1px solid var(--acd)}
a.reportlink:hover{background:#4a5b19;border-color:#4a5b19}
.linkbox .note{margin-bottom:0}
@media (max-width:640px){
  body{padding:10px}
  header.band,section,.confidential,.status{padding-left:16px;padding-right:16px}
  header.band h1{font-size:22px}
  table.fields th,table.fields td{display:block;width:auto;padding:2px 0}
  table.fields td{padding-bottom:8px}
  .rec table.fields th{width:auto;padding:2px 0}
}
@media print{
  body{background:#fff;padding:0}
  .page{max-width:none;box-shadow:none;border-radius:0}
  section{page-break-inside:auto;border-bottom:0;padding:18px 0}
  .card,.rec,table.grid tr,.linkbox{page-break-inside:avoid}
  h2{page-break-after:avoid}
  header.band{padding:0 0 14px;border-bottom:2px solid var(--ac)}
  .confidential,.status{padding-left:0;padding-right:0}
  /* Printers drop background colours by default, which would leave the report
     button as invisible white-on-white. Ink, not fill, on paper. */
  a.reportlink{background:#fff;color:var(--acd);border:1.5px solid var(--acd)}
}
`;

/**
 * Render the self-contained HTML dossier.
 *
 * U03 adds two cuts for the interview panel's email (utils/panelPackBlock.js
 * packVariantFor() picks one per round). `download` is the dossier download and
 * is pinned by a sha256 snapshot (tests/unit/candidateDossier.test.js). U03c
 * gives the two panel cuts their own page (renderPanelReport, below):
 *   - `panel_tech` (Tech 1/2/3): at a glance, then the feedback in full;
 *   - `panel_leadership` (HR, CEO): at a glance, what happened, the feedback in
 *     full, the profile, screening and assessment, and the position last.
 *
 * The report states facts about the candidate and nothing about itself: no
 * account of what was redacted, no index of the pack, no instructions beyond
 * the one-line confidentiality notice.
 *
 * @param {object} model - from buildDossierModel()
 * @param {{ variant?: 'download'|'panel_tech'|'panel_leadership', stageKey?: string|null }} [options]
 *   `stageKey`: the round a panel cut is for (its booking heads the page)
 * @returns {string} a complete HTML document
 */
export function renderDossierHtml(model, { variant = 'download', stageKey = null } = {}) {
  if (variant === 'panel_tech' || variant === 'panel_leadership') return renderPanelReport(model, { variant, stageKey });
  const { candidate, generated, status } = model;
  const days = config.dossier.deletionDays;

  // ---- 4. Progress so far --------------------------------------------------
  // One record per decision, read top to bottom (L12), not a six-column grid.
  const stagesHtml = recordList(model.stages.map((s) => ({
    title: `${s.stage_label} — ${s.outcome || eventLabel(s.event_type)}`,
    rows: [
      { label: 'What happened', value: eventLabel(s.event_type) },
      { label: 'Reason / note', value: s.reason || s.notes },
      { label: 'Decided by', value: s.decided_by },
      { label: 'When', value: formatDateTime(s.decided_at) },
    ],
  })));

  // ---- 6. Per-round scorecards --------------------------------------------
  // The recruiter's own notes for a round (L12: an edited "Tech round 1"
  // feedback), printed once, inside that round's current scorecard; a round
  // with notes but no scorecard gets a card of its own.
  const notesByStage = new Map((model.round_notes || []).map((n) => [n.stage_key, n]));
  const notesBox = (n) => `<div class="notesbox"><span class="k">Round feedback recorded in the ATS</span>`
    + `<div style="white-space:pre-wrap">${esc(n.value)}</div></div>`;
  const notesPrinted = new Set();
  const roundNotesHtml = (c) => {
    const n = notesByStage.get(c.stage_key);
    if (!n || c.earlier_attempt || notesPrinted.has(c.stage_key)) return '';
    notesPrinted.add(c.stage_key);
    return notesBox(n);
  };
  const leftoverNotesHtml = () => (model.round_notes || [])
    .filter((n) => !model.scorecards.some((c) => c.stage_key === n.stage_key && !c.earlier_attempt))
    .map((n) => `<div class="card"><h3>${esc(n.stage_label)}</h3>${notesBox(n)}</div>`)
    .join('');
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
      + (c.earlier_attempt ? '<p class="attempt">Earlier attempt</p>' : '')
      + (tags ? `<div class="tags">${tags}</div>` : '')
      + skills
      + (c.comments ? `<div class="quote">${esc(c.comments)}</div>` : '')
      + hr
      + roundNotesHtml(c)
      + '</div>';
  }).join('') + leftoverNotesHtml();

  // Rounds still owed a scorecard. Stated rather than omitted, so "no feedback
  // yet" is never mistaken for "feedback was withheld".
  const pendingHtml = model.scorecards_pending.length
    ? `<p class="note">Still awaited: ${esc(model.scorecards_pending
      .map((p) => `${p.stage_label}${p.interviewer ? ` (${p.interviewer})` : ''}`)
      .join(', '))}.</p>`
    : '';

  // ---- 7. Screening and assessment scores ----------------------------------
  const zekoHtml = recordList(model.zeko.map((z) => ({
    title: z.round,
    rows: [
      { label: 'Overall', value: z.overall_score },
      { label: 'Technical', value: z.technical_score },
      { label: 'Communication', value: z.communication_score },
      { label: 'Taken on', value: formatDate(z.taken_at) },
    ],
  })));

  // The screening assessment itself, rendered into the pack (plan §6.7): the
  // same assessment as the vendor's page, with compensation removed by
  // buildZekoReportSection(), in a file that works offline. The removal is not
  // announced to the reader — the report carries facts about the candidate, not
  // an account of its own redaction.
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
        + (d.parameters.length ? '<h3>Requirements</h3>' : '')
        + recordList(d.parameters.map((p) => ({
          title: `${p.name}${p.required ? ' (must-have)' : ''}`,
          rows: [
            { label: 'Met?', value: p.met ? 'Yes' : 'No' },
            { label: 'What the candidate said', value: p.answer },
            { label: 'Assessment', value: p.remark },
          ],
        })))
        + list('Strengths', d.strengths)
        + list('Areas of concern', d.concerns)
        + list('Recommendation', d.recommendation)
        + list('Suggested development', d.improvements)
        + (d.soft_skills?.length
          ? `<h3>Communication and thinking</h3>${recordList(
            // "Not assessed" rather than a dash or a rating: the screening AI
            // stamps "weak" on skills it never got the chance to observe, and
            // passing that on would misrepresent a real candidate to someone
            // about to interview them.
            d.soft_skills.map((s) => ({
              title: s.area,
              rows: [
                { label: 'Rating', value: s.assessed ? s.rating : 'Not assessed' },
                { label: 'Assessment', value: s.comment },
              ],
            })),
          )}`
          : '')
        + '</div>';
    }).join('');

  // The full screening report, as a link rather than a column: the URL is long
  // and would wreck the table on paper. One short line says it needs no login,
  // which is the reason not to forward it.
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
      + '</p><p class="note">No login required. Do not forward.</p></div>'
    : '';

  // The written assessment, rendered in full rather than named.
  //
  // Evalground has no API and exports no per-candidate report file — what HR can
  // export is a MULTI-CANDIDATE workbook, one row per person, which is why it
  // can never travel inside a pack about one of them. So the pack renders that
  // candidate's own row instead: the same resolution §6.7 reached for the Zeko
  // report, and for the same reason — it works offline, it is under our
  // redaction, and it cannot be withdrawn from under the reader months later.
  //
  // The vendor's counts are printed unaltered, never recomputed. An interviewer
  // holding an Evalground screenshot must not find two different numbers for one
  // attempt (the same rule buildZekoReportSection() follows for its ratios).
  const assessmentHtml = model.assessments.map((a) => {
    const d = a.detail;

    const tags = [
      a.result ? `<b>Result:</b> ${esc(a.result)}` : null,
      a.overall_marks !== null && a.overall_marks !== undefined
        ? `<b>Marks:</b> ${esc(a.overall_marks)}` : null,
      a.overall_percentage !== null && a.overall_percentage !== undefined
        ? `<b>Score:</b> ${esc(a.overall_percentage)}%` : null,
      d?.started_on ? `<b>Taken:</b> ${esc(d.started_on)}` : null,
      d?.duration ? `<b>Time taken:</b> ${esc(d.duration)}` : null,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');

    // One combined column rather than three: easy/medium/hard is read as a
    // shape, and three near-empty columns push the table into a scroll on paper.
    const split = (s) => (s.easy_correct === null && s.medium_correct === null && s.hard_correct === null
      ? null
      : `${s.easy_correct ?? '—'} / ${s.medium_correct ?? '—'} / ${s.hard_correct ?? '—'}`);

    // The detailed table CARRIES the marks, so the simple score table is not
    // printed alongside it — the same numbers twice invites a reader to look for
    // a difference that is not there.
    const sectionsHtml = d?.sections?.length
      ? recordList(d.sections.map((s) => ({
        title: s.label,
        rows: [
          { label: 'Marks', value: s.marks },
          { label: 'Correct', value: s.correct },
          { label: 'Wrong', value: s.wrong },
          { label: 'Unattempted', value: s.unattempted },
          { label: 'Easy / medium / hard correct', value: split(s) },
          { label: 'Result', value: s.result },
        ],
      })))
      : fieldTable(a.sections.map((s) => ({ label: s.label, value: s.score })));

    const totals = d?.totals || null;
    const totalsHtml = totals && (totals.correct !== null || totals.wrong !== null
      || totals.unattempted !== null)
      ? `<p class="note">Total: ${esc(totals.correct ?? '—')} correct, `
        + `${esc(totals.wrong ?? '—')} wrong, ${esc(totals.unattempted ?? '—')} unattempted.</p>`
      : '';

    // Discovered per test, never a fixed list — one test's topics are "Sql,
    // Python, Playwright", the next one's are something else entirely.
    const topicsHtml = d?.topics?.length
      ? `<h3>Topic scores</h3>${fieldTable(d.topics.map((t) => ({ label: t.label, value: t.value })))}`
      : '';

    return '<div class="card">'
      + `<h3>${esc(a.test_name)}</h3>`
      + (tags ? `<div class="tags">${tags}</div>` : '')
      + sectionsHtml
      + totalsHtml
      + topicsHtml
      + '</div>';
  }).join('');

  // ---- 8/9. Interviews and recordings --------------------------------------
  const interviewsHtml = recordList(model.interviews.map((i) => ({
    title: `${i.stage_label}${i.earlier_attempt ? ' (earlier attempt)' : ''}`,
    rows: [
      { label: 'Interviewer', value: i.interviewer },
      { label: 'Scheduled', value: formatDateTime(i.scheduled_start_at) },
      // Null is a genuine third state — nobody has confirmed either way — and
      // must not be printed as "did not happen".
      { label: 'Did it happen?', value: i.occurrence === 'held' ? 'Yes' : i.occurrence === 'no_show' ? `No-show (${i.no_show_party || 'unrecorded'})` : 'Not confirmed' },
      { label: 'Client feedback', value: i.client_feedback },
    ],
  })));

  // Recordings travel as expiring, revocable links rather than as bytes (HR
  // decision #7): an MP4 round is hundreds of MB and three of them would make
  // the pack unmailable.
  //
  // When links are present the section becomes cards with a button, not a table
  // cell holding a URL — the same lesson §6.6 produced for the screening report,
  // where readers scrolled straight past an underlined round name in a grey
  // footnote. A recording nobody notices they can watch may as well not be here.
  //
  // A hyperlink is not an external RESOURCE: nothing is fetched when the file is
  // opened, so the pack still renders complete with no network (tracker row 5).
  const anyRecordingLinked = model.recordings.some((r) => r.share_url);
  const recordingsHtml = anyRecordingLinked
    ? model.recordings.map((r) => {
      const facts = [
        r.recorded_start_at ? `<b>Recorded:</b> ${esc(formatDateTime(r.recorded_start_at))}` : null,
        r.duration_seconds !== null && r.duration_seconds !== undefined
          ? `<b>Length:</b> ${esc(Math.round(r.duration_seconds / 60))} min` : null,
      ].filter(Boolean).join(' &nbsp;·&nbsp; ');

      return '<div class="card">'
        + `<h3>${esc(r.stage_label)}</h3>`
        + (facts ? `<div class="tags">${facts}</div>` : '')
        + (r.share_url
          ? '<div class="linkbox"><p class="linktitle">Watch this interview</p><p>'
            + `<a href="${esc(r.share_url)}" class="reportlink" target="_blank" rel="noopener noreferrer">`
            + `Play the ${esc(r.stage_label)} recording &rarr;</a></p>`
            + '<p class="note">No login required'
            + (r.share_expires_at ? `. Expires ${esc(formatDate(r.share_expires_at))}` : '')
            + '. Do not forward.</p></div>'
          : '<p class="note">Link not shared.</p>')
        + '</div>';
    }).join('')
    : recordList(model.recordings.map((r) => ({
      title: r.stage_label,
      rows: [
        { label: 'Recorded on', value: formatDateTime(r.recorded_start_at) },
        { label: 'Length', value: r.duration_seconds !== null ? `${Math.round(r.duration_seconds / 60)} min` : null },
      ],
    })));

  const open = `<!DOCTYPE html>
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
  <div class="mark"><img src="${AAPNA_MARK_DATA_URI}" alt=""><span class="wm">AAPNA Infotech</span><span class="doc">Candidate dossier</span></div>
  <h1>${esc(candidate.name)}</h1>
  <div class="role">${esc(text(candidate.position, { empty: 'Position not recorded' }))}</div>
  <div class="meta">
    ${candidate.mrf_ref ? `Requisition: ${esc(candidate.mrf_ref)}<br>` : ''}
    Prepared by ${esc(generated.by)} on ${esc(formatDateTime(generated.at))}
  </div>
</header>

<div class="confidential">
  CONFIDENTIAL — do not forward. Delete within ${esc(days)} days of the interview.
</div>

<div class="status${status.closed ? ' closed' : status.state === 'paused' ? ' paused' : ''}">
  ${esc(status.headline)}
</div>`;

  // No footer: who prepared it and when is already in the header.
  const close = `</div>
</body>
</html>`;

  return `${open}

${section(1, 'Candidate profile', fieldTable(model.profile), EMPTY.profile)}

${section(2, 'The position', fieldTable(model.position), EMPTY.position)}

${section(3, 'Progress so far', stagesHtml, EMPTY.progress)}

${section(4, 'Consolidated interviewer feedback',
    model.consolidated_feedback ? `<div class="quote">${esc(model.consolidated_feedback)}</div>` : '',
    EMPTY.feedback)}

${section(5, 'Interviewer scorecards', scorecardsHtml + pendingHtml, EMPTY.scorecards)}

${section(6, 'AI screening', zekoHtml + zekoDetailHtml + zekoLinksHtml, EMPTY.screening)}

${section(7, 'Assessment results', assessmentHtml, EMPTY.assessment)}

${section(8, 'Interview history', interviewsHtml, EMPTY.interviews)}

${section(9, 'Interview recordings', recordingsHtml, EMPTY.recordings)}

${close}`;
}

/*
 * ---------------------------------------------------------------------------
 * U03c · THE PANEL'S CUTS OF THE REPORT SO FAR
 * ---------------------------------------------------------------------------
 * Chhaya (18 Nov): the report sent with the CEO round "is not in desirable
 * format", and the panel needs "the things required for a CEO or tech round
 * person: clear and clean and full feedback shared by other rounds". So the
 * panel cuts are their own page, in the AAPNA look (the ATS app's and the
 * branded email's tokens), written to be caught up on quickly:
 *
 *   panel_leadership (HR, CEO)          panel_tech (Tech 1/2/3)
 *     1 At a glance                       1 At a glance
 *     2 What happened                     2 Feedback in full
 *     3 Feedback in full
 *     4 Candidate profile
 *     5 Screening and assessment
 *     6 The position (last)
 *
 * "What happened" is one entry per step (utils/panelFeedback.js
 * panelJourney): the system's own notes (recording opened, dossier
 * downloaded, link sent, an external viewer's IP) are not steps, and the
 * feedback is printed once, in full. Concerns are highlighted the same way the
 * invite's table highlights them.
 *
 * The download keeps its own nine sections and every record in them; since
 * U03d it shares this look (STYLES above, on the same AAPNA_TOKENS).
 */

/** The panel cuts' stylesheet, on the shared AAPNA tokens (AAPNA_TOKENS above). */
const PANEL_STYLES = `
${AAPNA_TOKENS}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--tx);font:14px/1.6 Inter,"Segoe UI",Arial,sans-serif}
.ap{padding:22px}
.pg{max-width:860px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border-top:6px solid var(--ac);
  box-shadow:0 1px 3px rgba(16,24,20,.06),0 10px 28px rgba(16,24,20,.08)}
.hd{padding:20px 32px 18px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.brand img{width:34px;height:34px;display:block}
.brand .wm{font-weight:800;color:var(--acd);font-size:15px}
.brand .doc{margin-left:auto;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--acd);
  background:var(--tint);border-radius:999px;padding:3px 12px}
h1{margin:0;font-size:26px;line-height:1.25;font-weight:800}
.role{color:var(--tx2);font-size:15px;margin-top:2px}
.for{margin-top:10px}
.for b{color:var(--acd)}
ul.facts{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0;padding:0;list-style:none}
ul.facts li{background:var(--tint2);border:1px solid var(--tintln);border-radius:999px;padding:1px 11px;font-size:12.5px;margin:0}
.state{padding:9px 32px;font-weight:700;font-size:13px}
.state.closed{background:var(--badbg);color:var(--bad)}
.state.paused{background:var(--holdbg);color:var(--hold)}
.conf{background:var(--holdbg);color:var(--hold);font-size:12.5px;font-weight:600;padding:8px 32px;border-top:1px solid #efe0b0;border-bottom:1px solid #efe0b0}
section{padding:22px 32px;border-top:1px solid var(--ln2)}
.conf + section{border-top:0}
h2{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--acd)}
h2 .n{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--ac);color:#fff;font-size:12px;letter-spacing:0}
p{margin:0 0 10px}
ul{margin:0 0 8px;padding-left:20px}
li{margin-bottom:3px}
a{color:var(--acd)}
.muted,.note{color:var(--tx2)}
.note{font-size:12.5px}
.empty{color:var(--tx2);font-style:italic;margin:0}
.pill{display:inline-block;font-size:12px;font-weight:700;border-radius:999px;padding:1px 10px;white-space:nowrap}
.pill.ok{background:var(--okbg);color:var(--ok)}
.pill.hold{background:var(--holdbg);color:var(--hold)}
.pill.bad{background:var(--badbg);color:var(--bad)}
.pill.now{background:var(--tint);color:var(--acd)}
.pill.off{background:#eef0ee;color:var(--tx2)}
.glance{background:var(--tint2);border:1px solid var(--tintln);border-radius:10px;padding:16px 18px}
.short{font-size:16px;font-weight:600;margin:0 0 16px}
.short b{color:var(--acd)}
ol.steps{display:flex;list-style:none;margin:0 0 16px;padding:0}
ol.steps li{flex:1 1 0;position:relative;text-align:center;padding:0 4px;margin:0;min-width:0}
ol.steps li::before{content:"";position:absolute;top:13px;left:-50%;right:50%;height:2px;background:var(--ac)}
ol.steps li:first-child::before{display:none}
ol.steps li.now::before{background:repeating-linear-gradient(90deg,var(--ac) 0 5px,transparent 5px 9px)}
ol.steps .dot{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;
  background:var(--ac);color:#fff;font-weight:800;font-size:14px;line-height:1}
ol.steps li.now .dot{background:#fff;border:2px solid var(--ac);color:var(--acd)}
ol.steps li.pending .dot{background:#fff;border:2px solid #b4bcba;color:var(--tx2)}
ol.steps li.hold .dot{background:var(--holddot)}
ol.steps li.bad .dot{background:var(--bad)}
ol.steps .tx{display:block}
ol.steps .sl{display:block;font-weight:700;font-size:12.5px;margin-top:6px;line-height:1.3}
ol.steps .sl,ol.steps .ss{overflow-wrap:break-word;hyphens:auto}
ol.steps.many li{padding:0 2px}
ol.steps.many .sl,ol.steps.many .ss{font-size:11px}
ol.steps .sd{display:block;font-size:12px;color:var(--tx2)}
ol.steps .ss{display:block;font-size:12.5px;font-weight:800;color:var(--acd)}
ol.steps li.hold .ss{color:var(--hold)}
ol.steps li.bad .ss{color:var(--bad)}
.cbox{border-radius:8px;padding:10px 14px;border:1px solid var(--badln);border-left:4px solid var(--bad);background:var(--badbg)}
.cbox .t{margin:0 0 4px;font-weight:800;color:var(--bad)}
.cbox ul{margin:0}
.cbox.none{border-color:#cfe2d4;border-left-color:var(--ok);background:var(--okbg)}
.cbox.none .t{color:var(--ok);margin:0}
ol.tl{list-style:none;margin:0;padding:0}
ol.tl > li{display:grid;grid-template-columns:56px 22px minmax(0,1fr);column-gap:10px;margin:0;padding:0 0 18px;position:relative}
ol.tl > li::before{content:"";position:absolute;left:76px;top:20px;bottom:0;width:2px;background:var(--ln)}
ol.tl > li:last-child{padding-bottom:0}
ol.tl > li:last-child::before{display:none}
.tl .d{font-size:12.5px;color:var(--tx2);font-variant-numeric:tabular-nums;padding-top:2px;text-align:right;white-space:nowrap}
.tl .m{position:relative;z-index:1;width:14px;height:14px;border-radius:50%;background:var(--ac);margin:5px auto 0;box-shadow:0 0 0 3px #fff}
.tl li.off .m{background:#fff;border:2px solid #b4bcba}
.tl li.now .m{background:#fff;border:3px solid var(--ac)}
.tl li.hold .m{background:var(--holddot)}
.tl li.bad .m{background:var(--bad)}
.tl .c{min-width:0}
.tl .h{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px}
.tl .h strong{font-size:14.5px}
.tl .sc{font-weight:800;color:var(--acd);font-variant-numeric:tabular-nums}
.tl .sc.flag{color:var(--bad)}
.tl .who{color:var(--tx2)}
.tl li.off .h strong{font-weight:600;color:var(--tx2)}
.tl .q{margin:6px 0 0;padding:6px 12px;border-left:3px solid var(--tintln);background:var(--tint2);border-radius:0 6px 6px 0;white-space:pre-wrap}
.tl .act{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:8px}
.tl p.flag{margin:6px 0 0}
a.play{display:inline-block;background:var(--acd);color:#fff;text-decoration:none;font-weight:700;font-size:12.5px;border-radius:8px;padding:5px 12px}
.moved{font-size:12.5px;color:var(--tx2)}
.moved.flag{color:var(--bad)}
.fb{border:1px solid var(--ln);border-left:4px solid var(--ac);border-radius:10px;padding:14px 18px 8px;margin-bottom:14px}
.fb:last-child{margin-bottom:0}
.fb.flagged{border-left-color:var(--bad)}
.fb-h{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-bottom:4px}
.fb-h h3{margin:0;font-size:15px}
.fb-h .meta{color:var(--tx2);font-size:12.5px}
.fb h4{margin:10px 0 3px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--tx2)}
.fb li{white-space:pre-wrap}
.flag{color:var(--bad);font-weight:700}
li.flag::before,p.flag::before{content:"Concern: "}
li.flag.own::before,p.flag.own::before{content:none}
table{border-collapse:collapse;width:100%}
table.fields th{width:32%;text-align:left;vertical-align:top;padding:5px 14px 5px 0;color:var(--tx2);font-weight:600}
table.fields td{padding:5px 0;vertical-align:top}
.rec{border:1px solid var(--ln);border-radius:8px;padding:6px 12px 2px;margin:0 0 8px}
.rec h4{margin:2px 0 2px;font-size:13px}
ul.kv{margin:0;padding:0;list-style:none}
ul.kv .k{color:var(--tx2);font-weight:600;margin-right:6px}
.mini{display:flex;flex-wrap:wrap;gap:10px}
.mini > div{flex:1 1 200px;border:1px solid var(--ln);border-radius:10px;padding:10px 14px}
.mini > div.flagged{border-color:var(--badln);background:var(--badbg)}
.mini .k{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--tx2)}
.mini .v{font-size:18px;font-weight:800;color:var(--acd)}
.mini .v.none{font-size:14px;font-weight:600;color:var(--tx2)}
.mini .v.flag{font-size:15px;color:var(--bad)}
.mini .s{font-size:12.5px;color:var(--tx2)}
.mini ul{margin:6px 0 0}
.ft{padding:12px 32px;background:var(--canvas);color:var(--tx2);font-size:12px;border-top:1px solid var(--ln2)}
@media (max-width:640px){
  .ap{padding:10px}
  .hd,section,.ft,.conf,.state{padding-left:16px;padding-right:16px}
  h1{font-size:22px}
  ol.steps{flex-direction:column}
  ol.steps li{display:flex;align-items:center;gap:10px;text-align:left;padding:0 0 10px}
  ol.steps li::before{left:13px;right:auto;top:-10px;width:2px;height:12px}
  ol.steps li:first-child::before{display:none}
  ol.steps .dot{flex:0 0 28px}
  ol.steps .tx{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 8px}
  ol.steps .sl{margin-top:0}
  ol.tl > li{grid-template-columns:44px 18px minmax(0,1fr);column-gap:8px}
  ol.tl > li::before{left:60px}
  table.fields th,table.fields td{display:block;width:auto;padding:2px 0}
  table.fields td{padding-bottom:8px}
}
@media print{
  body,.ap{background:#fff;padding:0}
  .pg{box-shadow:none;border-radius:0;max-width:none}
  .fb,ol.tl > li,.glance,.mini > div{break-inside:avoid}
  h2{break-after:avoid}
  a.play{background:#fff;color:var(--acd);border:1.5px solid var(--acd)}
}
`;

const panelDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: EXPORT_TIMEZONE, day: '2-digit', month: 'short' });
const panelYearFmt = new Intl.DateTimeFormat('en-GB', { timeZone: EXPORT_TIMEZONE, year: 'numeric' });
const panelTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: EXPORT_TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true });
const panelDate = (d) => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "19 Oct", with the year when it is not the report's own year. */
function panelShortDate(d, refYear) {
  const date = panelDate(d);
  if (!date) return '';
  const year = panelYearFmt.format(date);
  return `${panelDateFmt.format(date)}${refYear && year !== refYear ? ` ${year}` : ''}`;
}

/** "7:30 PM". */
function panelTime(d) {
  const date = panelDate(d);
  return date ? panelTimeFmt.format(date).replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toUpperCase()}`) : '';
}

/** "18 Nov 2026, 7:30 PM". */
function panelDateTime(d) {
  const date = panelDate(d);
  return date ? `${panelDateFmt.format(date)} ${panelYearFmt.format(date)}, ${panelTime(date)}` : '';
}

/** Escaped prose with its line breaks (the CSS keeps them: white-space:pre-wrap). */
const prose = (s) => esc(String(s ?? '').trim());

const PILL_BY_TONE = { ok: 'ok', hold: 'hold', bad: 'bad' };
function verdictPill(v) {
  if (!v.label) return '';
  return `<span class="pill ${PILL_BY_TONE[v.tone] || 'off'}">${esc(v.label)}</span>`;
}

/** A decision's pill: "Approved", "Rejected", "On hold". */
function decisionPill(outcome) {
  const o = String(outcome || '').trim();
  if (!o) return '';
  const tone = /approv|moved on|cleared|select/i.test(o) ? 'ok' : /reject|withdraw|drop/i.test(o) ? 'bad' : /hold/i.test(o) ? 'hold' : 'off';
  return `<span class="pill ${tone}">${esc(o.charAt(0).toUpperCase() + o.slice(1))}</span>`;
}

/** "Moved on by cverma, 19 Oct", or the hold or rejection, flagged. */
function decisionLine(d, refYear) {
  if (!d) return '';
  const o = String(d.outcome || '').toLowerCase();
  const when = panelShortDate(d.at, refYear);
  const by = [d.by ? `by ${d.by}` : null].filter(Boolean).join('');
  const tail = `${by ? ` ${by}` : ''}${when ? `, ${when}` : ''}${d.reason ? `: ${d.reason}` : ''}`;
  if (/reject/.test(o)) return `<span class="moved flag">Rejected${esc(tail)}</span>`;
  if (/hold/.test(o)) return `<span class="moved flag">Put on hold${esc(tail)}</span>`;
  if (/approv|moved on/.test(o)) return `<span class="moved">Moved on${esc(tail)}</span>`;
  return `<span class="moved">${esc(o.charAt(0).toUpperCase() + o.slice(1))}${esc(tail)}</span>`;
}

function recordingButtons(recordings) {
  return recordings.map((r) => {
    const mins = r.duration_seconds !== null && r.duration_seconds !== undefined ? ` · ${Math.max(1, Math.round(r.duration_seconds / 60))} min` : '';
    return r.url
      ? `<a class="play" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">&#9654; Play recording${esc(mins)}</a>`
      : `<span class="moved">Recorded${esc(mins)}: ask the recruitment team for the link</span>`;
  }).join('');
}

/** The header's fact strip: experience, company, location, notice, qualification. Never CTC. */
function panelFacts(profile) {
  const get = (field) => {
    const row = (profile || []).find((p) => p.field === field);
    const t = row ? text(row.value, { empty: '' }) : '';
    return t.trim();
  };
  const exp = get('TotalExperienceYears');
  const notice = get('NoticePeriod');
  return [
    exp ? (/^\d+(\.\d+)?$/.test(exp) ? `${exp} years' experience` : exp) : null,
    get('CurrentCompany') || null,
    get('CurrentLocation') || null,
    notice ? `Notice: ${notice}` : null,
    get('HighestQualification') || null,
  ].filter(Boolean);
}

function stripHtml(strip, refYear) {
  const DOT = { done: '&#10003;', now: '&#9679;', hold: '!', bad: '!', pending: '&#8226;' };
  return `<ol class="steps${strip.length > 7 ? ' many' : ''}">${strip.map((s) => `<li class="${s.state}"><span class="dot">${DOT[s.state] || '&#10003;'}</span>`
    + `<span class="tx"><span class="sl">${esc(s.label)}</span>`
    + `${s.date ? `<span class="sd">${esc(panelShortDate(s.date, refYear))}</span>` : ''}`
    + `${s.score ? `<span class="ss">${esc(s.score)}</span>` : ''}</span></li>`).join('')}</ol>`;
}

function concernsHtml(concerns) {
  if (!concerns.length) return '<div class="cbox none"><p class="t">&#10003; No concerns raised in earlier rounds.</p></div>';
  return `<div class="cbox"><p class="t">Concerns raised (${concerns.length})</p><ul>${concerns
    .map((c) => `<li><b>${esc(c.round)}:</b> ${prose(c.text)}</li>`).join('')}</ul></div>`;
}

/** The entry's own concern lines: a low rating, "not suitable" wording, a red flag. */
function entryFlags(e) {
  const lines = new Map(); // line -> its class ("own": the label already says "concern")
  for (const f of e.feedback) {
    for (const i of feedbackItems(f, { spaced: true })) if (i.concern) lines.set(itemLine(i), i.prefix === false ? 'flag own' : 'flag');
  }
  for (const i of e.note_items) if (i.concern) lines.set(noteItemText(i, { spaced: true }), 'flag');
  for (const flag of e.red_flags || []) lines.set(`Zeko red flag: ${flag}`, 'flag');
  return [...lines].map(([l, cls]) => `<p class="${cls}">${prose(l)}</p>`).join('');
}

function journeyEntryHtml(e, refYear) {
  const tone = entryTone(e);
  const cls = e.kind === 'this_round' ? 'now' : (e.kind === 'cancelled' || e.kind === 'no_show') ? 'off' : (tone || '');
  const date = panelShortDate(e.date, refYear);
  let head = `<strong>${esc(e.stage_label)}${e.earlier_attempt ? ' (earlier attempt)' : ''}</strong>`;
  let body = '';
  if (e.kind === 'this_round') {
    head += '<span class="pill now">This round</span>'
      + `<span class="who">${esc([e.interviewer, panelTime(e.date)].filter(Boolean).join(' · '))}</span>`;
  } else if (e.kind === 'cancelled') {
    head += `<span class="pill off">Cancelled</span><span class="who">${esc(e.reason || 'The booking was cancelled.')}</span>`;
  } else if (e.kind === 'no_show') {
    head += `<span class="pill hold">No-show</span><span class="who">${esc([e.interviewer, e.no_show_party ? `(${e.no_show_party})` : null].filter(Boolean).join(' '))}</span>`;
  } else if (e.kind === 'screening' || e.kind === 'assessment' || e.kind === 'step') {
    head += decisionPill(e.decision?.outcome);
    if (e.score !== null && e.score !== undefined) head += `<span class="sc">Score ${esc(e.score)}</span>`;
    else if (e.result) head += `<span class="sc${e.failed ? ' flag' : ''}">${esc(e.result)}</span>`;
    const none = e.kind === 'screening' && (e.score === null || e.score === undefined) ? 'No score on file'
      : e.kind === 'assessment' && !e.result ? 'No result on file' : null;
    const who = [none, e.decision?.by ? `by ${e.decision.by}` : null].filter(Boolean).join(' · ');
    if (who) head += `<span class="who">${esc(who)}</span>`;
    body += entryFlags(e);
  } else {
    // An interview: its verdict(s), the quote, the concerns, the recording, the decision.
    if (e.feedback.length === 1) {
      const v = verdictOf(e.feedback[0]);
      head += verdictPill(v)
        + (v.average !== null ? `<span class="sc${v.lowAverage ? ' flag' : ''}">avg ${esc(v.average)} / 5</span>` : '')
        + `<span class="who">${esc(e.feedback[0].interviewer || e.interviewer || '')}</span>`;
    } else if (e.feedback.length > 1) {
      head += `<span class="who">${esc(`${e.feedback.length} interviewers`)}</span>`;
      body += e.feedback.map((f) => {
        const v = verdictOf(f);
        return `<div class="h">${esc(f.interviewer || 'Interviewer')} ${verdictPill(v)}`
          + `${v.average !== null ? `<span class="sc${v.lowAverage ? ' flag' : ''}">avg ${esc(v.average)} / 5</span>` : ''}</div>`;
      }).join('');
    } else {
      head += `<span class="pill off">${e.held || e.note_items.length ? 'Held' : 'Not confirmed'}</span>`
        + (e.interviewer ? `<span class="who">${esc(e.interviewer)}</span>` : '');
    }
    if (e.quote) body += `<p class="q">"${prose(e.quote)}"</p>`;
    body += entryFlags(e);
    const act = recordingButtons(e.recordings) + decisionLine(e.decision, refYear);
    if (act) body += `<div class="act">${act}</div>`;
  }
  return `<li${cls ? ` class="${cls}"` : ''}><span class="d">${esc(date)}</span><span class="m"></span>`
    + `<div class="c"><div class="h">${head}</div>${body}</div></li>`;
}

/** "Feedback in full": one card per interviewer, then any round known only from its recorded form. */
function feedbackCardsHtml(model, refYear) {
  const cards = [];
  const notesByStage = new Map();
  for (const n of model.round_notes || []) {
    const items = parseRoundNote(n.value);
    if (items.length) notesByStage.set(n.stage_key, { n, items });
  }
  const printed = new Set();
  const named = model.consolidated_by_interviewer || [];
  // The recorded form goes under the round's last card.
  const lastCardOf = new Map();
  named.forEach((f, i) => { if (!f.earlier_role && f.stage_key) lastCardOf.set(f.stage_key, i); });

  const list = (items, cls = (i) => (i.concern ? ` class="flag${i.prefix === false ? ' own' : ''}"` : '')) => (items.length
    ? `<ul>${items.map((i) => `<li${cls(i)}>${prose(i.line)}</li>`).join('')}</ul>` : '');
  const noteBlock = (stageKey) => {
    const entry = notesByStage.get(stageKey);
    if (!entry || printed.has(stageKey)) return '';
    printed.add(stageKey);
    return `<h4>Recorded feedback</h4>${list(entry.items.map((i) => ({ line: noteItemText(i, { spaced: true }), concern: i.concern })))}`;
  };

  named.forEach((f, idx) => {
    const v = verdictOf(f);
    const items = feedbackItems(f, { spaced: true });
    // Under its own heading a comment needs no "Comments:" label; an HR field keeps its label.
    const group = (kind) => items.filter((i) => i.kind === kind)
      .map((i) => ({ line: kind === 'hr' ? itemLine(i) : i.text, concern: i.concern, prefix: i.prefix }));
    const meta = [
      v.average !== null ? `<span${v.lowAverage ? ' class="flag"' : ''}>avg ${esc(v.average)} / 5</span>` : null,
      f.final_rating !== null && f.final_rating !== undefined ? `overall ${esc(f.final_rating)}` : null,
      f.submitted_at ? `submitted ${esc(panelShortDate(f.submitted_at, refYear))}` : null,
    ].filter(Boolean).join(' · ');
    const notes = !f.earlier_role && lastCardOf.get(f.stage_key) === idx ? noteBlock(f.stage_key) : '';
    const flagged = v.concern || items.some((i) => i.concern) || (notes && notesByStage.get(f.stage_key)?.items.some((i) => i.concern));
    const skills = group('skill');
    const comments = group('comments');
    const hr = group('hr');
    cards.push(`<div class="fb${flagged ? ' flagged' : ''}"><div class="fb-h"><h3>${esc(f.round)}${f.interviewer ? ` — ${esc(f.interviewer)}` : ''}</h3>`
      + `${verdictPill(v)}${meta ? `<span class="meta">${meta}</span>` : ''}</div>`
      + (skills.length ? `<h4>Ratings</h4>${list(skills)}` : '')
      + (comments.length ? `<h4>Comments</h4>${list(comments)}` : '')
      + (hr.length ? `<h4>HR feedback</h4>${list(hr)}` : '')
      + notes
      + '</div>');
  });
  // Rounds with a recorded form and no scorecard.
  for (const [stageKey, { n, items }] of notesByStage) {
    if (printed.has(stageKey)) continue;
    const who = noteInterviewer(n.value);
    const flagged = items.some((i) => i.concern);
    cards.push(`<div class="fb${flagged ? ' flagged' : ''}"><div class="fb-h"><h3>${esc(n.stage_label || stageKey)}${who ? ` — ${esc(who)}` : ''}</h3></div>`
      + `${noteBlock(stageKey)}</div>`);
  }
  const pending = (model.scorecards_pending || []).length
    ? `<p class="note">Still awaited: ${esc(model.scorecards_pending.map((p) => `${p.stage_label}${p.interviewer ? ` (${p.interviewer})` : ''}`).join(', '))}.</p>`
    : '';
  return cards.join('') + pending;
}

/** "Screening and assessment": one small card per Zeko round and test. */
function screeningCardsHtml(entries, refYear) {
  const cards = entries.filter((e) => e.kind === 'screening' || e.kind === 'assessment').map((e) => {
    const label = e.kind === 'screening' ? `Zeko ${String(e.stage_label || '').replace(/\s*\(zeko\)\s*/i, '').trim()}` : (e.test_name || e.stage_label || 'Assessment');
    const flagged = e.failed || (e.red_flags || []).length > 0;
    let value;
    if (e.kind === 'screening') value = e.score !== null && e.score !== undefined ? `<div class="v">${esc(e.score)}</div>` : '<div class="v none">No score on file</div>';
    else value = e.result ? `<div class="v${e.failed ? ' flag' : ''}">${e.failed ? 'Concern: ' : ''}${esc(e.result)}</div>` : '<div class="v none">No result on file</div>';
    const when = e.kind === 'screening' && e.score !== null && e.score !== undefined && e.date ? `<div class="s">${esc(panelShortDate(e.date, refYear))}</div>` : '';
    const flags = (e.red_flags || []).length
      ? `<ul>${e.red_flags.map((f) => `<li class="flag">Red flag: ${prose(f)}</li>`).join('')}</ul>` : '';
    return `<div${flagged ? ' class="flagged"' : ''}><div class="k">${esc(e.earlier_role ? `${label}` : label)}</div>${value}${when}${flags}</div>`;
  });
  return cards.length ? `<div class="mini">${cards.join('')}</div>` : '';
}

/**
 * The panel's cut of the report so far (see the block comment above).
 *
 * @param {object} model - the panel's dossier model (buildPanelPack)
 * @param {{ variant: 'panel_tech'|'panel_leadership', stageKey?: string|null }} options
 * @returns {string} a complete HTML document
 */
function renderPanelReport(model, { variant, stageKey = null }) {
  const { candidate, generated, status } = model;
  const days = config.dossier.deletionDays;
  const refYear = panelYearFmt.format(panelDate(generated?.at) || new Date());
  const entries = panelJourney(model, { stageKey });
  const strip = journeyStrip(entries);
  const concerns = collectConcerns(model, { excludeStageKey: stageKey });
  const thisRound = entries.find((e) => e.kind === 'this_round') || null;

  const facts = panelFacts(model.profile);
  const forLine = thisRound
    ? `<div class="for"><b>For:</b> ${esc([thisRound.stage_label, thisRound.interviewer, panelDateTime(thisRound.date)].filter(Boolean).join(' · '))}</div>`
    : '';
  const state = status?.closed || status?.state === 'paused'
    ? `<div class="state ${status.closed ? 'closed' : 'paused'}">${esc(status.headline)}</div>`
    : '';
  const role = [text(candidate.position, { empty: 'Position not recorded' }), candidate.mrf_ref].filter(Boolean).join(' · ');

  const open = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<title>Candidate brief — ${esc(candidate.name)}</title>
<style>${PANEL_STYLES}</style>
</head>
<body>
<div class="ap"><div class="pg">
<div class="hd">
  <div class="brand"><img src="${AAPNA_MARK_DATA_URI}" alt=""><span class="wm">AAPNA Infotech</span><span class="doc">Candidate brief</span></div>
  <h1>${esc(candidate.name)}</h1>
  <div class="role">${esc(role)}</div>
  ${forLine}
  ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
</div>
${state}<div class="conf">Confidential: for the interview panel only. Please don't forward it, and delete it within ${esc(days)} days of the interview.</div>`;

  const close = `<div class="ft">Prepared on ${esc(panelDateTime(generated?.at))}${generated?.by ? `, by ${esc(generated.by)}` : ''} · AAPNA Infotech Recruitment</div>
</div></div>
</body>
</html>`;

  const glance = `<div class="glance"><p class="short"><b>In short:</b> ${esc(journeySummary(strip, concerns, entries))}</p>`
    + `${strip.length ? stripHtml(strip, refYear) : ''}${concernsHtml(concerns)}</div>`;
  const panelSection = (n, title, body, emptyNote) => `<section><h2><span class="n">${n}</span>${esc(title)}</h2>`
    + `${body && body.trim() ? body : `<p class="empty">${esc(emptyNote)}</p>`}</section>`;
  const feedback = feedbackCardsHtml(model, refYear);

  if (variant === 'panel_tech') {
    return `${open}
${panelSection(1, 'At a glance', glance)}
${panelSection(2, 'Feedback in full', feedback, EMPTY.feedback)}
${close}`;
  }

  const timeline = entries.length ? `<ol class="tl">${entries.map((e) => journeyEntryHtml(e, refYear)).join('')}</ol>` : '';
  return `${open}
${panelSection(1, 'At a glance', glance)}
${panelSection(2, 'What happened', timeline, EMPTY.progress)}
${panelSection(3, 'Feedback in full', feedback, EMPTY.feedback)}
${panelSection(4, 'Candidate profile', fieldTable(model.profile), EMPTY.profile)}
${panelSection(5, 'Screening and assessment', screeningCardsHtml(entries, refYear), 'No screening or assessment results.')}
${panelSection(6, 'The position', fieldTable(model.position), EMPTY.position)}
${close}`;
}

/**
 * Render the XLSX summary.
 *
 * EVERY sheet is two columns, Field | Value (L12, utils/fieldValueExport.js):
 * column A names the line, column B says it, and each round, event or test is
 * a heading row. A dossier is one candidate — read top to bottom, like the
 * HTML — so no sheet runs sideways, not even the scorecards, which used to be
 * one row per round × skill with the round repeated on every row and the
 * interviewer's written comments left out altogether.
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
  const hasValue = (v) => v !== null && v !== undefined && v !== '';
  const addSheet = (rows, name) => {
    const sheet = XLSX.utils.aoa_to_sheet(toFieldValueAoa(rows.filter((r) => hasValue(r.value) || r.keep)));
    sheet['!cols'] = [{ wch: 40 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(book, sheet, name);
  };

  // --- Sheet 1: Summary ------------------------------------------------------
  const summary = [];
  const add = (section, field, value, keep = false) => summary.push({ section, field, value: cell(value), keep });
  add('Dossier', 'Candidate', model.candidate.name);
  add('Dossier', 'Position', model.candidate.position);
  add('Dossier', 'Requisition', model.candidate.mrf_ref);
  add('Dossier', 'Prepared by', model.generated.by);
  add('Dossier', 'Prepared on', formatDateTime(model.generated.at));
  add('Dossier', 'Application status', model.status.headline);
  // Profile and position keep their empty fields: "we don't know" must read
  // differently from "the dossier left it out" (pickCvProfile's rule).
  for (const f of model.profile) add('Candidate profile', f.label, f.value, true);
  for (const f of model.position) add('Position', f.label, f.value, true);
  if (model.scorecard_overall) {
    add('Scores', 'Rounds scored', model.scorecard_overall.rounds_scored);
    add('Scores', 'Average score', model.scorecard_overall.average);
    add('Scores', 'Scorecards outstanding', model.scorecard_overall.outstanding);
  }
  if (model.consolidated_feedback) add('Feedback', 'Consolidated interviewer feedback', model.consolidated_feedback);
  // Recording links belong in the spreadsheet too: "Spreadsheet only" is one of
  // the three formats, and a recruiter who picks it must not silently lose the
  // one thing in the pack that lets an interviewer watch the round. Only linked
  // recordings are listed — an unlinked one has nothing to put in the cell.
  for (const r of model.recordings.filter((rec) => rec.share_url)) {
    add(
      'Interview recordings',
      `${r.stage_label}${r.share_expires_at ? ` (link expires ${formatDate(r.share_expires_at)})` : ''}`,
      r.share_url,
    );
  }
  addSheet(summary, 'Summary');

  // --- Sheet 2: Scorecards, one block per round ------------------------------
  const cards = [];
  const notesByStage = new Map((model.round_notes || []).map((n) => [n.stage_key, n]));
  const notesPrinted = new Set();
  // The heading is the round alone (headings print in capitals, which an email
  // address must not); a round scored by several interviewers is numbered so
  // each scorecard stays its own block.
  const roundKey = (c) => c.stage_key || c.stage_label;
  const perStage = new Map();
  for (const c of model.scorecards) perStage.set(roundKey(c), (perStage.get(roundKey(c)) || 0) + 1);
  const seenStage = new Map();
  for (const c of model.scorecards) {
    const n = (seenStage.get(roundKey(c)) || 0) + 1;
    seenStage.set(roundKey(c), n);
    const section = `${c.stage_label}${perStage.get(roundKey(c)) > 1 ? ` (${n})` : ''}${c.earlier_attempt ? ' — earlier attempt' : ''}`;
    const line = (field, value) => cards.push({ section, field, value: cell(value) });
    line('Interviewer', c.interviewer);
    line('Submitted', c.submitted_at ? formatDate(c.submitted_at) : null);
    line('Recommendation', c.recommendation);
    line('Average score', c.avg_score);
    line('Overall rating', c.final_rating);
    line('Communication', c.communication);
    line('Attitude', c.attitude);
    for (const s of c.skills) {
      line(s.label || 'Skill', [cell(s.rating), cell(s.remark)].filter(Boolean).join(' · '));
    }
    line('Comments', c.comments);
    if (c.hr_round) {
      line('Strengths', c.hr_round.strengths);
      line('Areas of concern', c.hr_round.weakness);
      line('Communication (HR)', c.hr_round.communication_comments);
      line('Attitude (HR)', c.hr_round.attitude_comments);
      line('Relocation', c.hr_round.relocation);
      line('Notice period', c.hr_round.notice_period);
      line('Other observations', c.hr_round.other_observation);
      line('Final feedback', c.hr_round.final_feedback);
    }
    const notes = notesByStage.get(c.stage_key);
    if (notes && !c.earlier_attempt && !notesPrinted.has(c.stage_key)) {
      notesPrinted.add(c.stage_key);
      line('Round feedback recorded in the ATS', notes.value);
    }
  }
  for (const n of model.round_notes || []) {
    if (notesPrinted.has(n.stage_key)) continue;
    cards.push({ section: n.stage_label, field: 'Round feedback recorded in the ATS', value: cell(n.value) });
  }
  for (const p of model.scorecards_pending) {
    cards.push({ section: 'Still awaited', field: p.stage_label, value: cell(p.interviewer) || 'Awaiting the scorecard', keep: true });
  }
  addSheet(cards, 'Scorecards');

  // --- Sheet 3: Stage history, one block per decision ------------------------
  const stages = [];
  model.stages.forEach((s, i) => {
    // Numbered so two identical decisions (a stage re-done) stay separate blocks.
    const section = `${i + 1}. ${s.stage_label} — ${s.outcome || eventLabel(s.event_type)}`;
    stages.push({ section, field: 'What happened', value: eventLabel(s.event_type) });
    stages.push({ section, field: 'Reason / note', value: cell(s.reason || s.notes) });
    stages.push({ section, field: 'Decided by', value: cell(s.decided_by) });
    stages.push({ section, field: 'When', value: formatDateTime(s.decided_at) });
  });
  addSheet(stages, 'Stage History');

  // --- Sheet 4: Assessments (Zeko + Evalground), one block per test ----------
  const assess = [];
  for (const z of model.zeko) {
    const section = `AI screening · ${z.round}`;
    const line = (field, value) => assess.push({ section, field, value: cell(value) });
    line('Overall', z.overall_score);
    line('Technical', z.technical_score);
    line('Communication', z.communication_score);
    line('Taken on', z.taken_at ? formatDate(z.taken_at) : null);
    // Carried in the spreadsheet too: "Spreadsheet only" is one of the three
    // formats, and a recruiter who picks it should not silently lose either the
    // assessment or the link to the full report.
    const d = z.report_detail;
    if (d) {
      line('Verdict', d.verdict);
      if (d.parameters_total) line('Requirements met', `${d.parameters_met} of ${d.parameters_total}`);
      for (const p of d.parameters) {
        line(
          `Requirement — ${p.name}${p.required ? ' (must-have)' : ''}`,
          `${p.met ? 'Met' : 'Not met'}${p.answer ? ` — ${p.answer}` : ''}`,
        );
      }
      for (const s of d.soft_skills) {
        line(`Communication — ${s.area}`, s.assessed ? cell(s.rating) : 'Not assessed');
      }
    }
    if (z.report_link) line('Full report link', z.report_link);
  }
  for (const a of model.assessments) {
    const section = `Assessment · ${a.test_name}`;
    const line = (field, value) => assess.push({ section, field, value: cell(value) });
    for (const s of a.sections) line(cell(s.label), s.score);
    if (a.overall_percentage !== null) line('Overall %', a.overall_percentage);
    line('Result', a.result);

    // Carried in the spreadsheet too: "Spreadsheet only" is one of the three
    // formats, and a recruiter who picks it should not silently lose the
    // breakdown that section 7 of the report carries.
    const d = a.detail;
    if (!d) continue;
    line('Taken on', d.started_on);
    line('Time taken', d.duration);
    line('Total correct', d.totals?.correct);
    line('Total wrong', d.totals?.wrong);
    line('Total unattempted', d.totals?.unattempted);
    for (const s of d.sections) {
      line(`${s.label} — correct / wrong / unattempted`, `${s.correct ?? '—'} / ${s.wrong ?? '—'} / ${s.unattempted ?? '—'}`);
      if (s.easy_correct !== null || s.medium_correct !== null || s.hard_correct !== null) {
        line(`${s.label} — easy / medium / hard correct`, `${s.easy_correct ?? '—'} / ${s.medium_correct ?? '—'} / ${s.hard_correct ?? '—'}`);
      }
    }
    for (const t of d.topics) line(`Topic — ${t.label}`, t.value);
  }
  addSheet(assess, 'Assessments');

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
 * Kept to what the reader acts on: the files, the links that open without a
 * login (the one real disclosure in the pack), and the deletion request.
 *
 * @param {object} model
 * @returns {string}
 */
export function renderReadMe(model) {
  const days = config.dossier.deletionDays;
  const linkedRecordings = (model.recordings || []).filter((r) => r.share_url);
  const expiry = linkedRecordings.find((r) => r.share_expires_at)?.share_expires_at;
  const links = [
    ...(model.zeko?.some((z) => z.report_link) ? ['  - AI screening report'] : []),
    ...(linkedRecordings.length
      ? [`  - Interview recordings (${linkedRecordings.length})${expiry ? `, expire ${formatDate(expiry)}` : ''}`]
      : []),
  ];
  const lines = [
    'CANDIDATE DOSSIER — CONFIDENTIAL',
    '================================',
    '',
    `Candidate : ${text(model.candidate.name)}`,
    `Position  : ${text(model.candidate.position)}`,
    `Prepared  : ${formatDateTime(model.generated.at)} by ${text(model.generated.by)}`,
    '',
    'FILES',
    '-----',
    'Candidate-Dossier.html   The report. Opens in any browser; Ctrl+P saves a PDF.',
    'Candidate-Summary.xlsx   The same information as a spreadsheet.',
    ...(links.length
      ? ['', 'LINKS', '-----', 'These open WITHOUT a login. Do not forward.', ...links]
      : []),
    '',
    'PLEASE',
    '------',
    `Do not forward this pack. Delete it, and any copies, within ${days} days of the interview.`,
    'Questions: reply to the recruiter who sent it.',
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
