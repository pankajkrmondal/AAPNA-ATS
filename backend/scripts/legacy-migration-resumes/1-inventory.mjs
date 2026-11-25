#!/usr/bin/env node
// Stage 3 (resumes), step 1: inventory. docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, 5.2 and 6.3.
// NO DATABASE, NO AI, NO NETWORK. Reads the archive read-only. Prints counts only.
//
//   cd backend
//   node scripts/legacy-migration-resumes/1-inventory.mjs --root "<archive root>" --work "<work folder>"
//
// Needs <work>/report/convert-doc.json from 1b-convert.mjs and <work>/report/extract-email-pdfs.json from
// 1c-extract-email-pdfs.mjs (run both first): a .doc is read from its converted copy, a saved e-mail from its PDF.
// Runs ONCE: refuses if <work>/manifest.json exists (staging and production load from the same inventory).
//
// Writes <work>/manifest.json
//   files[]  one per archive file (spreadsheets excluded, Stage 2): rel, folder, ext, kind (from the bytes),
//            route (original | converted | extracted | scanned | unsupported | unreadable), readPath (what the parser reads),
//            sha256, bytes, mtime, sourceRowId (sha256; '#2', '#3' for a byte-identical copy in the same folder),
//            duplicateOf (rel of the first copy, for a byte-identical file anywhere in the archive)
//   units[]  one per folder (the load unit), in load order (oldest year first): n, unit, year, role, skills,
//            sourceCount (files from the walk), secondCount (PowerShell Get-ChildItem), countsMatch, sha256
//            (over the sorted file hashes), and counts per route
//   sample   the 10-file staging sample (decision S18): sha256s, chosen by a fixed hash, by type
// and <work>/sample.json (the same sample list).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FOLDERS, STAGE2_EXT, routeOf, sniffKind } from './lib/folders.mjs';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const ROOT = arg('--root');
const WORK = arg('--work');
if (!ROOT || !WORK) { console.error('Usage: node 1-inventory.mjs --root <archive root> --work <work folder>'); process.exit(2); }
const MANIFEST = path.join(WORK, 'manifest.json');
if (fs.existsSync(MANIFEST)) {
  console.error(`REFUSED: ${MANIFEST} exists. The inventory runs once; staging and production load the same files.\nDelete it yourself only if you are sure no database was loaded from it.`);
  process.exit(1);
}
const CONVERT = path.join(WORK, 'report', 'convert-doc.json');
if (!fs.existsSync(CONVERT)) { console.error(`REFUSED: ${CONVERT} not found. Run 1b-convert.mjs first.`); process.exit(1); }
const convert = JSON.parse(fs.readFileSync(CONVERT, 'utf8'));
const convertedBySrc = new Map(convert.files.map((f) => [f.rel.toLowerCase(), f]));
const EXTRACT = path.join(WORK, 'report', 'extract-email-pdfs.json');
if (!fs.existsSync(EXTRACT)) { console.error(`REFUSED: ${EXTRACT} not found. Run 1c-extract-email-pdfs.mjs first.`); process.exit(1); }
const extract = JSON.parse(fs.readFileSync(EXTRACT, 'utf8'));
const extractedBySrc = new Map(extract.emails.map((e) => [e.rel.toLowerCase(), e]));

const SAMPLE_SEED = 'stage3-staging-sample-v1';
const SAMPLE_PLAN = [['pdf', 4], ['docx', 3], ['doc_ole2', 1], ['doc_html', 1], ['image', 1]]; // 10 files (S18)

// ---- walk -------------------------------------------------------------------------------------
const rels = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) rels.push(path.relative(ROOT, p));
  }
})(ROOT);
rels.sort((a, b) => a.localeCompare(b, 'en'));

const files = [];
const stage2 = [];
const unknownFolders = new Set();
for (const rel of rels) {
  const ext = path.extname(rel).toLowerCase();
  if (STAGE2_EXT.has(ext)) { stage2.push(rel); continue; }
  const folder = path.dirname(rel) === '.' ? '' : path.dirname(rel);
  if (!FOLDERS[folder]) unknownFolders.add(folder);
  const abs = path.join(ROOT, rel);
  const buf = fs.readFileSync(abs);
  const st = fs.statSync(abs);
  const kind = sniffKind(buf);
  const route = routeOf(kind, ext);
  const f = {
    rel, folder, ext, kind, route, bytes: buf.length, mtime: st.mtime.toISOString(),
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
  if (route === 'original' || route === 'scanned') f.readPath = abs;
  if (route === 'converted') {
    const c = convertedBySrc.get(rel.toLowerCase());
    if (c && c.status === 'ok') { f.readPath = c.out; f.convertedTextChars = c.textChars; f.convertMethod = c.method; }
    else { f.route = 'unreadable'; f.reason = c ? `conversion_failed: ${c.error}` : 'not_in_convert_report'; }
  }
  if (route === 'extracted') {
    const e = extractedBySrc.get(rel.toLowerCase());
    const pdf = e && e.status === 'ok' ? e.pdfs.find((x) => x.ok) : null;
    if (pdf) { f.readPath = pdf.out; f.extractedPdfSha256 = pdf.sha256; }
    else { f.route = 'unreadable'; f.reason = e ? `email_${e.status}` : 'not_in_extract_report'; }
  }
  files.push(f);
}
if (unknownFolders.size) {
  console.error(`REFUSED: ${unknownFolders.size} folder(s) not in lib/folders.mjs. Add them (role, skills, year) first:`);
  for (const u of unknownFolders) console.error(`  ${u}`);
  process.exit(1);
}

// ---- duplicates and provenance ids ------------------------------------------------------------
const firstBySha = new Map();
const perFolderSha = new Map();
for (const f of files) {
  if (firstBySha.has(f.sha256)) f.duplicateOf = firstBySha.get(f.sha256).rel;
  else firstBySha.set(f.sha256, f);
  const k = `${f.folder}|${f.sha256}`;
  const n = (perFolderSha.get(k) || 0) + 1;
  perFolderSha.set(k, n);
  f.sourceRowId = n === 1 ? f.sha256 : `${f.sha256}#${n}`;
}

// ---- second count (separate tool, plan 6.2 check 2) -------------------------------------------
const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$r=$env:INV_ROOT; Get-ChildItem -LiteralPath $r -Recurse -File | Where-Object { @('.xlsx','.xls','.xlsm','.csv') -notcontains $_.Extension.ToLower() } | Group-Object DirectoryName | ForEach-Object { [pscustomobject]@{ dir = $_.Name.Substring($r.Length).TrimStart('\\'); n = $_.Count } } | ConvertTo-Json -Compress`],
{ encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, INV_ROOT: path.resolve(ROOT) } });
let second = [];
try { second = [].concat(JSON.parse(ps.stdout || '[]')); } catch { second = []; }
const secondOf = new Map(second.map((s) => [s.dir, s.n]));

// ---- units: one per folder, oldest year first -------------------------------------------------
const folders = [...new Set(files.map((f) => f.folder))]
  .sort((a, b) => FOLDERS[a].year.localeCompare(FOLDERS[b].year) || a.localeCompare(b, 'en'));
const units = folders.map((folder, i) => {
  const list = files.filter((f) => f.folder === folder);
  const byRoute = {};
  for (const f of list) {
    const r = f.duplicateOf ? 'duplicate' : f.route;
    byRoute[r] = (byRoute[r] || 0) + 1;
  }
  const secondCount = secondOf.has(folder) ? secondOf.get(folder) : null;
  return {
    n: i + 1, unit: folder, ...FOLDERS[folder],
    sourceCount: list.length, secondCount, countsMatch: secondCount === list.length,
    sha256: crypto.createHash('sha256').update(list.map((f) => f.sha256).sort().join('\n')).digest('hex'),
    byRoute,
  };
});
for (const f of files) f.unitN = units.find((u) => u.unit === f.folder).n;

// ---- 10-file staging sample (S18) -------------------------------------------------------------
const rank = (f) => crypto.createHash('sha256').update(`${SAMPLE_SEED}:${f.sha256}`).digest('hex');
const stratum = (f) => {
  if (f.duplicateOf) return null;
  if (f.route === 'original') return f.kind === 'pdf' ? 'pdf' : 'docx';
  if (f.route === 'converted') return f.convertMethod === 'libreoffice_html' ? 'doc_html' : 'doc_ole2';
  if (f.route === 'scanned') return 'image';
  return null;
};
const sample = [];
const usedFolders = new Set();
for (const [s, want] of SAMPLE_PLAN) {
  const pool = files.filter((f) => stratum(f) === s).sort((a, b) => rank(a).localeCompare(rank(b)));
  // spread across folders where possible, then fill
  const pick = [];
  for (const f of pool) { if (pick.length >= want) break; if (!usedFolders.has(f.folder)) { pick.push(f); usedFolders.add(f.folder); } }
  for (const f of pool) { if (pick.length >= want) break; if (!pick.includes(f)) pick.push(f); }
  for (const f of pick) sample.push({ stratum: s, sha256: f.sha256, sourceRowId: f.sourceRowId, unitN: f.unitN });
}

// ---- write ------------------------------------------------------------------------------------
const count = (pred) => files.filter(pred).length;
const manifest = {
  stage: 3, sourceKind: 'resume', sourceRoot: ROOT, inventoriedAt: new Date().toISOString(),
  secondCountTool: 'PowerShell Get-ChildItem -Recurse -File, grouped by folder',
  convertReport: { path: CONVERT, lastRunAt: convert.lastRunAt, summary: convert.summary },
  totals: {
    archiveFiles: rels.length, stage2Spreadsheets: stage2.length, stage3Files: files.length,
    distinctSha256: firstBySha.size, duplicates: count((f) => f.duplicateOf),
    byRoute: Object.fromEntries(['original', 'converted', 'extracted', 'scanned', 'unsupported', 'unreadable'].map((r) => [r, count((f) => f.route === r && !f.duplicateOf)])),
    byKind: files.reduce((a, f) => ((a[f.kind] = (a[f.kind] || 0) + 1), a), {}),
    extensionNotMatchingContent: count((f) => (f.ext === '.pdf' && f.kind !== 'pdf') || (f.ext === '.docx' && f.kind !== 'docx')),
  },
  sample: { seed: SAMPLE_SEED, plan: Object.fromEntries(SAMPLE_PLAN), files: sample },
  units,
  files,
};
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(WORK, 'sample.json'), JSON.stringify(manifest.sample, null, 2));

// ---- counts only ------------------------------------------------------------------------------
console.log(JSON.stringify(manifest.totals, null, 2));
console.log('n   year     files second match orig conv mail scan unsup unread dup  role');
for (const u of units) {
  const r = (k) => String(u.byRoute[k] || 0).padEnd(5);
  console.log(`${String(u.n).padEnd(4)}${u.year.padEnd(9)}${String(u.sourceCount).padEnd(6)}${String(u.secondCount).padEnd(7)}${String(u.countsMatch).padEnd(6)}${r('original')}${r('converted')}${r('extracted')}${r('scanned')}${r('unsupported')}${r('unreadable').padEnd(7)}${r('duplicate')}${u.role || '(parser)'}`);
}
console.log(`sample: ${sample.length} files: ${SAMPLE_PLAN.map(([s]) => `${s} ${sample.filter((x) => x.stratum === s).length}`).join(', ')}`);
const mismatch = units.filter((u) => !u.countsMatch).length;
if (mismatch) { console.log(`ATTENTION: ${mismatch} folder(s) where the two counts differ.`); process.exitCode = 1; }
console.log(`Manifest: ${MANIFEST}`);
