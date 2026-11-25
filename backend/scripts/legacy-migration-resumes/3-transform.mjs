#!/usr/bin/env node
// Stage 3 (resumes), step 3: transform and dry-run report. docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md 5.2, 5.4, 3.1.
// NO DATABASE QUERY, NO AI, NO NETWORK. (backend/.env.staging is loaded only because the ATS helpers it
// imports read their configuration on import; nothing connects.)
//
//   cd backend
//   node scripts/legacy-migration-resumes/3-transform.mjs --work "<work folder>" --sample     (staging: the 10-file sample, S18)
//   node scripts/legacy-migration-resumes/3-transform.mjs --work "<work folder>"              (production: every file)
//   add --accept-parse-errors only on Pankaj's decision, after 2-parse.mjs has been run three times (plan 5.9 A4)
//
// Reads   <work>/manifest.json (1-inventory.mjs) and <work>/parse/<sha256>.json (2-parse.mjs). Every parseable
//         file in scope must have an ok or unreadable parse result; otherwise it stops and writes nothing.
//         With --accept-parse-errors, a file whose cached result is still 'error' is recorded as rejected_unreadable
//         with warning parse_failed and listed for HR. A file with NO parse result always stops the transform.
// Per file: HR Upload's steps (lib/hr-steps.mjs) with the folder's role and skills (R5) where the parser gave none.
// Then, over the usable resumes in scope:
//   - shared-contact guard (plan 3.1): an e-mail or phone seen with more than 3 different names is not used
//     for grouping or matching and is not stored; a resume left with no e-mail is rejected_no_email.
//   - one person = resumes sharing any e-mail or phone. The PRIMARY resume is the newest: folder year first
//     (2024-25 before 2023), then the latest date written in its employment history, then the longer text.
//     (File dates cannot be used: every archive file carries the November 2026 download date.)
//     The candidate gets the primary's fields and CV; older resumes add only their e-mails and phones and are
//     recorded as merged_in_file. A resume in a group whose name shares no token with the primary's name is
//     not merged: review_identity_conflict, listed for HR.
//   - load unit = the oldest folder holding any of the person's resumes (folders load oldest first, R8).
// Writes  <work>/transform[-sample]/units.json, candidates.jsonl, rows.jsonl   (personal data, work folder only)
//         <work>/transform[-sample]/upload/<sha256>.pdf   scanned JPG resumes wrapped in a PDF for upload
//         <work>/report/transform-<scope>.md       counts only
//         <work>/report/transform-<scope>-review.xlsx   lists for HR (personal data, work folder only)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { prepareEnv } from '../legacy-migration-excel/lib/env.mjs';
import { OUTCOME_OF_STATUS, sourceTable } from './lib/constants.mjs';
import { nameKey, sameIdentity, latestWrittenDate } from './lib/identity.mjs';
import { jpgToPdf } from './lib/jpg-to-pdf.mjs';
import { presentAsOf } from './lib/folders.mjs';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const WORK = arg('--work');
const SAMPLE = argv.includes('--sample');
const ACCEPT_PARSE_ERRORS = argv.includes('--accept-parse-errors');
if (!WORK) { console.error('Usage: node 3-transform.mjs --work <work folder> [--sample] [--accept-parse-errors]'); process.exit(2); }
prepareEnv({ envName: 'staging', expectDb: 'recruitmentautomationdb', writes: false, allowProduction: false, work: WORK, logLevel: 'error' });
const { applyHrUploadSteps } = await import('./lib/hr-steps.mjs');
const { getMissingFields } = await import('../legacy-migration/lib/missing-fields.mjs');

const manifest = JSON.parse(fs.readFileSync(path.join(WORK, 'manifest.json'), 'utf8'));
const scope = SAMPLE ? 'sample' : 'all';
const OUT = path.join(WORK, SAMPLE ? 'transform-sample' : 'transform');
const unitByN = new Map(manifest.units.map((u) => [u.n, u]));
const sampleIds = new Set(manifest.sample.files.map((s) => `${s.unitN}|${s.sourceRowId}`));
const files = SAMPLE ? manifest.files.filter((f) => sampleIds.has(`${f.unitN}|${f.sourceRowId}`)) : manifest.files;
if (SAMPLE && files.length !== manifest.sample.files.length) { console.error(`STOPPED: ${files.length} of ${manifest.sample.files.length} sample files found in the manifest.`); process.exit(1); }

// ── 1. Each file: status and HR Upload steps ────────────────────────────────
const PARSEABLE = new Set(['original', 'converted', 'extracted', 'scanned']);
const rows = []; const stops = { noParse: 0, parseError: 0 };
for (const f of files) {
  const unit = unitByN.get(f.unitN);
  const row = {
    unitN: f.unitN, sourceTable: sourceTable(f.folder), sourceRowId: f.sourceRowId, sha256: f.sha256, rel: f.rel, status: 'usable', warnings: [],
    raw: { file: f.rel, folder: f.folder, ext: f.ext, kind: f.kind, route: f.route, bytes: f.bytes, sha256: f.sha256, ...(f.duplicateOf ? { duplicateOf: f.duplicateOf } : {}), ...(f.reason ? { reason: f.reason } : {}) },
  };
  rows.push(row);
  if (f.duplicateOf) { row.status = 'duplicate'; continue; }
  if (f.route === 'unsupported') { row.status = 'unsupported'; continue; }
  if (f.route === 'unreadable' || !PARSEABLE.has(f.route) || !f.readPath) { row.status = 'unreadable'; continue; }
  const p = path.join(WORK, 'parse', `${f.sha256}.json`);
  if (!fs.existsSync(p)) { stops.noParse++; continue; }
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (c.status === 'error') {
    if (!ACCEPT_PARSE_ERRORS) { stops.parseError++; continue; }
    row.status = 'unreadable'; row.warnings.push('parse_failed'); row.raw.parseStatus = 'error';
    continue;
  }
  row.raw.textSource = c.textSource; row.raw.textChars = c.textChars; row.raw.parseStatus = c.status;
  row.warnings.push(...(c.warnings || []));
  if (c.status !== 'ok') { row.status = 'unreadable'; continue; }
  const s = applyHrUploadSteps(c.text, c.parsed, { role: unit.role, skills: unit.skills, presentAs: presentAsOf(unit.year) });
  row.warnings.push(...s.warnings);
  if (s.rejected) { row.status = 'no_email'; continue; }
  row.s = s; row.f = f; row.unit = unit;
  row.name = s.fields.Name;
  row.latest = latestWrittenDate(c.parsed?.EmploymentHistory);
  row.textChars = c.textChars || 0;
}
if (stops.noParse || stops.parseError) {
  console.error(`STOPPED. Nothing was written. ${stops.noParse} file(s) have no parse result, ${stops.parseError} had a parse error. Run 2-parse.mjs${SAMPLE ? ' --sample' : ''} again first${stops.parseError && !stops.noParse ? ' (after three runs, Pankaj may decide on --accept-parse-errors)' : ''}.`);
  process.exit(1);
}

// ── 2. Shared-contact guard (plan 3.1) ──────────────────────────────────────
let usable = rows.filter((r) => r.status === 'usable');
const namesByKey = new Map();
for (const r of usable) {
  const n = nameKey(r.name);
  if (!n) continue;
  for (const k of [...r.s.cleanEmails.map((e) => `e:${e}`), ...r.s.cleanContacts.map((p) => `p:${p}`)]) {
    if (!namesByKey.has(k)) namesByKey.set(k, new Set());
    namesByKey.get(k).add(n);
  }
}
const shared = new Set([...namesByKey].filter(([, s]) => s.size > 3).map(([k]) => k));
for (const r of usable) {
  r.emails = r.s.cleanEmails.filter((e) => !shared.has(`e:${e}`));
  r.phones = r.s.cleanContacts.filter((p) => !shared.has(`p:${p}`));
  r.phoneRemoved = r.phones.length < r.s.cleanContacts.length;
  if (r.emails.length + r.phones.length < r.s.cleanEmails.length + r.s.cleanContacts.length) r.warnings.push('shared_contact_removed');
  if (r.emails.length === 0) { r.status = 'no_email'; r.warnings.push('only_shared_contacts'); }
}
usable = usable.filter((r) => r.status === 'usable');

// ── 3. One person = resumes sharing an e-mail or phone ──────────────────────
const parent = usable.map((_, i) => i);
const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
const owner = new Map();
usable.forEach((r, i) => {
  for (const k of [...r.emails.map((e) => `e:${e}`), ...r.phones.map((p) => `p:${p}`)]) {
    if (owner.has(k)) { const a = find(i); const b = find(owner.get(k)); if (a !== b) parent[a] = b; } else owner.set(k, i);
  }
});
const groups = new Map();
usable.forEach((r, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });

const newestFirst = (a, b) => b.unit.year.localeCompare(a.unit.year) || b.latest.localeCompare(a.latest) || b.textChars - a.textChars || a.sha256.localeCompare(b.sha256);
const candidates = []; let gid = 0;
fs.mkdirSync(path.join(OUT, 'upload'), { recursive: true });
for (const members of [...groups.values()].sort((a, b) => Math.min(...a.map((r) => r.unitN)) - Math.min(...b.map((r) => r.unitN)) || a[0].sha256.localeCompare(b[0].sha256))) {
  members.sort(newestFirst);
  const primary = members[0];
  const kept = [primary];
  for (const m of members.slice(1)) {
    if (sameIdentity(primary.name, m.name)) kept.push(m);
    else { m.status = 'identity_in_archive'; m.conflictGid = gid + 1; m.warnings.push('name_differs_from_the_newest_resume_with_this_contact'); }
  }
  const f = { ...primary.s.fields };
  const emails = [...new Set(kept.flatMap((m) => m.emails))];
  f.EmailID = emails.join(', ');
  // Stored phones: the primary's parsed value as HR Upload stores it, unless the guard removed a shared number
  // from it (then only its validated numbers); plus the other resumes' validated numbers not already there.
  const base = primary.phoneRemoved ? primary.phones.join(', ') : (primary.s.fields.ContactNumber || '');
  const have = new Set(base.split(',').map((n) => n.replace(/\D/g, '').slice(-10)).filter(Boolean));
  const extra = [...new Set(kept.slice(1).flatMap((m) => m.phones))].filter((p) => !have.has(p));
  f.ContactNumber = [base, ...extra].filter(Boolean).join(', ') || null;
  // Missing data follows the stored contacts (the rest is the primary's own, unchanged).
  let edu = {};
  try { edu = f.EducationalScoresPercentage ? JSON.parse(f.EducationalScoresPercentage) || {} : {}; } catch { edu = {}; }
  // Recomputed only when the stored contacts differ from the primary's own (otherwise HR Upload's value stands).
  const missing = f.ContactNumber === primary.s.fields.ContactNumber
    ? primary.s.missingFields
    : getMissingFields({ ...primary.s.fields, ...f, EducationalScoresPercentage: edu, Top5KeySkills: f.Top5KeySkills });
  f.missingData = JSON.stringify(missing);
  f.statusActive = Object.keys(missing).length > 0 ? 'INACTIVE' : 'ACTIVE';

  // The file that is uploaded and linked: what the parser read (the converted .docx, the extracted PDF),
  // and for a scanned JPG a PDF wrapping it.
  const pf = primary.f;
  let uploadPath = pf.readPath;
  if (pf.route === 'scanned') {
    uploadPath = path.join(OUT, 'upload', `${pf.sha256}.pdf`);
    fs.writeFileSync(uploadPath, jpgToPdf(fs.readFileSync(pf.readPath)));
  }
  const uploadExt = path.extname(uploadPath).toLowerCase();
  const archiveBase = pf.route === 'extracted' ? path.basename(pf.rel) : path.basename(pf.rel, path.extname(pf.rel));
  gid++;
  const c = {
    gid, loadUnit: Math.min(...kept.map((m) => m.unitN)),
    primary: { unitN: primary.unitN, sourceTable: primary.sourceTable, sourceRowId: primary.sourceRowId, sha256: primary.sha256, year: primary.unit.year, uploadPath, uploadName: `${archiveBase}_${primary.sha256.slice(0, 8)}${uploadExt}` },
    members: kept.map((m) => ({ unitN: m.unitN, sourceTable: m.sourceTable, sourceRowId: m.sourceRowId })),
    fields: f, missingFields: missing,
    matchEmails: emails, matchContacts: [...new Set(kept.flatMap((m) => m.phones))],
    vectorData: { ...primary.s.vectorData, EmailID: f.EmailID, unique_key: emails[0], ContactNumber: f.ContactNumber },
    warnings: [...new Set(kept.flatMap((m) => m.warnings))],
    files: kept.length, splitOff: members.length - kept.length,
  };
  candidates.push(c);
  kept.forEach((m, i) => { m.gid = gid; m.role = i === 0 ? 'primary' : 'merged'; m.loadUnit = c.loadUnit; });
}

// ── 4. Write ─────────────────────────────────────────────────────────────────
for (const r of rows) {
  if (r.status !== 'usable') { r.outcome = OUTCOME_OF_STATUS[r.status]; r.loadUnit = r.unitN; }
  r.raw.status = r.status;
  if (r.role) r.raw.groupRole = r.role;
}
const units = manifest.units.map((u) => ({ n: u.n, order: u.n, unit: u.unit, sourceTable: sourceTable(u.unit), year: u.year, role: u.role, skills: u.skills, sourceCount: u.sourceCount, secondCount: u.secondCount, countsMatch: u.countsMatch, sha256: u.sha256 }));
fs.writeFileSync(path.join(OUT, 'units.json'), JSON.stringify({ scope, sourceFile: manifest.sourceRoot, manifestInventoriedAt: manifest.inventoriedAt, transformedAt: new Date().toISOString(), units }, null, 2));
fs.writeFileSync(path.join(OUT, 'candidates.jsonl'), candidates.map((c) => JSON.stringify(c)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'rows.jsonl'), rows.map((r) => JSON.stringify({
  unitN: r.unitN, sourceTable: r.sourceTable, sourceRowId: r.sourceRowId, status: r.status, outcome: r.outcome ?? null, gid: r.gid ?? null, role: r.role ?? null, loadUnit: r.loadUnit, warnings: [...new Set(r.warnings)], raw: r.raw,
})).join('\n') + '\n');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16).toUpperCase();

// Lists for HR (personal data, work folder only).
fs.mkdirSync(path.join(WORK, 'report'), { recursive: true });
const WHY = { duplicate: 'Byte-identical copy of another archive file', unsupported: 'File type not imported (RTF, PPTX, lock or empty file)', unreadable: 'No readable text', no_email: 'No valid e-mail in the resume', identity_in_archive: 'Same e-mail or phone as a newer resume with a different name' };
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.filter((r) => r.status !== 'usable' && r.status !== 'duplicate')
  .map((r) => ({ Folder: r.raw.folder || '(root)', File: path.basename(r.rel), Why: (r.warnings.includes('parse_failed') ? 'The AI parser failed on this file three times' : WHY[r.status]) + (r.warnings.includes('only_shared_contacts') ? ' (its only e-mail is shared by more than 3 names)' : ''), Outcome: r.outcome }))), 'Not imported');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...shared].map((k) => ({ Contact: k.slice(2), Kind: k[0] === 'e' ? 'email' : 'phone', 'Different names': namesByKey.get(k).size }))), 'Shared contacts');
const gRows = [];
for (const c of candidates.filter((x) => x.files > 1 || x.splitOff)) {
  for (const r of rows.filter((x) => x.gid === c.gid || x.conflictGid === c.gid)) gRows.push({ Person: c.gid, Role: r.role || 'not merged: different name', Folder: r.raw.folder || '(root)', File: path.basename(r.rel), Name: r.name || '' });
}
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gRows), 'One person, several resumes');
XLSX.writeFile(wb, path.join(WORK, 'report', `transform-${scope}-review.xlsx`));

// Report: counts only.
const count = (pred) => rows.filter(pred).length;
const st = (s) => count((r) => r.status === s);
const warnAll = {};
for (const r of rows) for (const w of new Set(r.warnings)) warnAll[w] = (warnAll[w] || 0) + 1;
const fill = (k) => candidates.filter((c) => c.fields[k] !== null && c.fields[k] !== undefined && String(c.fields[k]).trim() !== '').length;
const L = [];
L.push(`# Resume migration: transform report (Stage 3, ${SAMPLE ? 'staging sample, S18' : 'all files'})`, '');
L.push(`- Manifest: inventoried ${manifest.inventoriedAt}. Generated ${new Date().toISOString().slice(0, 19)}Z. No database was read or written.`);
L.push('- Counts only. Personal data stays in the work folder.', '');
L.push('## Files', '', '| | Files |', '|---|---|');
L.push(`| Files in scope | ${rows.length} |`);
L.push(`| Byte-identical copies (skipped_duplicate_file) | ${st('duplicate')} |`);
L.push(`| Not imported, type (skipped_unsupported_type) | ${st('unsupported')} |`);
L.push(`| No readable text (rejected_unreadable) | ${st('unreadable')} |`);
L.push(`| ... of which the AI parser failed three times (--accept-parse-errors) | ${count((r) => r.warnings.includes('parse_failed'))} |`);
L.push(`| No valid e-mail (rejected_no_email) | ${st('no_email')} |`);
L.push(`| ... of which the only e-mail is shared by more than 3 names | ${count((r) => r.warnings.includes('only_shared_contacts'))} |`);
L.push(`| Different name from the newest resume with the same contact (review_identity_conflict) | ${st('identity_in_archive')} |`);
L.push(`| Resumes that become candidates | ${count((r) => r.role)} |`);
L.push(`| Unique candidates (one per person) | ${candidates.length} |`);
L.push(`| Older resumes merged into the person's newest (merged_in_file) | ${count((r) => r.role === 'merged')} |`);
L.push(`| Contacts shared by more than 3 names (not used) | ${shared.size} |`, '');
L.push('## Per folder (load order, oldest year first)', '', '| # | Year | Folder | Files | Candidates loaded here | Merged | Copies | No e-mail | Unreadable | Type | Name conflict | Role from folder |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const u of units) {
  const ur = rows.filter((r) => r.unitN === u.n);
  if (!ur.length) continue;
  const cs = candidates.filter((c) => c.loadUnit === u.n);
  L.push(`| ${u.n} | ${u.year} | ${u.unit || '(root)'} | ${ur.length} | ${cs.length} | ${cs.reduce((a, c) => a + c.files - 1, 0)} | ${ur.filter((r) => r.status === 'duplicate').length} | ${ur.filter((r) => r.status === 'no_email').length} | ${ur.filter((r) => r.status === 'unreadable').length} | ${ur.filter((r) => r.status === 'unsupported').length} | ${ur.filter((r) => r.status === 'identity_in_archive').length} | ${cs.filter((c) => c.warnings.includes('role_from_folder')).length} |`);
}
L.push('', '## Warnings (files)', '', '| Warning | Files |', '|---|---|');
for (const [w, n] of Object.entries(warnAll).sort((a, b) => b[1] - a[1])) L.push(`| ${w} | ${n} |`);
L.push('', '## Field fill (unique candidates)', '', '| rpa_cv column | Candidates with a value |', '|---|---|');
for (const k of ['Name', 'EmailID', 'ContactNumber', 'PositionApplied', 'HighestQualification', 'TotalExperienceYears', 'CurrentLocation', 'CurrentCompany', 'Top5KeySkills', 'NoticePeriod', 'CTC_LPA', 'ExpectedCTC_LPA', 'Gender', 'graduationdegree', 'LinkedInProfile', 'TotalExperienceYearsNumeric', 'resume_full_text']) L.push(`| ${k} | ${fill(k)} |`);
L.push(`| statusActive = ACTIVE (nothing missing) | ${candidates.filter((c) => c.fields.statusActive === 'ACTIVE').length} |`);
L.push('', '## Resumes per person', '', '| Resumes | Candidates |', '|---|---|');
const sizes = {};
for (const c of candidates) sizes[c.files] = (sizes[c.files] || 0) + 1;
for (const [k, n] of Object.entries(sizes).sort((a, b) => a[0] - b[0])) L.push(`| ${k} | ${n} |`);
L.push('', '## What is uploaded as the CV', '', '| File | Candidates |', '|---|---|');
const up = {};
for (const c of candidates) { const k = path.extname(c.primary.uploadPath).toLowerCase(); up[k] = (up[k] || 0) + 1; }
for (const [k, n] of Object.entries(up)) L.push(`| ${k} | ${n} |`);
L.push('', '## Fingerprints', '', `- candidates.jsonl ${sha(path.join(OUT, 'candidates.jsonl'))}`, `- rows.jsonl ${sha(path.join(OUT, 'rows.jsonl'))}`);
const reportPath = path.join(WORK, 'report', `transform-${scope}.md`);
fs.writeFileSync(reportPath, L.join('\n') + '\n');
console.log(L.slice(4, 18).join('\n'));
console.log(`Fingerprints: candidates.jsonl ${sha(path.join(OUT, 'candidates.jsonl'))}, rows.jsonl ${sha(path.join(OUT, 'rows.jsonl'))}`);
console.log(`Report: ${reportPath}`);
process.exit(0);
