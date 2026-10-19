/**
 * logScan.service.js — "Find a ref" on Logs & errors (N42).
 *
 * Reads the combined log files (combined.log plus Winston's rotated
 * combined1.log … combined4.log) newest first and returns the lines that
 * mention the ref: the request line, every log line written while it was
 * handled (they carry "requestId"), and its outside calls.
 *
 * Bounded so it can never hurt the server: at most MAX_FILES files, MAX_LINES
 * matches and MAX_MS of scanning. Lines were already masked when written.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same resolution as config/logger.js.
const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, '../../logs');

const MAX_FILES = 6;
const MAX_LINES = 500;
const MAX_MS = 5000;
const MAX_LINE_CHARS = 4000;
const SAFE_REF = /^[A-Za-z0-9_-]{4,80}$/;

function combinedFiles() {
  let names = [];
  try {
    names = fs.readdirSync(LOG_DIR).filter((n) => /^combined\d*\.log$/.test(n));
  } catch {
    return [];
  }
  return names
    .map((n) => {
      const full = path.join(LOG_DIR, n);
      try { return { full, name: n, mtime: fs.statSync(full).mtimeMs }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_FILES);
}

function parseLine(raw) {
  try {
    const j = JSON.parse(raw);
    return { timestamp: j.timestamp ?? null, level: j.level ?? null, message: j.message ?? '', requestId: j.requestId ?? null, raw: null };
  } catch {
    return { timestamp: null, level: null, message: raw.slice(0, MAX_LINE_CHARS), requestId: null, raw: true };
  }
}

/**
 * All log lines mentioning `ref`, oldest first.
 * @param {string} ref
 * @returns {Promise<{ lines: Array<object>, filesScanned: string[], truncated: boolean, timedOut: boolean }>}
 */
export async function findLogLinesByRef(ref) {
  if (!SAFE_REF.test(ref || '')) return { lines: [], filesScanned: [], truncated: false, timedOut: false };
  const started = Date.now();
  const lines = [];
  const filesScanned = [];
  let truncated = false;
  let timedOut = false;

  for (const file of combinedFiles()) {
    if (lines.length >= MAX_LINES) { truncated = true; break; }
    if (Date.now() - started > MAX_MS) { timedOut = true; break; }
    filesScanned.push(file.name);
    const stream = fs.createReadStream(file.full, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const raw of rl) {
        if (raw.includes(ref)) {
          lines.push({ file: file.name, ...parseLine(raw.length > MAX_LINE_CHARS ? raw.slice(0, MAX_LINE_CHARS) : raw) });
          if (lines.length >= MAX_LINES) { truncated = true; break; }
        }
        if (Date.now() - started > MAX_MS) { timedOut = true; break; }
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  }

  lines.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  return { lines, filesScanned, truncated, timedOut };
}
