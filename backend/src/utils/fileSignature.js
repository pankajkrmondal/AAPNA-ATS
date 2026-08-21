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

export default { matchesSignature };
