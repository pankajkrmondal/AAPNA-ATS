#!/usr/bin/env node
// Stage 3 (resumes), step 1c: the PDF resume attached to each saved e-mail in the archive (decision S21, option A).
// docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, 5.1.
//
//   node scripts/legacy-migration-resumes/1c-extract-email-pdfs.mjs --root <archive root> --work <work folder>
//
// - Finds archive files whose content is a saved e-mail or a saved browser form-upload body
//   (lib/folders.mjs sniffKind = 'email' | 'form_upload'), whatever the extension.
// - Form-upload body: the PDF is stored raw; bytes from the first %PDF to the last %%EOF -> <name>.extracted.pdf
// - Walks the MIME parts (nested multiparts too) and decodes every attachment that is a PDF
//   (filename or content type says PDF, AND the decoded bytes start with %PDF).
// - Writes <work>/extracted/<same relative folder>/<e-mail file name>.pdf (several PDFs: -2.pdf, -3.pdf ...).
// - Originals are only read. Report (file paths = personal data, stays in the work folder): <work>/report/extract-email-pdfs.json
// - Console prints counts only. No database, no network, no AI. Re-running overwrites the outputs with identical bytes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { STAGE2_EXT, sniffKind } from './lib/folders.mjs';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const ROOT = arg('--root');
const WORK = arg('--work');
if (!ROOT || !WORK) { console.error('Usage: node 1c-extract-email-pdfs.mjs --root <archive root> --work <work folder>'); process.exit(2); }
const OUT_ROOT = path.join(WORK, 'extracted');
const REPORT = path.join(WORK, 'report', 'extract-email-pdfs.json');
fs.mkdirSync(path.dirname(REPORT), { recursive: true });

// ---- minimal MIME reader ------------------------------------------------------------------------
function splitHeadBody(text) {
  const m = /\r?\n\r?\n/.exec(text);
  return m ? [text.slice(0, m.index), text.slice(m.index + m[0].length)] : [text, ''];
}
function headers(head) {
  const out = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}
function param(value, name) {
  if (!value) return undefined;
  const ext = new RegExp(`${name}\\*(?:0\\*?)?=\\s*(?:[\\w-]*'[\\w-]*')?"?([^";]+)"?`, 'i').exec(value); // RFC 2231
  if (ext) { try { return decodeURIComponent(ext[1]); } catch { return ext[1]; } }
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i').exec(value);
  return m ? (m[2] ?? m[1]) : undefined;
}
function* parts(text, depth = 0) {
  const [head, body] = splitHeadBody(text);
  const h = headers(head);
  const ct = h['content-type'] || 'text/plain';
  const boundary = /^multipart\//i.test(ct) ? param(ct, 'boundary') : undefined;
  if (boundary && depth < 10) {
    const segs = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
    for (const s of segs.slice(1)) if (s.trim()) yield* parts(s, depth + 1);
    return;
  }
  yield { h, ct, body };
}
// -------------------------------------------------------------------------------------------------

const emails = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && !STAGE2_EXT.has(path.extname(e.name).toLowerCase())) {
      const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(4096); const n = fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd);
      const k = sniffKind(b.subarray(0, n));
      if (k === 'email' || k === 'form_upload') emails.push(path.relative(ROOT, p));
    }
  }
})(ROOT);
emails.sort((a, b) => a.localeCompare(b, 'en'));

const items = [];
for (const rel of emails) {
  const src = path.join(ROOT, rel);
  const raw = fs.readFileSync(src);
  const kind = sniffKind(raw.subarray(0, 4096));
  const it = { rel, kind, sha256: crypto.createHash('sha256').update(raw).digest('hex'), pdfs: [], attachmentsSeen: 0 };
  if (kind === 'form_upload') {
    // Saved browser upload body: the PDF is stored raw between its part headers and the closing boundary.
    const start = raw.indexOf('%PDF');
    const eof = raw.lastIndexOf('%%EOF');
    it.attachmentsSeen = 1;
    if (start < 0 || eof < start) it.pdfs.push({ ok: false, error: 'no_pdf_in_form_body' });
    else {
      let end = eof + 5;
      if (raw[end] === 0x0d) end++;
      if (raw[end] === 0x0a) end++;
      const pdf = raw.subarray(start, end);
      const out = path.join(OUT_ROOT, path.dirname(rel), `${path.basename(rel)}.extracted.pdf`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, pdf);
      it.pdfs.push({ ok: true, out, bytes: pdf.length, sha256: crypto.createHash('sha256').update(pdf).digest('hex'), hasEOF: true });
    }
  }
  for (const p of kind === 'email' ? parts(raw.toString('latin1')) : []) {
    const disp = p.h['content-disposition'] || '';
    const fname = param(disp, 'filename') || param(p.ct, 'name') || '';
    const isAttachment = /attachment|inline/i.test(disp) || !!fname;
    if (!isAttachment) continue;
    it.attachmentsSeen += 1;
    const enc = (p.h['content-transfer-encoding'] || '').toLowerCase();
    const looksPdf = /\.pdf$/i.test(fname) || /application\/pdf/i.test(p.ct);
    if (!looksPdf) continue;
    const bytes = enc === 'base64' ? Buffer.from(p.body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64') : Buffer.from(p.body, 'latin1');
    const start = bytes.indexOf('%PDF');
    if (start < 0 || start > 1024) { it.pdfs.push({ ok: false, error: 'decoded_not_pdf' }); continue; }
    const pdf = start ? bytes.subarray(start) : bytes;
    const n = it.pdfs.filter((x) => x.ok).length + 1;
    const out = path.join(OUT_ROOT, path.dirname(rel), `${path.basename(rel)}${n === 1 ? '' : `-${n}`}.pdf`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, pdf);
    it.pdfs.push({ ok: true, out, bytes: pdf.length, sha256: crypto.createHash('sha256').update(pdf).digest('hex'), hasEOF: pdf.subarray(-2048).includes('%%EOF') });
  }
  it.status = it.pdfs.filter((x) => x.ok).length === 1 ? 'ok' : (it.pdfs.some((x) => x.ok) ? 'several_pdfs' : 'no_pdf');
  items.push(it);
}

const summary = {
  files: items.length,
  emails: items.filter((i) => i.kind === 'email').length,
  formUploads: items.filter((i) => i.kind === 'form_upload').length,
  ok_one_pdf: items.filter((i) => i.status === 'ok').length,
  several_pdfs: items.filter((i) => i.status === 'several_pdfs').length,
  no_pdf: items.filter((i) => i.status === 'no_pdf').length,
  pdfsWritten: items.reduce((n, i) => n + i.pdfs.filter((x) => x.ok).length, 0),
  pdfsWithoutEOF: items.reduce((n, i) => n + i.pdfs.filter((x) => x.ok && !x.hasEOF).length, 0),
};
fs.writeFileSync(REPORT, JSON.stringify({ script: '1c-extract-email-pdfs.mjs', runAt: new Date().toISOString(), root: ROOT, outRoot: OUT_ROOT, summary, emails: items }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`report: ${REPORT}`);
process.exit(summary.no_pdf || summary.several_pdfs ? 1 : 0);
