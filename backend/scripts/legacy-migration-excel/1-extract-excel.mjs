// Stage 2, extract. docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, 4.2.
// Reads every spreadsheet under the source folder with SheetJS (read-only), finds the header
// row, classifies the layout and writes each loaded sheet to one raw file, values untouched.
// Spreadsheets only (.xlsx .xls .xlsm .csv): every other file type belongs to Stage 3 (decision S17).
// NO DATABASE CONNECTION. Prints counts only.
//
//   cd backend
//   node scripts/legacy-migration-excel/1-extract-excel.mjs --root "<source folder>" --out "<work folder>"
//
// Writes  <work>/raw/NN.jsonl     one line per sheet row below the header: {"t":unit,"id":"r<excel row>","v":{header:[kind,value]}}
//         <work>/manifest.json     the manifest contract of plan 6.3: per unit file, sheet, layout, header row,
//                                  sourceCount (rows written), the non-blank row count from SheetJS and from
//                                  a separate .NET OpenXML reader (1b-recount-openxml.ps1; ACE OLEDB is not
//                                  registered on the migration machine), and the file's SHA-256
// A sheet whose header set was never seen before is recorded with layout null; the transform then stops.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { detectLayout, findHeaderRow, skipReason } from './lib/layouts.mjs';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const root = arg('--root'); const out = arg('--out');
if (!root || !out) { console.error('Usage: node 1-extract-excel.mjs --root <source folder> --out <work folder>'); process.exit(2); }
if (fs.existsSync(path.join(out, 'manifest.json'))) {
  console.error(`REFUSED: ${path.join(out, 'manifest.json')} exists. The extract runs once; staging and production load the same files.\nDelete the work folder yourself only if you are sure no database was loaded from it.`);
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(xlsx|xls|xlsm|csv)$/i.test(e.name) && !e.name.startsWith('~$')) files.push(path.relative(root, p));
  }
})(root);
files.sort((a, b) => a.localeCompare(b, 'en'));

fs.mkdirSync(path.join(out, 'raw'), { recursive: true });
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// A cell as [kind, value]. Numbers stay numbers (String() never gives scientific notation for
// a 10-digit phone); a number with a date format becomes a date.
function cellOf(c) {
  if (!c || c.t === 'z' || c.v === undefined || c.v === null || c.v === '') return null;
  if (c.t === 'n' && c.z && XLSX.SSF.is_date(c.z)) { const p = XLSX.SSF.parse_date_code(c.v); return p ? ['d', iso(p.y, p.m, p.d)] : ['n', c.v]; }
  if (c.t === 'd') { const d = c.v instanceof Date ? c.v : new Date(c.v); return ['d', d.toISOString().slice(0, 10)]; }
  if (c.t === 'e') return ['e', c.w || '#ERROR'];
  return [c.t, c.v];
}
const nonBlank = (c) => c && c[0] !== 'e' && String(c[1]).trim() !== '';

const manifest = { stage: 2, sourceKind: 'excel', sourceRoot: root, extractedAt: new Date().toISOString(), tool: `SheetJS ${XLSX.version}`, files: [], units: [], skipped: [] };
const nonSpreadsheets = {};
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!/\.(xlsx|xls|xlsm|csv)$/i.test(e.name)) { const k = path.extname(e.name).toLowerCase() || '(none)'; nonSpreadsheets[k] = (nonSpreadsheets[k] || 0) + 1; } } })(root);
manifest.otherFilesLeftForStage3 = nonSpreadsheets;

let unitNo = 0;
for (const rel of files) {
  const buf = fs.readFileSync(path.join(root, rel));
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const wb = XLSX.read(buf, { cellDates: false, cellNF: true, cellText: true, raw: false });
  manifest.files.push({ file: rel, bytes: buf.length, sha256, sheets: wb.SheetNames });
  for (const sheet of wb.SheetNames) {
    const why = skipReason(rel, sheet);
    if (why) { manifest.skipped.push({ file: rel, sheet, reason: why }); continue; }
    const ws = wb.Sheets[sheet];
    if (!ws['!ref']) { manifest.skipped.push({ file: rel, sheet, reason: 'Empty sheet' }); continue; }
    const range = XLSX.utils.decode_range(ws['!ref']);
    // Grid of cells, row 0 = the first row of the used range.
    const grid = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) row.push(cellOf(ws[XLSX.utils.encode_cell({ r, c })]));
      grid.push(row);
    }
    const h = findHeaderRow(grid.map((row) => row.map((c) => (c ? String(c[1]) : ''))));
    const sheetNonBlankRows = grid.filter((row) => row.some(nonBlank)).length;
    if (h < 0) { manifest.skipped.push({ file: rel, sheet, reason: 'No header row found (needs a mapping before it can load)', sheetNonBlankRows, needsDecision: true }); continue; }
    // Column keys: the header text; an empty header becomes "(col X)"; a repeated header gets " (2)".
    const seen = {};
    const keys = grid[h].map((c, j) => {
      let k = c ? String(c[1]).replace(/\s+/g, ' ').trim() : '';
      if (!k) k = `(col ${XLSX.utils.encode_col(range.s.c + j)})`;
      seen[k] = (seen[k] || 0) + 1;
      return seen[k] > 1 ? `${k} (${seen[k]})` : k;
    });
    const headers = keys.filter((k) => !k.startsWith('(col '));
    const layout = detectLayout(headers);
    unitNo++;
    const rawFile = `${pad(unitNo)}.jsonl`;
    const lines = [];
    let nonBlankData = 0;
    for (let i = h + 1; i < grid.length; i++) {
      const v = {};
      grid[i].forEach((c, j) => { if (c) v[keys[j]] = c; });
      if (grid[i].some(nonBlank)) nonBlankData++;
      lines.push(JSON.stringify({ t: unitNo, id: `r${range.s.r + i + 1}`, v }));
    }
    fs.writeFileSync(path.join(out, 'raw', rawFile), lines.length ? lines.join('\n') + '\n' : '');
    manifest.units.push({
      n: unitNo, unit: `${rel} | ${sheet}`, file: rel, sheet, layout, headerRow: range.s.r + h + 1, headers,
      sourceCount: lines.length, nonBlankDataRows: nonBlankData, rowsAboveHeader: h,
      sheetNonBlankRows, secondCount: null, countsMatch: null, sha256, rawFile,
    });
  }
}

// Second count with a separate tool (plan 6.2 check 2).
const unitsFile = path.join(out, 'recount-units.json');
fs.writeFileSync(unitsFile, JSON.stringify(manifest.units.map((u) => ({ file: u.file, sheet: u.sheet }))));
const ps = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, '1b-recount-openxml.ps1'), '-Root', root, '-Units', unitsFile], { encoding: 'utf8', maxBuffer: 1 << 24 });
fs.rmSync(unitsFile, { force: true });
const recount = (ps.stdout || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
for (const u of manifest.units) {
  const r = recount.find((x) => x.file === u.file && x.sheet === u.sheet);
  u.secondCount = r && r.nonBlankRows !== null ? r.nonBlankRows : null;
  u.secondCountError = r ? r.error : `recount did not run: ${(ps.stderr || '').split('\n')[0].slice(0, 200)}`;
  u.countsMatch = u.secondCount === u.sheetNonBlankRows;
}
manifest.secondCountTool = '.NET OpenXML reader (1b-recount-openxml.ps1), non-blank rows per sheet';
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Counts only.
console.log(`Spreadsheets: ${files.length}. Sheets loaded: ${manifest.units.length}. Sheets skipped: ${manifest.skipped.length}.`);
console.log('n  layout rows  nonBlank sheetNonBlank oledb  match  unit');
for (const u of manifest.units) console.log(`${String(u.n).padEnd(3)}${String(u.layout).padEnd(7)}${String(u.sourceCount).padEnd(6)}${String(u.nonBlankDataRows).padEnd(9)}${String(u.sheetNonBlankRows).padEnd(14)}${String(u.secondCount).padEnd(7)}${String(u.countsMatch).padEnd(7)}${u.unit}`);
for (const s of manifest.skipped) console.log(`skipped: ${s.file} | ${s.sheet}: ${s.reason}`);
console.log(`Other files left for Stage 3: ${JSON.stringify(nonSpreadsheets)}`);
const bad = manifest.units.filter((u) => !u.layout || !u.countsMatch);
if (bad.length || manifest.skipped.some((s) => s.needsDecision)) { console.log(`ATTENTION: ${bad.length} sheet(s) with an unknown layout or a count mismatch; the transform will stop on them.`); process.exitCode = 1; }
console.log(`Manifest: ${path.join(out, 'manifest.json')}`);
