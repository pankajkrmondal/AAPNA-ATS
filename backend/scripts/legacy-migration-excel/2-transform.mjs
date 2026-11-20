// Stage 2, transform and dry-run report. docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, 4.2-4.4.
// Maps the extracted Excel rows onto rpa_cv columns, consolidates rows of the same person
// across all Excel files, and writes the dry-run report. NO DATABASE CONNECTION.
//
//   cd backend
//   node scripts/legacy-migration-excel/2-transform.mjs --work "<work folder>" [--access-work "<Stage 1 work folder>"]
//
// Reads   <work>/manifest.json and <work>/raw/*.jsonl   (from 1-extract-excel.mjs)
//         --access-work (optional, read-only): the Stage 1 transform, only to COUNT how many Excel
//         people are also in MS Access (they will match a candidate already in the ATS).
// Writes  <work>/transform/units.json          the sheets in load order, with their defaults
//         <work>/transform/candidates.jsonl    one line per unique candidate (personal data)
//         <work>/transform/rows.jsonl          one line per source row: what happens to it (personal data)
//         <work>/report/dry-run-report.md      counts only, no personal data
//         <work>/report/no-contact-details.xlsx       rows not imported (V11), for HR (personal data)
//         <work>/report/review-merged-names.xlsx      one person, different names (personal data)
//         <work>/report/review-shared-contacts.xlsx   contacts shared by more than 3 names (personal data)
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { parseExpectedCTCNumeric, parseNoticePeriodDays } from '../../src/utils/candidateParser.js';
import * as R from '../legacy-migration/lib/rules.mjs';
import * as L from './lib/layouts.mjs';
import * as N from './lib/naukri-rules.mjs';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const work = arg('--work'); const accessWork = arg('--access-work');
if (!work) { console.error('Usage: node 2-transform.mjs --work <work folder> [--access-work <Stage 1 work folder>]'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8'));
const today = new Date();

// ── 0. Refuse what is not agreed ────────────────────────────────────────────
const stops = [];
for (const u of manifest.units) {
  if (!u.layout) stops.push(`${u.unit}: header set never seen before (plan 4.3: agree a mapping first)`);
  if (!u.countsMatch) stops.push(`${u.unit}: the two row counts differ (${u.sheetNonBlankRows} vs ${u.secondCount})`);
  u.defaults = L.fileDefaults(u.layout, u.file);
  if (!u.defaults) stops.push(`${u.unit}: no default role for this file name (add it to lib/layouts.mjs)`);
  u.jobSource = L.jobSourceOf(u.layout, u.file);
  if (u.jobSource === undefined) stops.push(`${u.unit}: Naukri folder without a year (decision S11)`);
}
for (const s of manifest.skipped.filter((x) => x.needsDecision)) stops.push(`${s.file} | ${s.sheet}: ${s.reason}`);
if (stops.length) { console.error(`STOPPED. Nothing was written.\n  ${stops.join('\n  ')}`); process.exit(1); }

// ── 1. Map every row ────────────────────────────────────────────────────────
const stats = {}; const unmapped = {}; const questions = {}; const allRows = [];
const warnAdd = (row, w) => { if (w) row.warnings.push(w); };
const isEmail = (s) => R.parseEmails(['s', s]).list.length > 0;

for (const u of manifest.units) {
  const st = (stats[u.n] = { read: 0, blank: 0, rejected: 0, usable: 0, warnings: {}, defaultsRole: 0, defaultsSkills: 0, years: [] });
  const tx = u.layout === 'A' ? N.text : N.blank; // Layout A keeps Stage 1's behaviour; Naukri blanks "NA"
  const lines = fs.readFileSync(path.join(work, 'raw', u.rawFile), 'utf8').split('\n').filter(Boolean);
  lines.forEach((line, idx) => {
    const src = JSON.parse(line);
    const row = { unit: u.n, id: src.id, seq: idx, raw: src.v, f: {}, emails: [], phones: [], date: null, joined: false, warnings: [], status: 'usable' };
    st.read++; allRows.push(row);
    let cells = Object.entries(src.v).filter(([, c]) => N.text(c) !== '');
    if (cells.length === 0) { row.status = 'blank'; st.blank++; return; }

    // Layout D: in some rows the email sits in the position column and the position in the email column.
    if (u.layout === 'D') {
      const get = (k) => cells.find(([c]) => L.normHeader(c) === k);
      const em = get('email id'); const pos = get('intership/position applied for');
      if (pos && isEmail(N.text(pos[1])) && !(em && isEmail(N.text(em[1])))) {
        cells = cells.filter((c) => c !== em && c !== pos);
        cells.push([em ? em[0] : 'Email ID', pos[1]]);
        if (em) cells.push([pos[0], em[1]]);
        row.warnings.push('email_and_position_swapped');
      }
    }

    const hrComments = []; const managerial = []; const ceo = []; const append = {}; const deg = {}; const ans = {};
    const f = row.f;
    const set = (field, value) => { if (value && !f[field]) f[field] = value; };
    for (const [col, cell] of cells) {
      const cls = L.classifyHeader(u.layout, col);
      if (!cls) {
        const e = ((unmapped[u.n] ??= {})[col] ??= { rows: 0, maxLen: 0 });
        e.rows++; e.maxLen = Math.max(e.maxLen, N.text(cell).length);
        continue;
      }
      const label = col.replace(/\s+/g, ' ').trim();
      switch (cls.kind) {
        case 'knownUnmapped': break;
        case 'hrComment': { const v = tx(cell); if (v) hrComments.push([label, v]); break; }
        case 'managerial': managerial.push([label.replace(/^Magerial/, 'Managerial'), N.text(cell)]); break;
        case 'ceo': ceo.push([label, N.text(cell)]); break;
        case 'appendTo': (append[cls.field] ??= []).push(N.text(cell)); break;
        case 'score': { const r = R.cleanScore(cell, cls.den); set(cls.field, r.value); warnAdd(row, r.warn); break; }
        case 'date': { const r = N.parseDate(cell, today); row.date = r.date; warnAdd(row, r.warn); break; }
        case 'email': { const r = R.parseEmails(N.unlessNa(cell)); row.emails.push(...r.list); if (r.dropped) warnAdd(row, r.list.length ? 'email_part_dropped' : 'email_not_valid'); break; }
        case 'phone': { const r = R.parsePhones(N.unlessNa(cell)); row.phones.push(...r.list); if (r.dropped) warnAdd(row, r.list.length ? 'phone_part_dropped' : 'phone_not_valid'); break; }
        case 'jobTitle': set('PositionApplied', N.jobTitleRole(cell)); break;
        case 'ug': case 'ugSpec': case 'pg': case 'pgSpec': case 'postPg': case 'doctorate': deg[cls.kind] = N.blank(cell); break;
        case 'ans': {
          if (!cls.target) { const q = ((questions[u.n] ??= {})[cls.question] ??= { target: null, rows: 0 }); if (N.blank(cell)) q.rows++; break; }
          ((questions[u.n] ??= {})[cls.question] ??= { target: cls.target, rows: 0 });
          if (N.blank(cell)) { questions[u.n][cls.question].rows++; ans[cls.target] = { q: cls.question, cell }; }
          break;
        }
        case 'direct': {
          let r;
          switch (cls.field) {
            case '_date': r = N.parseDate(cell, today); row.date = r.date; warnAdd(row, r.warn); break;
            case 'ContactNumber': r = R.parsePhones(N.unlessNa(cell)); row.phones.push(...r.list); if (r.dropped) warnAdd(row, r.list.length ? 'phone_part_dropped' : 'phone_not_valid'); break;
            case 'EmailID': r = R.parseEmails(N.unlessNa(cell)); row.emails.push(...r.list); if (r.dropped) warnAdd(row, r.list.length ? 'email_part_dropped' : 'email_not_valid'); break;
            case 'Name': set('Name', N.name(cell)); break;
            case 'TotalExperienceYears':
              r = u.layout === 'A' ? R.cleanExperience(cell) : N.experience(cell);
              set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'LastCompanyExperienceYears': r = R.cleanExperience(cell); set(cls.field, r.value); warnAdd(row, r.warn && r.warn.replace('experience', 'last_company')); break;
            case 'CTC_LPA': case 'ExpectedCTC_LPA': r = u.layout === 'A' ? R.cleanCtc(cell) : N.ctc(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'NoticePeriod': r = u.layout === 'A' ? R.cleanNotice(cell) : N.notice(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'Heat': r = R.cleanHeat(cell); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'FinalStatus': r = R.cleanStatus(N.asCell(cell)); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'JobSource': set(cls.field, R.cleanSource(cell)); break;
            case 'Gender': r = R.cleanGender(N.asCell(cell)); set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'PositionApplied': r = R.cleanRole(N.asCell(cell)); if (isEmail(r.value)) r = { value: '', warn: 'role_cell_rejected' }; set(cls.field, r.value); warnAdd(row, r.warn); break;
            case 'HighestQualification': case 'RecruiterInfoAAPNA': set(cls.field, R.blankIfNa(cell)); break;
            default: set(cls.field, tx(cell)); // long notes are copied in full
          }
          break;
        }
        default: throw new Error(`Unhandled mapping kind ${cls.kind}`);
      }
    }
    // Joined columns (as Stage 1).
    if (hrComments.length === 1) f.HRQuickcomments = hrComments[0][1];
    else if (hrComments.length > 1) f.HRQuickcomments = hrComments.map(([l, v]) => `${l}: ${v}`).join('\n');
    const mgmt = [...managerial, ...ceo];
    if (mgmt.length === 1) f.ManagerialOrCEOFeedback = mgmt[0][1];
    else if (mgmt.length > 1) f.ManagerialOrCEOFeedback = mgmt.map(([l, v]) => `${l}: ${v}`).join('\n');
    for (const [field, parts] of Object.entries(append)) f[field] = [f[field], ...parts].filter(Boolean).join('\n');
    // Screening answers (layout C) fill only what the row's own columns left empty.
    if (ans.CTC_LPA && !f.CTC_LPA) { const r = N.ctc(ans.CTC_LPA.cell); set('CTC_LPA', r.value); warnAdd(row, r.warn); }
    if (ans.ExpectedCTC_LPA) { const r = N.ctc(ans.ExpectedCTC_LPA.cell); set('ExpectedCTC_LPA', r.value); warnAdd(row, r.warn); }
    if (ans.NoticePeriod && !f.NoticePeriod) { const r = N.notice(ans.NoticePeriod.cell); set('NoticePeriod', r.value); }
    if (ans.EnglishCommunicationRating) set('EnglishCommunicationRating', N.blank(ans.EnglishCommunicationRating.cell));
    if (ans.PreferredShift) set('PreferredShift', N.shiftAnswer(ans.PreferredShift.q, ans.PreferredShift.cell));
    // Degrees: the columns as given; HighestQualification = the highest one present.
    set('graduationdegree', deg.ug); set('graduationspecialization', deg.ugSpec);
    set('postgraduationdegree', deg.pg); set('postgraduationspecialization', deg.pgSpec);
    set('HighestQualification', deg.doctorate || deg.postPg || deg.pg || deg.ug);
    if (u.jobSource) f.JobSource = u.jobSource; // decision S11: "Naukri <year>"

    row.emails = [...new Set(row.emails)];
    row.phones = [...new Set(row.phones)];
    row.joined = R.isJoined(f.FinalStatus);
    if (row.date) st.years.push(row.date.slice(0, 4));
    if (row.emails.length === 0 && row.phones.length === 0) { row.status = 'rejected'; st.rejected++; return; }
    st.usable++;
  });
}

// ── 2. Shared-contact guard (plan 3.1): a contact seen with more than 3 different names ──
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const namesByKey = new Map();
const keysOf = (r) => [...r.emails.map((e) => `e:${e}`), ...r.phones.filter((p) => p !== '9876543210').map((p) => `p:${p}`)];
for (const r of allRows.filter((x) => x.status === 'usable')) {
  const n = normName(r.f.Name);
  if (!n) continue;
  for (const k of keysOf(r)) { if (!namesByKey.has(k)) namesByKey.set(k, new Set()); namesByKey.get(k).add(n); }
}
const shared = new Set([...namesByKey].filter(([, s]) => s.size > 3).map(([k]) => k));
for (const r of allRows.filter((x) => x.status === 'usable')) {
  const before = r.emails.length + r.phones.length;
  r.emails = r.emails.filter((e) => !shared.has(`e:${e}`));
  r.phones = r.phones.filter((p) => !shared.has(`p:${p}`));
  if (r.emails.length + r.phones.length < before) r.warnings.push('shared_contact_removed');
  if (r.emails.length === 0 && r.phones.length === 0) { r.status = 'rejected'; r.warnings.push('only_shared_contacts'); stats[r.unit].usable--; stats[r.unit].rejected++; }
}
// Defaults (R5) and the counters, now that the final status is known.
const unitByN = new Map(manifest.units.map((u) => [u.n, u]));
for (const r of allRows.filter((x) => x.status === 'usable')) {
  const st = stats[r.unit]; const [defRole, defSkills] = unitByN.get(r.unit).defaults;
  if (!r.f.Name) warnAdd(r, 'name_missing');
  if (!r.f.PositionApplied && defRole) { r.f.PositionApplied = defRole; st.defaultsRole++; }
  if (!r.f.Top5KeySkills && defSkills) { r.f.Top5KeySkills = defSkills; st.defaultsSkills++; }
  if (!r.f.PositionApplied) warnAdd(r, 'role_missing');
  r.filled = Object.keys(r.f).length;
}
for (const r of allRows) for (const w of r.warnings) stats[r.unit].warnings[w] = (stats[r.unit].warnings[w] || 0) + 1;

// ── 3. Load order: layouts A, D, B, C; inside a layout the oldest data first (R8) ──
const minYear = (n) => (stats[n].years.length ? stats[n].years.reduce((a, b) => (a < b ? a : b)) : '9999');
const units = [...manifest.units].sort((a, b) => L.LAYOUT_ORDER.indexOf(a.layout) - L.LAYOUT_ORDER.indexOf(b.layout)
  || minYear(a.n).localeCompare(minYear(b.n)) || a.file.localeCompare(b.file, 'en') || a.sheet.localeCompare(b.sheet, 'en'));
units.forEach((u, i) => { u.order = i + 1; });
const orderOf = (n) => unitByN.get(n).order;

// ── 4. Consolidate rows of the same person (any email or phone in common) ──
const usable = allRows.filter((r) => r.status === 'usable');
const parent = usable.map((_, i) => i);
const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
const keyOwner = new Map();
usable.forEach((r, i) => {
  for (const k of keysOf(r)) {
    if (keyOwner.has(k)) { const a = find(i); const b = find(keyOwner.get(k)); if (a !== b) parent[a] = b; } else keyOwner.set(k, i);
  }
});
const groupsMap = new Map();
usable.forEach((r, i) => { const g = find(i); if (!groupsMap.has(g)) groupsMap.set(g, []); groupsMap.get(g).push(r); });
const normCmp = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const conflicts = {}; const candidates = []; let gid = 0;
for (const members of groupsMap.values()) {
  // Base = earliest date; same date: the most complete row; then load order.
  members.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || b.filled - a.filled || orderOf(a.unit) - orderOf(b.unit) || a.seq - b.seq);
  const base = members[0];
  const fields = { ...base.f }; const groupConflicts = new Set();
  for (const m of members.slice(1)) for (const [k, v] of Object.entries(m.f)) {
    if (!fields[k]) fields[k] = v; // a filled field is never overwritten
    else if (normCmp(fields[k]) !== normCmp(v)) groupConflicts.add(k);
  }
  for (const k of groupConflicts) conflicts[k] = (conflicts[k] || 0) + 1;
  const emails = [...new Set(members.flatMap((m) => m.emails))];
  const phones = [...new Set(members.flatMap((m) => m.phones))];
  fields.EmailID = emails.join(', ');
  fields.ContactNumber = phones.join(', ');
  const loadUnit = members.map((m) => m.unit).sort((a, b) => orderOf(a) - orderOf(b))[0];
  const names = [...new Set(members.map((m) => normCmp(m.f.Name || '')).filter(Boolean))];
  gid++;
  const c = {
    gid, loadUnit, base: { unit: base.unit, id: base.id }, members: members.map((m) => ({ unit: m.unit, id: m.id })), fields,
    createdAt: base.date, // null = no date in the file: the import time is used
    numeric: {
      TotalExperienceYearsNumeric: N.experienceNumeric(fields.TotalExperienceYears || null),
      ExpectedCTCNumeric: parseExpectedCTCNumeric(fields.ExpectedCTC_LPA || null),
      NoticePeriodDays: parseNoticePeriodDays(fields.NoticePeriod || null),
    },
    joined: members.some((m) => m.joined), conflicts: [...groupConflicts], differentNames: names.length > 1,
    warnings: [...new Set(members.flatMap((m) => m.warnings))],
  };
  // The numeric columns have limits: Decimal(5,2) and Decimal(10,2).
  if (c.numeric.TotalExperienceYearsNumeric !== null && !(c.numeric.TotalExperienceYearsNumeric >= 0 && c.numeric.TotalExperienceYearsNumeric < 100)) c.numeric.TotalExperienceYearsNumeric = null;
  if (c.numeric.ExpectedCTCNumeric !== null && !(c.numeric.ExpectedCTCNumeric >= 0 && c.numeric.ExpectedCTCNumeric < 10000)) c.numeric.ExpectedCTCNumeric = null;
  candidates.push(c);
  for (const m of members) { m.gid = gid; m.role = m === base ? 'base' : 'merged'; m.loadUnit = loadUnit; }
}

// ── 5. Write the outputs ─────────────────────────────────────────────────────
const tDir = path.join(work, 'transform'); const rDir = path.join(work, 'report');
fs.mkdirSync(tDir, { recursive: true }); fs.mkdirSync(rDir, { recursive: true });
fs.writeFileSync(path.join(tDir, 'units.json'), JSON.stringify(units.map((u) => ({
  n: u.n, order: u.order, unit: u.unit, file: u.file, sheet: u.sheet, layout: u.layout, defaults: u.defaults, jobSource: u.jobSource, sourceCount: u.sourceCount,
})).sort((a, b) => a.order - b.order), null, 2));
fs.writeFileSync(path.join(tDir, 'candidates.jsonl'), candidates.map((c) => JSON.stringify(c)).join('\n') + '\n');
fs.writeFileSync(path.join(tDir, 'rows.jsonl'), allRows.map((r) => JSON.stringify({
  unit: r.unit, id: r.id, status: r.status, gid: r.gid ?? null, role: r.role ?? null, loadUnit: r.loadUnit ?? r.unit, warnings: r.warnings, raw: r.raw,
})).join('\n') + '\n');

const unitLabel = (n) => { const u = unitByN.get(n); return `${u.file.split(/[\\/]/).pop()} › ${u.sheet}`; };
const rawText = (r) => Object.fromEntries(Object.entries(r.raw).map(([k, c]) => [k, N.text(c)]).filter(([, v]) => v));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows.filter((r) => r.status === 'rejected')
  .map((r) => ({ File: unitByN.get(r.unit).file, Sheet: unitByN.get(r.unit).sheet, 'Excel row': r.id, Why: r.warnings.includes('only_shared_contacts') ? 'Only contact is shared by more than 3 names' : 'No valid email and no valid phone', ...rawText(r) }))), 'Not imported');
XLSX.writeFile(wb, path.join(rDir, 'no-contact-details.xlsx'));
const nameRows = [];
for (const c of candidates.filter((x) => x.differentNames)) for (const m of c.members) {
  const r = allRows.find((x) => x.unit === m.unit && x.id === m.id);
  nameRows.push({ Group: c.gid, File: unitByN.get(r.unit).file, Sheet: unitByN.get(r.unit).sheet, 'Excel row': r.id, Name: r.f.Name || '', Emails: r.emails.join(', '), Phones: r.phones.join(', '), Date: r.date || '' });
}
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(nameRows), 'Different names, one person');
XLSX.writeFile(wb2, path.join(rDir, 'review-merged-names.xlsx'));
const wb3 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb3, XLSX.utils.json_to_sheet([...shared].map((k) => ({ Contact: k.slice(2), Kind: k[0] === 'e' ? 'email' : 'phone', 'Different names': namesByKey.get(k).size, Names: [...namesByKey.get(k)].join('; ') }))), 'Shared contacts');
XLSX.writeFile(wb3, path.join(rDir, 'review-shared-contacts.xlsx'));

// Optional, read-only: how many Excel people are also in the MS Access import (Stage 1 transform).
let accessOverlap = null;
if (accessWork) {
  const aKeys = new Set();
  for (const l of fs.readFileSync(path.join(accessWork, 'transform', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const c = JSON.parse(l);
    for (const e of String(c.fields.EmailID || '').split(',').map((x) => x.trim()).filter(Boolean)) aKeys.add(`e:${e}`);
    for (const p of String(c.fields.ContactNumber || '').split(',').map((x) => x.trim()).filter(Boolean)) aKeys.add(`p:${p}`);
  }
  accessOverlap = {};
  for (const c of candidates) {
    const hit = [...c.fields.EmailID.split(', ').filter(Boolean).map((e) => `e:${e}`), ...c.fields.ContactNumber.split(', ').filter(Boolean).map((p) => `p:${p}`)].some((k) => aKeys.has(k));
    if (hit) accessOverlap[c.loadUnit] = (accessOverlap[c.loadUnit] || 0) + 1;
  }
}

// Report: counts only.
const sum = (k) => Object.values(stats).reduce((a, s) => a + s[k], 0);
const Lr = [];
Lr.push('# Excel and Naukri migration: dry-run report (Stage 2)', '');
Lr.push(`- Source folder: \`${manifest.sourceRoot}\`, extracted ${manifest.extractedAt} with ${manifest.tool}`);
Lr.push(`- Generated: ${today.toISOString().slice(0, 19)}Z. No database was read or written.`);
Lr.push('- This report holds counts and column names only. Personal data is in the work folder, outside the repository.', '');
Lr.push('## Totals', '', '| | Rows |', '|---|---|');
Lr.push(`| Sheets loaded / skipped | ${manifest.units.length} / ${manifest.skipped.length} |`);
Lr.push(`| Rows read below the header rows | ${sum('read')} |`);
Lr.push(`| Blank rows, skipped (V10) | ${sum('blank')} |`);
Lr.push(`| Not imported: no valid email and no valid phone (V11), or only shared contacts | ${sum('rejected')} |`);
Lr.push(`| Rows that become candidates | ${sum('usable')} |`);
Lr.push(`| Unique candidates after consolidation | ${candidates.length} |`);
Lr.push(`| Rows merged into another row of the same person | ${sum('usable') - candidates.length} |`);
if (accessOverlap) Lr.push(`| Candidates who are also in the MS Access import (expected to match an existing ATS candidate) | ${Object.values(accessOverlap).reduce((a, b) => a + b, 0)} |`);
Lr.push(`| Candidates with status Joined on any of their rows | ${candidates.filter((c) => c.joined).length} |`);
Lr.push(`| Candidates with no email (phone only): no search entry | ${candidates.filter((c) => !c.fields.EmailID).length} |`);
Lr.push(`| Candidates with no date in the file: created date = import time | ${candidates.filter((c) => !c.createdAt).length} |`);
Lr.push(`| Contacts shared by more than 3 different names (not used for grouping or matching) | ${shared.size} |`, '');
Lr.push('## Count check (plan 6.2, check 2)', '', `Non-blank rows per sheet counted by SheetJS and by ${manifest.secondCountTool}.`, '');
Lr.push('| # | Sheet | SheetJS | Second tool | Equal |', '|---|---|---|---|---|');
for (const u of units) Lr.push(`| ${u.order} | ${unitLabel(u.n)} | ${u.sheetNonBlankRows} | ${u.secondCount} | ${u.countsMatch ? 'yes' : 'NO'} |`);
Lr.push('', '## Per sheet, in load order', '');
Lr.push('"Loaded in this run" counts candidates whose first sheet in the load order is this one. A person who also appears in a later sheet is loaded once, here.', '');
Lr.push(`| # | Layout | Sheet | Years | Rows read | Blank | No contact | Candidate rows | Loaded in this run | Merged in this run |${accessOverlap ? ' Also in MS Access |' : ''} Default role used | Default skills used | JobSource |`);
Lr.push(`|---|---|---|---|---|---|---|---|---|---|${accessOverlap ? '---|' : ''}---|---|---|`);
for (const u of units) {
  const s = stats[u.n]; const cs = candidates.filter((c) => c.loadUnit === u.n);
  const ys = [...new Set(s.years)].sort(); const yr = ys.length ? (ys[0] === ys.at(-1) ? ys[0] : `${ys[0]}–${ys.at(-1)}`) : 'no date';
  Lr.push(`| ${u.order} | ${u.layout} | ${unitLabel(u.n)} | ${yr} | ${s.read} | ${s.blank} | ${s.rejected} | ${s.usable} | ${cs.length} | ${cs.reduce((a, c) => a + c.members.length - 1, 0)} |${accessOverlap ? ` ${accessOverlap[u.n] || 0} |` : ''} ${s.defaultsRole} | ${s.defaultsSkills} | ${u.jobSource || 'own Source column'} |`);
}
Lr.push('', '## Defaults per file (R5), used only when the row\'s own cell is blank', '', '| Sheet | Default PositionApplied | Default Top5KeySkills |', '|---|---|---|');
for (const u of units) Lr.push(`| ${unitLabel(u.n)} | ${u.defaults[0] || '(none)'} | ${u.defaults[1] || '(none)'} |`);
Lr.push('', '## Screening questions (layout C)', '', '| Sheet | Question | Goes to | Rows answered |', '|---|---|---|---|');
for (const u of units) for (const [q, v] of Object.entries(questions[u.n] || {})) Lr.push(`| ${unitLabel(u.n)} | ${q} | ${v.target || 'not mapped (raw row only)'} | ${v.rows} |`);
Lr.push('', '## Columns that hold data and are not mapped', '');
const un = Object.entries(unmapped);
if (un.length === 0) Lr.push('None.');
else {
  Lr.push('These are not covered by the plan. Their values stay in the provenance raw row and are not written to `rpa_cv`.', '', '| Sheet | Column | Rows with data | Longest value (characters) |', '|---|---|---|---|');
  for (const [n, cols] of un) for (const [c, v] of Object.entries(cols)) Lr.push(`| ${unitLabel(Number(n))} | \`${c}\` | ${v.rows} | ${v.maxLen} |`);
}
Lr.push('', '## Value-rule warnings (rows)', '', '| Warning | Rows | Sheets with the most |', '|---|---|---|');
const wAll = {};
for (const s of Object.values(stats)) for (const [w, n] of Object.entries(s.warnings)) wAll[w] = (wAll[w] || 0) + n;
for (const [w, n] of Object.entries(wAll).sort((a, b) => b[1] - a[1])) {
  const top = Object.entries(stats).filter(([, s]) => s.warnings[w]).sort((a, b) => b[1].warnings[w] - a[1].warnings[w]).slice(0, 3).map(([k, s]) => `${unitLabel(Number(k))} ${s.warnings[w]}`).join('; ');
  Lr.push(`| ${w} | ${n} | ${top} |`);
}
Lr.push('', '## Consolidation', '');
const sizes = {};
for (const c of candidates) { const k = c.members.length >= 6 ? '6 or more' : String(c.members.length); sizes[k] = (sizes[k] || 0) + 1; }
Lr.push('| Rows per candidate | Candidates |', '|---|---|');
for (const k of ['1', '2', '3', '4', '5', '6 or more']) if (sizes[k]) Lr.push(`| ${k} | ${sizes[k]} |`);
Lr.push('', `- Largest consolidated candidate: ${Math.max(...candidates.map((c) => c.members.length))} rows.`);
Lr.push(`- Candidates whose rows come from more than one sheet: ${candidates.filter((c) => new Set(c.members.map((m) => m.unit)).size > 1).length}.`);
Lr.push(`- Candidates whose rows carry different names (shared email or phone): ${candidates.filter((c) => c.differentNames).length}. Listed in \`review-merged-names.xlsx\`.`);
Lr.push('', 'Fields where another row of the same person held a different value that was not used (the base row keeps its value):', '', '| Field | Candidates |', '|---|---|');
for (const [k, n] of Object.entries(conflicts).sort((a, b) => b[1] - a[1])) Lr.push(`| ${k}${L.HISTORY_FIELDS.includes(k) ? ' (history)' : ''} | ${n} |`);
Lr.push('', '## Field fill after mapping (unique candidates)', '', '| rpa_cv column | Candidates with a value |', '|---|---|');
for (const k of L.CV_FIELDS) Lr.push(`| ${k} | ${candidates.filter((c) => c.fields[k]).length} |`);
Lr.push(`| TotalExperienceYearsNumeric | ${candidates.filter((c) => c.numeric.TotalExperienceYearsNumeric !== null).length} |`);
Lr.push(`| ExpectedCTCNumeric | ${candidates.filter((c) => c.numeric.ExpectedCTCNumeric !== null).length} |`);
Lr.push(`| NoticePeriodDays | ${candidates.filter((c) => c.numeric.NoticePeriodDays !== null).length} |`);
Lr.push('', '## Sheets skipped', '', '| File | Sheet | Reason |', '|---|---|---|');
for (const s of manifest.skipped) Lr.push(`| ${s.file.split(/[\\/]/).pop()} | ${s.sheet.length > 2 && /karya/i.test(s.file) ? '(staff sheet)' : s.sheet} | ${s.reason} |`);
Lr.push('', `Files that are not spreadsheets, left for Stage 3 (decision S17): ${Object.entries(manifest.otherFilesLeftForStage3).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
fs.writeFileSync(path.join(rDir, 'dry-run-report.md'), Lr.join('\n') + '\n');

console.log(Lr.slice(5, 20).join('\n'));
console.log(`\nUnmapped columns with data: ${un.reduce((a, [, c]) => a + Object.keys(c).length, 0)}`);
console.log(`Report: ${path.join(rDir, 'dry-run-report.md')}`);
