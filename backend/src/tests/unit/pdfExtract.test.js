/**
 * PDF text extraction through pdf-parse v2.
 * Run: node --test src/tests/unit/pdfExtract.test.js
 *
 * Two defects, both from the v1 → v2 upgrade of pdf-parse:
 *  - fileExtractor.js still called the v1 `pdfParse(buffer)`. v2 exports a
 *    PDFParse class, so every PDF JD on MRF create threw "pdfParse is not a
 *    function" and was saved with empty JD text (the controller only warns).
 *  - The resume path passed a bare Uint8Array to `new PDFParse()`, which drops
 *    pdf-parse's default verbosity, so pdf.js wrote "standardFontDataUrl" and
 *    "TT: undefined function" warnings to the prod error log for every resume.
 *
 * Pure unit test — a real PDF built in memory, no database, no network.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { extractTextFromBuffer } from '../../utils/fileExtractor.js';

/**
 * A minimal, well-formed one-page PDF (correct xref offsets) whose text uses
 * Helvetica WITHOUT embedding it — the case that makes pdf.js look for
 * standardFontDataUrl, as Word "Save as PDF" resumes routinely do.
 */
function helveticaPdf(text) {
  const content = `BT /F1 18 Tf 20 50 Td (${text}) Tj ET`;
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

let warnings;
let originalWarn;

beforeEach(() => {
  warnings = [];
  originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
});

afterEach(() => {
  console.warn = originalWarn;
});

describe('extractTextFromBuffer — PDF', () => {
  test('a PDF JD is read — v2 has no callable pdfParse() any more', async () => {
    const text = await extractTextFromBuffer(helveticaPdf('Senior Java Developer'), 'application/pdf');
    assert.match(text, /Senior Java Developer/);
  });

  test('a non-embedded standard font writes no pdf.js warnings', async () => {
    await extractTextFromBuffer(helveticaPdf('Hello Resume'), 'application/pdf');
    assert.deepEqual(
      warnings.filter((w) => w.startsWith('Warning:')), [],
      'pdf.js warnings must stay out of the error log'
    );
  });

  test('the mimetype is matched case-insensitively', async () => {
    const text = await extractTextFromBuffer(helveticaPdf('Case Check'), 'Application/PDF');
    assert.match(text, /Case Check/);
  });

  test('a corrupt PDF rejects, so the caller can log it and carry on', async () => {
    await assert.rejects(
      () => extractTextFromBuffer(Buffer.from('%PDF-1.4\nnot really a pdf'), 'application/pdf')
    );
  });
});
