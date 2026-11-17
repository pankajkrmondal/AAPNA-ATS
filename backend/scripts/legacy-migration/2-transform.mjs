// Stage 1, step 3 of docs/Phase 4/PLAN-MS-Access-Data-Migration-Mapping.md (3.12).
// Maps the extracted Access rows onto rpa_cv columns, consolidates rows of the same
// person inside the file, and writes the dry-run report. NO DATABASE CONNECTION.
//
//   node scripts/legacy-migration/2-transform.mjs --work <work folder>
//
// Reads   <work>/manifest.json and <work>/raw/*.jsonl   (from 1-extract-access.ps1)
// Writes  <work>/transform/candidates.jsonl   one line per unique candidate (personal data)
//         <work>/transform/rows.jsonl         one line per source row: what happens to it
//         <work>/report/dry-run-report.md     counts only, no personal data
//         <work>/report/no-contact-details.xlsx   rows not imported (V11), for HR (personal data)
//         <work>/report/review-merged-names.xlsx  consolidated candidates whose rows carry different names (personal data)
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { parseExperienceNumeric, parseExpectedCTCNumeric, parseNoticePeriodDays } from '../../src/utils/candidateParser.js';
import {
  classifyHeader, normHeader, HYPER_TABLE, HYPER_POSITIONS, HYPER_HEADER_ROW_ID, EXTRA_COLUMNS,
  TABLE_DEFAULTS, RUN_ORDER, HISTORY_FIELDS, CV_FIELDS, NAME_ROW_REPAIR,
} from './lib/mapping.mjs';
import * as R from './lib/rules.mjs';

const argv = process.argv;
const work = argv[argv.indexOf('--work') + 1];
if (!argv.includes('--work') || !work) { console.error('Usage: node 2-transform.mjs --work <work folder>'); process.exit(2); }

const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
const missingOrder = manifest.tables.map((t) => t.table).filter((t) => !RUN_ORDER.includes(t));
if (missingOrder.length || manifest.tables.length !== RUN_ORDER.length) throw new Error(`Run order does not cover the extracted tables: ${missingOrder.join(', ')}`);
const today = new Date();

// ── 1. Map every row ────────────────────────────────────────────────────────
const stats = {}; // per table
const unmapped = {}; // table -> column -> rows with data
const allRows = [];
const warnAdd = (row, w) => { if (w) row.warnings.push(w); };

for (const t of manifest.tables) {
  const st = (stats[t.table] = { read: 0, blank: 0, rejected: 0, usable: 0, warnings: {}, defaultsRole: 0, defaultsSkills: 0 });
  const isHyper = t.table === HYPER_TABLE;
  const extras = EXTRA_COLUMNS[t.table] || {};
  const [defRole, defSkills] = TABLE_DEFAULTS[t.table];
  const lines = fs.readFileSync(path.join(work, 'raw', t.file), 'utf8').split('\n').filter(Boolean);
  // Name column one row out of place: work out the corrected name per row id (see NAME_ROW_REPAIR).
  const repair = NAME_ROW_REPAIR[t.table];
  const nameFix = new Map(); // row id -> { name, warn }
  if (repair) {
    const parsed = lines.map((l) => JSON.parse(l));
    if (parsed.length !== repair.rowCount || parsed.some((p, i) => p.id !== `r${i + 1}`)) throw new Error(`Name repair for "${t.table}" expects ${repair.rowCount} rows numbered r1.. in order; this extract differs. Nothing was written.`);
    const cellAt = (n) => R.text(parsed[n - 1]?.v?.[repair.column]).replace(/\s+/g, ' ');
    for (const [from, to] of repair.fromRowAbove) for (let n = from; n <= to; n++) nameFix.set(`r${n}`, { name: cellAt(n - 1), warn: 'name_from_row_above' });
    for (const n of repair.blank) nameFix.set(`r${n}`, { name: '', warn: 'name_unknown_row_before_repair' });
    for (const n of repair.review) nameFix.set(`r${n}`, { name: cellAt(n), warn: 'name_review_edge_of_repair' });
  }
  lines.forEach((line, idx) => {
    const src = JSON.parse(line);
    const row = { table: t.table, id: src.id, seq: idx, raw: src.v, f: {}, emails: [], phones: [], date: null, joined: false, warnings: [], status: 'usable' };
    st.read++;
    allRows.push(row);
    const cells = Object.entries(src.v).filter(([, c]) => R.text(c) !== '');
    if (cells.length === 0) { row.status = 'blank'; st.blank++; return; }
    const fix = nameFix.get(src.id);
    if (isHyper && src.id === HYPER_HEADER_ROW_ID) { row.status = 'blank'; row.warnings.push('header_row'); st.blank++; return; }

    const hrComments = []; const managerial = []; const ceo = []; const append = {};
    const f = row.f;
    const set = (field, value) => { if (value && !f[field]) f[field] = value; };
    for (const [col, cell] of cells) {
      let cls = extras[col] || null;
      let header = col;
      if (!cls && isHyper) { header = HYPER_POSITIONS[col] || col; cls = HYPER_POSITIONS[col] ? classifyHeader(header) : null; }
      if (!cls && !isHyper) cls = classifyHeader(col);
      if (!cls) {
        ((unmapped[t.table] ??= {})[col] ??= { rows: 0, maxLen: 0 }).rows++;
        unmapped[t.table][col].maxLen = Math.max(unmapped[t.table][col].maxLen, R.text(cell).length);
        continue;
      }
      const label = header.replace(/\s+/g, ' ').trim();
      switch (cls.kind) {
        case 'knownUnmapped': break;
        case 'hrComment': hrComments.push([label, R.text(cell)]); break;
        case 'managerial': managerial.push([label.replace(/^Magerial/, 'Managerial'), R.text(cell)]); break;
        case 'ceo': ceo.push([label, R.text(cell)]); break;
        case 'appendTo': (append[cls.field] ??= []).push(R.text(cell)); break;
        case 'uiuxCompany': set('CurrentCompany', R.uiuxCompany(cell)); break;
        case 'uiuxMarks': {
          const mk = R.uiuxMarks(cell);
          if (mk['10th'] || mk['12th'] || mk.Graduation || mk.PostGraduation) {
            set('a10th', mk['10th']); set('a12th', mk['12th']); set('graduation', mk.Graduation); set('postGraduation', mk.PostGraduation);
            const kept = Object.fromEntries(Object.entries(mk).filter(([, v]) => v));
            set('EducationalScoresPercentage', JSON.stringify(kept));
          } else warnAdd(row, 'marks_unreadable');
          break;
        }
        case 'score': { const r = R.cleanScore(cell, cls.den); set(cls.field, r.value); warnAdd(row, r.warn); break; }
        case 'direct': {
          let r;
          switch (cls.field) {
            case '_date': r = R.parseDate(cell, today); row.date = r.date; warnAdd(row, r.warn); break;
            case 'ContactNumber': r = R.parsePhones(cell); row.phones.push(...r.list); if (r.dropped) warnAdd(row, r.list.length ? 'phone_part_dropped' : 'phone_not_valid'); break;
            case 'EmailID': r = R.parseEmails(cell); row.emails.push(...r.list); if (r.dropped) warnAdd(row, r.list.length ? 'email_part_dropped' : 'email_not_valid'); break;
            case 'Name': set('Name', R.text(cell).replace(/\s+/g, ' ')); break;
            case 'TotalExperienceYears': r = R.cleanExperience(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'LastCompanyExperienceYears': r = R.cleanExperience(cell); set(cls.field, r.value); warnAdd(row, r.warn && r.warn.replace('experience', 'last_company')); break;
            case 'CTC_LPA': case 'ExpectedCTC_LPA': r = R.cleanCtc(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'NoticePeriod': r = R.cleanNotice(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'Heat': r = R.cleanHeat(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'FinalStatus': r = R.cleanStatus(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'JobSource': set(cls.field, R.cleanSource(cell)); break;
            case 'Gender': r = R.cleanGender(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'PositionApplied': r = R.cleanRole(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'HighestQualification': case 'RecruiterInfoAAPNA': set(cls.field, R.blankIfNa(cell)); break;
            default: set(cls.field, R.text(cell)); // long notes are copied in full
          }
          break;
        }
        default: throw new Error(`Unhandled mapping kind ${cls.kind}`);
      }
    }
    // Name taken from the row above (or left empty) where the Name column is one row out of place.
    if (fix) { if (fix.name) f.Name = fix.name; else delete f.Name; row.warnings.push(fix.warn); }
    // Joined columns.
    if (hrComments.length === 1) f.HRQuickcomments = hrComments[0][1];
    else if (hrComments.length > 1) f.HRQuickcomments = hrComments.map(([l, v]) => `${l}: ${v}`).join('\n');
    const mgmt = [...managerial, ...ceo];
    let mgmtText = '';
    if (mgmt.length === 1) mgmtText = mgmt[0][1];
    else if (mgmt.length > 1) mgmtText = mgmt.map(([l, v]) => `${l}: ${v}`).join('\n');
    if (mgmtText) f.ManagerialOrCEOFeedback = mgmtText;
    for (const [field, parts] of Object.entries(append)) f[field] = [f[field], ...parts].filter(Boolean).join('\n');

    row.emails = [...new Set(row.emails)];
    row.phones = [...new Set(row.phones)];
    row.joined = R.isJoined(f.FinalStatus);
    if (row.emails.length === 0 && row.phones.length === 0) { row.status = 'rejected'; st.rejected++; return; }
    if (!f.Name) warnAdd(row, 'name_missing');
    if (!f.PositionApplied && defRole) { f.PositionApplied = defRole; st.defaultsRole++; }
    if (!f.Top5KeySkills && defSkills) { f.Top5KeySkills = defSkills; st.defaultsSkills++; }
    if (!f.PositionApplied) warnAdd(row, 'role_missing');
    row.filled = Object.keys(f).length;
    st.usable++;
  });
  for (const row of allRows) if (row.table === t.table) for (const w of row.warnings) st.warnings[w] = (st.warnings[w] || 0) + 1;
}

// ── 2. Consolidate rows of the same person (any email or any phone in common) ──
// Same rule as the ATS duplicate matcher. Phones the ATS ignores for matching are ignored here too.
const usable = allRows.filter((r) => r.status === 'usable');
const parent = usable.map((_, i) => i);
const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
const keyOwner = new Map();
usable.forEach((r, i) => {
  const keys = [...r.emails.map((e) => `e:${e}`), ...r.phones.filter((p) => p !== '9876543210').map((p) => `p:${p}`)];
  for (const k of keys) {
    if (keyOwner.has(k)) { const a = find(i); const b = find(keyOwner.get(k)); if (a !== b) parent[a] = b; } else keyOwner.set(k, i);
  }
});
const groupsMap = new Map();
usable.forEach((r, i) => { const g = find(i); if (!groupsMap.has(g)) groupsMap.set(g, []); groupsMap.get(g).push(r); });

const orderOf = (table) => RUN_ORDER.indexOf(table);
const normCmp = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const conflicts = {}; // field -> groups where another row had a different value that was not used
const candidates = [];
let gid = 0;
for (const members of groupsMap.values()) {
  // Base = earliest date. Same date (snapshot copies of one sheet): the most complete row.
  members.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || b.filled - a.filled || orderOf(a.table) - orderOf(b.table) || a.seq - b.seq);
  const base = members[0];
  const fields = { ...base.f };
  const groupConflicts = new Set();
  for (const m of members.slice(1)) {
    for (const [k, v] of Object.entries(m.f)) {
      if (!fields[k]) fields[k] = v; // a filled field is never overwritten (3.3)
      else if (normCmp(fields[k]) !== normCmp(v)) groupConflicts.add(k);
    }
  }
  for (const k of groupConflicts) conflicts[k] = (conflicts[k] || 0) + 1;
  const emails = [...new Set(members.flatMap((m) => m.emails))];
  const phones = [...new Set(members.flatMap((m) => m.phones))];
  fields.EmailID = emails.join(', ');
  fields.ContactNumber = phones.join(', ');
  const loadTable = RUN_ORDER[Math.min(...members.map((m) => orderOf(m.table)))];
  const names = [...new Set(members.map((m) => normCmp(m.f.Name || '')).filter(Boolean))];
  gid++;
  const c = {
    gid, loadTable,
    base: { table: base.table, id: base.id },
    members: members.map((m) => ({ table: m.table, id: m.id })),
    fields,
    createdAt: base.date, // null = no date in Access: the import time is used
    numeric: {
      TotalExperienceYearsNumeric: parseExperienceNumeric(fields.TotalExperienceYears || null),
      ExpectedCTCNumeric: parseExpectedCTCNumeric(fields.ExpectedCTC_LPA || null),
      NoticePeriodDays: parseNoticePeriodDays(fields.NoticePeriod || null),
    },
    joined: members.some((m) => m.joined),
    conflicts: [...groupConflicts],
    differentNames: names.length > 1,
    warnings: [...new Set(members.flatMap((m) => m.warnings))],
  };
  // The numeric columns have limits: Decimal(5,2) and Decimal(10,2).
  if (c.numeric.TotalExperienceYearsNumeric !== null && !(c.numeric.TotalExperienceYearsNumeric >= 0 && c.numeric.TotalExperienceYearsNumeric < 100)) c.numeric.TotalExperienceYearsNumeric = null;
  if (c.numeric.ExpectedCTCNumeric !== null && !(c.numeric.ExpectedCTCNumeric >= 0 && c.numeric.ExpectedCTCNumeric < 10000)) c.numeric.ExpectedCTCNumeric = null;
  candidates.push(c);
  for (const m of members) { m.gid = gid; m.role = m === base ? 'base' : 'merged'; m.loadTable = loadTable; }
}

// ── 3. Write the outputs ─────────────────────────────────────────────────────
const tDir = path.join(work, 'transform'); const rDir = path.join(work, 'report');
fs.mkdirSync(tDir, { recursive: true }); fs.mkdirSync(rDir, { recursive: true });
fs.writeFileSync(path.join(tDir, 'candidates.jsonl'), candidates.map((c) => JSON.stringify(c)).join('\n') + '\n');
fs.writeFileSync(path.join(tDir, 'rows.jsonl'), allRows.map((r) => JSON.stringify({
  table: r.table, id: r.id, status: r.status, gid: r.gid ?? null, role: r.role ?? null,
  loadTable: r.loadTable ?? r.table, warnings: r.warnings, raw: r.raw,
})).join('\n') + '\n');

// Rows not imported because they have no email and no phone (V11): one list for HR.
const rejectedRows = allRows.filter((r) => r.status === 'rejected');
const rejSheet = rejectedRows.map((r) => {
  const o = { Table: r.table, 'Access row': r.id };
  for (const [col, cell] of Object.entries(r.raw)) { const v = R.text(cell); if (v) o[r.table === HYPER_TABLE ? (HYPER_POSITIONS[col] || col) : col] = v; }
  return o;
});
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rejSheet), 'No email and no phone');
XLSX.writeFile(wb, path.join(rDir, 'no-contact-details.xlsx'));

const nameRows = [];
for (const c of candidates.filter((x) => x.differentNames)) {
  for (const m of c.members) {
    const r = allRows.find((x) => x.table === m.table && x.id === m.id);
    nameRows.push({ Group: c.gid, Table: r.table, 'Access row': r.id, Name: r.f.Name || '', Emails: r.emails.join(', '), Phones: r.phones.join(', '), Date: r.date || '' });
  }
}
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(nameRows), 'Different names, one person');
// Rows at the edges of the name repair: HR should confirm these names.
const edgeRows = allRows.filter((r) => r.status === 'usable' && r.warnings.some((w) => w === 'name_unknown_row_before_repair' || w === 'name_review_edge_of_repair'))
  .map((r) => ({ Table: r.table, 'Access row': r.id, 'Name loaded': r.f.Name || '(left empty)', 'Name cell in Access': R.text(r.raw.Name), Emails: r.emails.join(', '), Phones: r.phones.join(', '), Why: r.warnings.includes('name_unknown_row_before_repair') ? 'Name cell holds the next person\'s name; own name not known' : 'Edge of the repaired rows; no evidence either way, name kept as in Access' }));
if (edgeRows.length) XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(edgeRows), 'Name repair, edge rows');
XLSX.writeFile(wb2, path.join(rDir, 'review-merged-names.xlsx'));

// Report: counts only.
const sum = (k) => Object.values(stats).reduce((a, s) => a + s[k], 0);
const L = [];
L.push('# MS Access migration: dry-run report (Stage 1, step 3)', '');
L.push(`- Source: \`${manifest.sourceFile}\`, extracted ${manifest.extractedAt}`);
L.push(`- Generated: ${today.toISOString().slice(0, 19)}Z. No database was read or written.`);
L.push('- This report holds counts only. Personal data is in the work folder, outside the repository.', '');
L.push('## Totals', '');
L.push('| | Rows |', '|---|---|');
L.push(`| Rows read from Access (28 tables) | ${sum('read')} |`);
L.push(`| Blank rows, skipped (V10) | ${sum('blank')} |`);
L.push(`| No email and no phone, not imported (V11) | ${sum('rejected')} |`);
L.push(`| Rows that become candidates | ${sum('usable')} |`);
L.push(`| Unique candidates after consolidation | ${candidates.length} |`);
L.push(`| Rows merged into another row of the same person | ${sum('usable') - candidates.length} |`);
L.push(`| Candidates with status Joined on any of their rows | ${candidates.filter((c) => c.joined).length} |`);
L.push(`| Candidates with no email (phone only): no search vector | ${candidates.filter((c) => !c.fields.EmailID).length} |`);
L.push(`| Candidates with no Access date: created date = import time | ${candidates.filter((c) => !c.createdAt).length} |`, '');
L.push('## Per table, in load order', '');
L.push('"Loaded in this run" counts candidates whose first table in the load order is this one. A candidate who also appears in a later table is loaded once, here.', '');
L.push('| # | Table | Rows read | Blank | No contact | Candidate rows | Candidates loaded in this run | Rows merged in this run | Default role used | Default skills used |', '|---|---|---|---|---|---|---|---|---|---|');
RUN_ORDER.forEach((t, i) => {
  const s = stats[t]; const cs = candidates.filter((c) => c.loadTable === t);
  const merged = cs.reduce((a, c) => a + c.members.length - 1, 0);
  L.push(`| ${i + 1} | ${t} | ${s.read} | ${s.blank} | ${s.rejected} | ${s.usable} | ${cs.length} | ${merged} | ${s.defaultsRole} | ${s.defaultsSkills} |`);
});
L.push('', '## Columns that hold data and are not mapped', '');
const un = Object.entries(unmapped);
if (un.length === 0) L.push('None.');
else {
  L.push('These are not covered by the plan. Their values stay in the provenance raw row and are not written to `rpa_cv`.', '', '| Table | Column | Rows with data | Longest value (characters) |', '|---|---|---|---|');
  for (const [t, cols] of un) for (const [c, v] of Object.entries(cols)) L.push(`| ${t} | \`${c}\` | ${v.rows} | ${v.maxLen} |`);
}
L.push('', '## Value-rule warnings (rows)', '');
const wAll = {};
for (const s of Object.values(stats)) for (const [w, n] of Object.entries(s.warnings)) wAll[w] = (wAll[w] || 0) + n;
L.push('| Warning | Rows | Tables with the most |', '|---|---|---|');
for (const [w, n] of Object.entries(wAll).sort((a, b) => b[1] - a[1])) {
  const top = Object.entries(stats).filter(([, s]) => s.warnings[w]).sort((a, b) => b[1].warnings[w] - a[1].warnings[w]).slice(0, 3).map(([t, s]) => `${t} ${s.warnings[w]}`).join('; ');
  L.push(`| ${w} | ${n} | ${top} |`);
}
L.push('', '## Consolidation', '');
const sizes = {};
for (const c of candidates) { const k = c.members.length >= 6 ? '6 or more' : String(c.members.length); sizes[k] = (sizes[k] || 0) + 1; }
L.push('| Rows per candidate | Candidates |', '|---|---|');
for (const k of ['1', '2', '3', '4', '5', '6 or more']) if (sizes[k]) L.push(`| ${k} | ${sizes[k]} |`);
L.push('', `- Largest consolidated candidate: ${Math.max(...candidates.map((c) => c.members.length))} rows.`);
L.push(`- Candidates whose rows carry different names (shared email or phone): ${candidates.filter((c) => c.differentNames).length}. Listed in \`review-merged-names.xlsx\`.`);
L.push('', 'Fields where another row of the same person held a different value that was not used (the base row keeps its value):', '', '| Field | Candidates |', '|---|---|');
for (const [k, n] of Object.entries(conflicts).sort((a, b) => b[1] - a[1])) L.push(`| ${k}${HISTORY_FIELDS.includes(k) ? ' (history)' : ''} | ${n} |`);
L.push('', '## Field fill after mapping (unique candidates)', '', '| rpa_cv column | Candidates with a value |', '|---|---|');
for (const k of CV_FIELDS) L.push(`| ${k} | ${candidates.filter((c) => c.fields[k]).length} |`);
L.push(`| TotalExperienceYearsNumeric | ${candidates.filter((c) => c.numeric.TotalExperienceYearsNumeric !== null).length} |`);
L.push(`| ExpectedCTCNumeric | ${candidates.filter((c) => c.numeric.ExpectedCTCNumeric !== null).length} |`);
L.push(`| NoticePeriodDays | ${candidates.filter((c) => c.numeric.NoticePeriodDays !== null).length} |`);
fs.writeFileSync(path.join(rDir, 'dry-run-report.md'), L.join('\n') + '\n');

console.log(L.slice(5, 18).join('\n'));
console.log(`\nUnmapped columns with data: ${un.reduce((a, [, c]) => a + Object.keys(c).length, 0)}`);
console.log(`Report: ${path.join(rDir, 'dry-run-report.md')}`);
void normHeader;
