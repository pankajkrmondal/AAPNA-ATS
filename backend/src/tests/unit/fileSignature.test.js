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

import {
  matchesSignature,
  assertSignature,
  partitionBySignature,
  collectFiles,
} from '../../utils/fileSignature.js';

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

/** A multer-shaped file object over a real temp file. */
function fileObj(name, bytes) {
  return { originalname: name, path: write(name, bytes) };
}

const MZ = [0x4D, 0x5A, 0x90, 0x00];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34];
const ZIP = [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00];

describe('collectFiles — the three multer shapes', () => {
  test('upload.single() — req.file', () => {
    const f = { originalname: 'a.pdf', path: '/tmp/a' };
    assert.deepEqual(collectFiles({ file: f }), [f]);
  });

  test('upload.array() — req.files as an array', () => {
    const fs_ = [{ originalname: 'a.pdf' }, { originalname: 'b.pdf' }];
    assert.deepEqual(collectFiles({ files: fs_ }), fs_);
  });

  test('upload.fields() — req.files as an object of named arrays', () => {
    const a = { originalname: 'jd.pdf' };
    const b = { originalname: 'test.pdf' };
    assert.deepEqual(
      collectFiles({ files: { attach_jd: [a], attach_online_test_paper: [b] } }),
      [a, b]
    );
  });

  test('no file at all yields an empty list, not a throw', () => {
    assert.deepEqual(collectFiles({}), []);
  });
});

describe('assertSignature — all-or-nothing routes', () => {
  test('a clean single file passes and is left on disk', async () => {
    const f = fileObj('ok-assert.pdf', PDF);
    await assertSignature({ file: f });
    assert.equal(fs.existsSync(f.path), true);
  });

  test('the D7 payload throws 400 and unlinks the temp file', async () => {
    const f = fileObj('bad-assert.pdf', MZ);
    await assert.rejects(
      () => assertSignature({ file: f }),
      (err) => {
        assert.equal(err.statusCode, 400, 'must be 400 — a 500 emails the team (defect D6)');
        assert.match(err.message, /not a valid PDF/);
        return true;
      }
    );
    assert.equal(fs.existsSync(f.path), false, 'the rejected upload must not stay on disk');
  });

  test('one bad file unlinks EVERY temp file in the request, not just the bad one', async () => {
    // upload.fields(): a valid JD alongside a disguised executable. Leaving the
    // good half behind would orphan it in uploads/ with nothing to clean it up.
    const good = fileObj('jd-good.pdf', PDF);
    const bad = fileObj('test-bad.pdf', MZ);
    await assert.rejects(() => assertSignature({
      files: { attach_jd: [good], attach_online_test_paper: [bad] },
    }));
    assert.equal(fs.existsSync(good.path), false, 'the good file must be cleaned up too');
    assert.equal(fs.existsSync(bad.path), false);
  });

  test('a request with no file is a no-op', async () => {
    await assertSignature({});
  });
});

describe('partitionBySignature — skip-and-report batch routes', () => {
  const EXTS = ['.pdf', '.docx', '.doc'];

  test('a mislabelled file is dropped while the rest are kept', async () => {
    const a = fileObj('resume-1.pdf', PDF);
    const bad = fileObj('resume-2.pdf', MZ);
    const c = fileObj('resume-3.docx', ZIP);

    const { accepted, rejected } = await partitionBySignature([a, bad, c], EXTS);

    assert.deepEqual(accepted.map((f) => f.originalname), ['resume-1.pdf', 'resume-3.docx']);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].name, 'resume-2.pdf');
    assert.equal(fs.existsSync(bad.path), false, 'the rejected file must be unlinked');
    assert.equal(fs.existsSync(a.path), true, 'the good files must survive');
    assert.equal(fs.existsSync(c.path), true);
  });

  test('an .exe unpacked from a .zip is rejected on extension alone', async () => {
    // Zip entries never pass through multer's fileFilter, so this is the only
    // extension check they ever face.
    const entry = fileObj('payload.exe', MZ);
    const { accepted, rejected } = await partitionBySignature([entry], EXTS);

    assert.equal(accepted.length, 0);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason, /not accepted/);
    assert.equal(fs.existsSync(entry.path), false);
  });

  test('everything rejected yields an empty accepted list, not a throw', async () => {
    const bad = fileObj('all-bad.pdf', MZ);
    const { accepted, rejected } = await partitionBySignature([bad], EXTS);
    assert.equal(accepted.length, 0);
    assert.equal(rejected.length, 1);
  });

  test('a .zip is rejected post-expansion — archives are unpacked, never parsed', async () => {
    const z = fileObj('bundle.zip', ZIP);
    const { accepted, rejected } = await partitionBySignature([z], EXTS);
    assert.equal(accepted.length, 0);
    assert.equal(rejected.length, 1);
  });
});
