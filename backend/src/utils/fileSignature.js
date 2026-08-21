/**
 * fileSignature.js — is this file actually the type its name claims?
 *
 * Every upload route in this app filtered on the filename EXTENSION alone.
 * That is trivially bypassed: renaming `payload.exe` to `payload.pdf` passed
 * every check and the binary landed in the company OneDrive tenant. Found on
 * 2026-08-20 (defect D7) against `POST /api/documents/:token/upload`, which is
 * the worst case because it is PUBLIC — the only credential is a token that was
 * emailed to a candidate.
 *
 * So the extension is treated as a claim, and this verifies it against the
 * bytes actually on disk.
 *
 * WHY NOT IN multer's fileFilter
 * ------------------------------
 * fileFilter runs on the header before any bytes are written — `file.path`
 * exists but the file is empty, so there is nothing to sniff. The check has to
 * happen after the upload completes, which is why callers invoke it explicitly
 * rather than getting it for free from multer config.
 *
 * WHY NOT THE `file-type` PACKAGE
 * -------------------------------
 * It is ESM-only with a large dependency tree, and this needs to recognise six
 * formats. The signatures below are stable and short; a dependency would be more
 * surface than the problem.
 *
 * DELIBERATELY NOT A VIRUS SCANNER. It stops a mislabelled binary, not a
 * malicious PDF. Real malware scanning is a separate control.
 */
import fs from 'fs';
import path from 'path';
import AppError from './AppError.js';

/**
 * Leading bytes that identify each accepted format.
 *
 * `doc` (the legacy OLE2 compound format) and `docx` (a zip) are both container
 * formats whose signature says nothing about the payload — a .docx IS a zip, so
 * `PK\x03\x04` is the honest answer for it. That is a known, accepted limit:
 * this rejects an executable renamed to .docx, which is the attack seen.
 */
const SIGNATURES = {
  '.pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  '.jpg': [[0xFF, 0xD8, 0xFF]],
  '.jpeg': [[0xFF, 0xD8, 0xFF]],
  '.png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  '.docx': [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06], [0x50, 0x4B, 0x07, 0x08]], // zip
  '.doc': [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]], // OLE2
  '.xlsx': [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06], [0x50, 0x4B, 0x07, 0x08]],
  '.zip': [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06], [0x50, 0x4B, 0x07, 0x08]],
};

/** Formats with no reliable signature — .csv is plain text and cannot be sniffed. */
const UNVERIFIABLE = new Set(['.csv', '.txt']);

/**
 * Whether the bytes on disk match what `ext` promises.
 *
 * Returns TRUE for extensions with no known signature rather than failing them:
 * the caller has already checked the extension against its own allowlist, and a
 * format we cannot verify is not the same as one we have disproved.
 *
 * @param {string} filePath - path to the uploaded file
 * @param {string} ext - the claimed extension, lowercase, with the dot
 * @returns {Promise<boolean>}
 */
export async function matchesSignature(filePath, ext) {
  const expected = SIGNATURES[ext];
  if (!expected || UNVERIFIABLE.has(ext)) return true;

  const longest = Math.max(...expected.map((sig) => sig.length));
  let handle;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(longest);
    const { bytesRead } = await handle.read(buf, 0, longest, 0);
    return expected.some(
      (sig) => bytesRead >= sig.length && sig.every((byte, i) => buf[i] === byte)
    );
  } catch {
    // Unreadable is not the same as mislabelled. Let the caller's own error
    // handling deal with a file it cannot open, rather than reporting it as a
    // type mismatch and confusing the candidate.
    return true;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Every file in a multer request, whatever shape it arrived in.
 *
 * multer hands back three different things depending on which method the route
 * used, and the five upload routes between them use all three:
 *   upload.single() -> req.file          (one object)
 *   upload.array()  -> req.files         (an array)
 *   upload.fields() -> req.files         (an object of named arrays)
 *
 * @param {object} req
 * @returns {Array<object>} flat list of multer file objects
 */
export function collectFiles(req) {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') return Object.values(req.files).flat();
  return [];
}

/** Removes temp files, ignoring anything already gone. */
async function unlinkAll(files) {
  await Promise.all(
    files
      .filter((f) => f?.path)
      .map((f) => fs.promises.unlink(f.path).catch(() => {}))
  );
}

/** The message a candidate or recruiter sees when the bytes contradict the name. */
function mismatchMessage(originalname, ext) {
  return `"${originalname}" is not a valid ${ext.replace('.', '').toUpperCase()}. `
    + 'Please upload the file in the format its name suggests.';
}

/**
 * All-or-nothing signature check for a whole request (defect D7).
 *
 * For routes where a single bad file should fail the request: the public
 * candidate and MRF submissions, and the assessment import. Rejects with 400 —
 * never a bare Error, which the global handler would treat as a server fault and
 * email the team about (that was defect D6).
 *
 * EVERY temp file in the request is removed on rejection, not just the offending
 * one, so a mixed request cannot leave the good half orphaned on disk.
 *
 * @param {object} req - the Express request, after multer has run
 * @throws {AppError} 400 if any file's bytes contradict its extension
 */
export async function assertSignature(req) {
  const files = collectFiles(req);
  for (const file of files) {
    if (!file?.path) continue;
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!(await matchesSignature(file.path, ext))) {
      await unlinkAll(files);
      throw new AppError(mismatchMessage(file.originalname || 'That file', ext), 400);
    }
  }
}

/**
 * Skip-and-report signature check, for the batch routes.
 *
 * HR and vendor uploads take up to 100 resumes at once, so failing the whole
 * batch over one mislabelled file would make the recruiter re-upload the other
 * 99. Bad files are dropped and named in the response instead.
 *
 * `allowedExts` matters for zip entries specifically: multer's fileFilter vets
 * what was POSTED, but entries unpacked from a .zip never passed through it, so
 * this is the only place their extension is checked at all.
 *
 * @param {Array<object>} files - flattened multer-shaped file objects
 * @param {string[]} allowedExts - lowercase, dot-prefixed
 * @returns {Promise<{ accepted: Array<object>, rejected: Array<{ name: string, reason: string }> }>}
 */
export async function partitionBySignature(files, allowedExts) {
  const accepted = [];
  const rejected = [];

  for (const file of files) {
    const name = file.originalname || file.filename || 'unnamed file';
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (allowedExts && !allowedExts.includes(ext)) {
      rejected.push({ name, reason: `File type ${ext || '(none)'} is not accepted.` });
      await unlinkAll([file]);
      continue;
    }

    if (file.path && !(await matchesSignature(file.path, ext))) {
      rejected.push({ name, reason: mismatchMessage(name, ext) });
      await unlinkAll([file]);
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejected };
}

export default { matchesSignature, assertSignature, partitionBySignature, collectFiles };
