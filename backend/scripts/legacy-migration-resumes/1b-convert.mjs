#!/usr/bin/env node
// Stage 3 (resumes), step 1b: working copies of every .doc resume as .docx.
// HR Upload's extractTextFromFile() rejects .doc, so each one is converted once here.
//
//   node scripts/legacy-migration-resumes/1b-convert.mjs --root <source folder> --work <work folder> [--soffice <path>]
//
// - Originals are only read, never changed. Output: <work>/converted/<same relative folder>/<name>.docx
// - Real file content decides the route (the extension does not):
//     OLE2 Word 97-2003   -> LibreOffice headless, filter "MS Word 2007 XML"
//     HTML saved as .doc  -> LibreOffice headless, input filter "HTML (StarWriter)"
//     DOCX renamed .doc   -> copied byte for byte as .docx
// - Every output is checked with mammoth.extractRawText (what extractTextFromFile uses for .docx).
// - Resumable: a valid output that already exists is kept. Re-running converts only what is missing or failed.
// - Report (contains file paths, i.e. personal data; stays in the work folder): <work>/report/convert-doc.json
// - Console prints counts only. No database, no network, no AI.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mammoth from 'mammoth';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const ROOT = arg('root');
const WORK = arg('work');
if (!ROOT || !WORK) {
  console.error('usage: 1b-convert.mjs --root <source folder> --work <work folder> [--soffice <path>]');
  process.exit(2);
}
if (path.resolve(WORK).toLowerCase().startsWith(path.resolve(ROOT).toLowerCase())) {
  console.error('REFUSED: the work folder must not be inside the source folder');
  process.exit(2);
}

const SOFFICE = arg('soffice') || [
  'C:\\Program Files\\LibreOffice\\program\\soffice.com',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
].find((p) => fs.existsSync(p));
if (!SOFFICE || !fs.existsSync(SOFFICE)) {
  console.error('REFUSED: LibreOffice soffice not found (pass --soffice <path>)');
  process.exit(2);
}

const OUT_ROOT = path.join(WORK, 'converted');
const REPORT_DIR = path.join(WORK, 'report');
const PROFILE = path.join(WORK, 'tmp', 'lo-profile');
const REPORT = path.join(REPORT_DIR, 'convert-doc.json');
const CHUNK = 15;            // files per soffice call (keeps the command line short)
const TIMEOUT_MS = 30 * 60_000; // the first call creates the LibreOffice profile; on the migration machine that took ~25 min
for (const d of [OUT_ROOT, REPORT_DIR, PROFILE]) fs.mkdirSync(d, { recursive: true });

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && path.extname(e.name).toLowerCase() === '.doc') acc.push(p);
  }
  return acc;
}

function sniff(buf) {
  const hex = buf.subarray(0, 4).toString('hex').toUpperCase();
  if (hex === 'D0CF11E0') return 'ole2';
  if (hex === '504B0304') return buf.includes(Buffer.from('word/document.xml')) ? 'docx' : 'zip_other';
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (head.startsWith('<')) return 'html';
  return 'unknown';
}

async function verify(docxPath) {
  if (!fs.existsSync(docxPath)) return { ok: false, error: 'no_output' };
  const size = fs.statSync(docxPath).size;
  if (size === 0) return { ok: false, error: 'empty_output' };
  try {
    const { value } = await mammoth.extractRawText({ path: docxPath });
    const textChars = (value || '').replace(/\s+/g, ' ').trim().length;
    return { ok: true, size, textChars };
  } catch (e) {
    return { ok: false, error: `mammoth: ${String(e.message || e).slice(0, 120)}` };
  }
}

function runSoffice(kind, outDir, files) {
  const a = [`-env:UserInstallation=${pathToFileURL(PROFILE).href}`, '--headless', '--norestore', '--nolockcheck'];
  if (kind === 'html') a.push('--infilter=HTML (StarWriter)');
  a.push('--convert-to', 'docx:MS Word 2007 XML', '--outdir', outDir, ...files);
  const r = spawnSync(SOFFICE, a, { timeout: TIMEOUT_MS, windowsHide: true, encoding: 'utf8' });
  return { status: r.status, signal: r.signal, error: r.error ? String(r.error.message) : undefined };
}

const prior = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : null;
const started = new Date().toISOString();
const files = walk(ROOT).sort();
console.log(`.doc files found: ${files.length}`);

const items = [];
for (const src of files) {
  const buf = fs.readFileSync(src);
  const rel = path.relative(ROOT, src);
  const out = path.join(OUT_ROOT, path.dirname(rel), `${path.basename(rel, path.extname(rel))}.docx`);
  items.push({ rel, src, out, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length, kind: sniff(buf) });
}

// Keep valid outputs from an earlier run.
const todo = [];
for (const it of items) {
  const v = await verify(it.out);
  if (v.ok) Object.assign(it, { status: 'ok', reused: true, ...v });
  else todo.push(it);
}
console.log(`already converted (kept): ${items.length - todo.length}; to do: ${todo.length}`);

// Renamed DOCX: plain copy.
for (const it of todo.filter((t) => t.kind === 'docx')) {
  fs.mkdirSync(path.dirname(it.out), { recursive: true });
  fs.copyFileSync(it.src, it.out);
  it.method = 'copy_renamed_docx';
}

// OLE2 and HTML: LibreOffice, grouped by output folder and kind.
const groups = new Map();
for (const it of todo.filter((t) => t.kind === 'ole2' || t.kind === 'html')) {
  const key = `${it.kind}|${path.dirname(it.out)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(it);
}
let call = 0;
const totalCalls = [...groups.values()].reduce((n, g) => n + Math.ceil(g.length / CHUNK), 0);
for (const [key, list] of groups) {
  const [kind, outDir] = key.split('|');
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const r = runSoffice(kind, outDir, chunk.map((c) => c.src));
    call += 1;
    process.stdout.write(`soffice call ${call}/${totalCalls} (${kind}, ${chunk.length} files) exit=${r.status}${r.signal ? ` signal=${r.signal}` : ''}\n`);
    for (const c of chunk) c.method = kind === 'html' ? 'libreoffice_html' : 'libreoffice_doc';
  }
}

// Verify; retry a failed LibreOffice file once on its own.
for (const it of todo) {
  if (!it.method) { it.status = 'failed'; it.error = `unsupported_content_${it.kind}`; continue; }
  let v = await verify(it.out);
  if (!v.ok && it.method.startsWith('libreoffice')) {
    runSoffice(it.kind, path.dirname(it.out), [it.src]);
    v = await verify(it.out);
    it.retried = true;
  }
  Object.assign(it, v.ok ? { status: 'ok', ...v } : { status: 'failed', error: v.error });
}

// Originals untouched: hash again.
let changed = 0;
for (const it of items) {
  const h = crypto.createHash('sha256').update(fs.readFileSync(it.src)).digest('hex');
  if (h !== it.sha256) changed += 1;
}

const count = (pred) => items.filter(pred).length;
const summary = {
  found: items.length,
  distinctSha256: new Set(items.map((i) => i.sha256)).size,
  byContent: Object.fromEntries(['ole2', 'html', 'docx', 'rtf', 'zip_other', 'unknown'].map((k) => [k, count((i) => i.kind === k)]).filter(([, n]) => n)),
  ok: count((i) => i.status === 'ok'),
  failed: count((i) => i.status === 'failed'),
  okUnder200Chars: count((i) => i.status === 'ok' && i.textChars < 200),
  okZeroChars: count((i) => i.status === 'ok' && i.textChars === 0),
  originalsChanged: changed,
};

const report = {
  script: '1b-convert.mjs',
  startedAt: prior?.startedAt || started,
  lastRunAt: new Date().toISOString(),
  root: ROOT,
  outRoot: OUT_ROOT,
  soffice: SOFFICE,
  summary,
  files: items.map(({ src, ...rest }) => rest),
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

console.log(JSON.stringify(summary, null, 2));
console.log(`report: ${REPORT}`);
process.exit(summary.failed || changed ? 1 : 0);
