/**
 * D7 — an upload must be the type its filename claims.
 * Run: node --test src/tests/unit/fileSignature.test.js
 *
 * The case that matters is the FIRST one: a Windows executable renamed to .pdf.
 * That exact payload uploaded successfully on 2026-08-20 (200, row written, file
 * pushed to OneDrive) through the PUBLIC, unauthenticated document endpoint,
 * because every upload route in the app filtered on the filename extension
 * alone. Renaming was the whole attack.
 *
 * Pure unit test — real bytes on a real temp file, no database, no network.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { matchesSignature } from '../../utils/fileSignature.js';

let dir;

/** Writes `bytes` to a temp file and returns its path. */
function write(name, bytes) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigtest-'));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('D7 — magic-byte validation', () => {
  test('a Windows executable renamed to .pdf is REJECTED — the actual bypass', async () => {
    // MZ header: the first bytes of every PE executable.
    const p = write('malware.pdf', [0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    assert.equal(
      await matchesSignature(p, '.pdf'), false,
      'an MZ executable must not pass as a PDF — this is defect D7'
    );
  });

  test('a real PDF passes', async () => {
    const p = write('real.pdf', [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]); // %PDF-1.4
    assert.equal(await matchesSignature(p, '.pdf'), true);
  });

  test('real JPEG and PNG pass', async () => {
    const jpg = write('photo.jpg', [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    const png = write('shot.png', [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert.equal(await matchesSignature(jpg, '.jpg'), true);
    assert.equal(await matchesSignature(png, '.png'), true);
  });

  test('a PNG renamed to .jpg is rejected — the formats are not interchangeable', async () => {
    const p = write('actually-png.jpg', [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert.equal(await matchesSignature(p, '.jpg'), false);
  });

  test('a real .docx (a zip) passes', async () => {
    const p = write('cv.docx', [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
    assert.equal(await matchesSignature(p, '.docx'), true);
  });

  test('an executable renamed to .docx is rejected', async () => {
    const p = write('bad.docx', [0x4D, 0x5A, 0x90, 0x00]);
    assert.equal(await matchesSignature(p, '.docx'), false);
  });

  test('legacy .doc (OLE2) passes', async () => {
    const p = write('old.doc', [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    assert.equal(await matchesSignature(p, '.doc'), true);
  });

  test('a file SHORTER than the signature is rejected, not accepted by accident', async () => {
    // An off-by-one here would wave through a 2-byte file as a valid PNG.
    const p = write('truncated.png', [0x89, 0x50]);
    assert.equal(await matchesSignature(p, '.png'), false);
  });

  test('an empty file is rejected', async () => {
    const p = write('empty.pdf', []);
    assert.equal(await matchesSignature(p, '.pdf'), false);
  });

  test('an unverifiable format passes — absence of a signature is not disproof', async () => {
    // .csv is plain text with no magic bytes. The caller's extension allowlist
    // is the control there; this must not invent a failure it cannot justify.
    const p = write('data.csv', [0x61, 0x2C, 0x62, 0x0A]);
    assert.equal(await matchesSignature(p, '.csv'), true);
  });

  test('an unreadable path passes rather than reporting a type mismatch', async () => {
    // "Cannot open" and "wrong type" are different failures; conflating them
    // would tell a candidate their valid PDF is the wrong format.
    assert.equal(await matchesSignature(path.join(dir, 'nope.pdf'), '.pdf'), true);
  });
});
