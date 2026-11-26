#!/usr/bin/env node
// Stage 3 (resumes), step 2: text + AI parse, cached once per file. Plan 5.2, 5.3, 5.6; decision S18.
// docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md
//
//   cd backend
//   node scripts/legacy-migration-resumes/2-parse.mjs --work <work> --env staging --expect-db recruitmentautomationdb --sample
//   node scripts/legacy-migration-resumes/2-parse.mjs --work <work> --env staging --expect-db recruitmentautomationdb [--limit N] [--concurrency 4]
//
// NO DATABASE WRITE, NO E-MAIL, NO ONEDRIVE. The --env pair only chooses which env file supplies the API keys
// (the database is never queried). The cache does not depend on the environment: staging and production
// load the SAME parse/<sha256>.json files ("run once", plan 5.2).
//
// Per file (first copy of each SHA-256; duplicates, unsupported and unreadable files are not parsed):
//   1. text  = extractTextFromFile(readPath)  (the ATS's own function; .doc are read from the converted .docx,
//              saved e-mails from their extracted PDF, images have no text layer)
//   2. under 200 characters and a PDF or image: the scanned-file reader (Gemini, inline file, "plain text only")
//      warning text_from_scanned_reader (plan 5.3)
//   3. parsed = parseResumeWithOpenRouter(text, <archive file name>, null, null)  (the ATS's own parser, unchanged;
//      OpenRouter first, Gemini fallback, inside the ATS helper). Outer retry: 3 attempts, 15 s / 60 s backoff.
//   4. write <work>/parse/<sha256>.json  { status: ok | unreadable | error, textSource, text, parsed, timings }
// A cached ok/unreadable file is never parsed again; an 'error' file is retried on the next run (resumable).
// Writes <work>/report/parse-<stamp>.json (counts, timings, approximate tokens). Console: counts only.
//
// COST GUARDS (added 23 Nov 2026 after the full run drained the OpenRouter key's $12 credit limit and the ATS
// helper's Gemini fallback then ran the production Gemini project past its monthly spending cap):
//   - No Gemini fallback for the PARSE: the ATS helper is given no Gemini key, so an OpenRouter failure is an
//     'error' result (retried next run) instead of a chain of up to six Gemini models x 3 attempts.
//     --allow-gemini-fallback restores HR Upload's behaviour; use only on Pankaj's decision.
//     The scanned-file reader still uses Gemini (one call, one model, image-only files).
//   - Before starting: the OpenRouter key's remaining credit (GET /api/v1/key, no AI call) must cover the files to
//     parse at $0.0005 each (measured about $0.0003); otherwise the run is refused. Re-checked every 200 files;
//     below $0.05 the run stops cleanly.
//   - 10 errors in a row stop the run (provider down or out of credit), so nothing keeps burning.
import fs from 'node:fs';
import path from 'node:path';
import { argOf, prepareEnv } from '../legacy-migration-excel/lib/env.mjs';

const argv = process.argv;
const arg = argOf(argv);
const WORK = arg('--work');
const envName = arg('--env');
const expectDb = arg('--expect-db');
const SAMPLE = argv.includes('--sample');
const LIMIT = arg('--limit') ? Number(arg('--limit')) : Infinity;
const CONCURRENCY = Math.max(1, Math.min(6, Number(arg('--concurrency') || 3)));
// The plan named Gemini 2.5 Flash; Google retired it (404 on 20 Nov 2026), so the default is the
// model the ATS itself is configured with (GEMINI_MODEL, config.gemini.model). Override with --scan-model.
const SCAN_MODEL_ARG = arg('--scan-model');
const MIN_TEXT = 200;
if (!WORK || !envName || !expectDb) {
  console.error('Usage: node 2-parse.mjs --work <work> --env <staging|production> --expect-db <db> [--sample] [--limit N] [--concurrency 3]');
  process.exit(2);
}
prepareEnv({ envName, expectDb, writes: false, allowProduction: false, work: WORK, logLevel: 'error' });
const ALLOW_GEMINI_FALLBACK = argv.includes('--allow-gemini-fallback');
// Taken BEFORE the ATS modules read their configuration: the helper's Gemini fallback sees no key unless allowed.
const SCAN_KEY = process.env.GEMINI_API_KEY || '';
if (!ALLOW_GEMINI_FALLBACK) process.env.GEMINI_API_KEY = '';
const COST_PER_FILE = 0.0005; // USD, OpenRouter; measured about 0.0003 on 23 Nov 2026
const MIN_REMAINING = 0.05;

const { extractTextFromFile, parseResumeWithOpenRouter } = await import('../../src/services/hrUpload.service.js');
const { GoogleGenerativeAI } = await import('@google/generative-ai');
const { default: config } = await import('../../src/config/index.js');
const SCAN_MODEL = SCAN_MODEL_ARG || config.gemini.model;

const manifest = JSON.parse(fs.readFileSync(path.join(WORK, 'manifest.json'), 'utf8'));
const CACHE = path.join(WORK, 'parse');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(path.join(WORK, 'report'), { recursive: true });

const sampleSet = new Set(manifest.sample.files.map((s) => s.sha256));
const PARSEABLE = new Set(['original', 'converted', 'extracted', 'scanned']);
let todo = manifest.files.filter((f) => !f.duplicateOf && PARSEABLE.has(f.route) && f.readPath);
if (SAMPLE) todo = todo.filter((f) => sampleSet.has(f.sha256));
const cached = (f) => {
  const p = path.join(CACHE, `${f.sha256}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};
// Done = ok or unreadable, and no failed scanner call behind a short text (that one is retried).
const isDone = (c) => c && c.status !== 'error' && !(c.scanError && (c.textChars || 0) < MIN_TEXT);
const already = todo.filter((f) => isDone(cached(f))).length;
todo = todo.filter((f) => !isDone(cached(f))).slice(0, LIMIT);
console.log(`scope: ${SAMPLE ? 'staging sample (S18)' : 'all files'}; already cached: ${already}; to parse now: ${todo.length}; concurrency ${CONCURRENCY}; Gemini fallback ${ALLOW_GEMINI_FALLBACK ? 'ALLOWED' : 'off'}`);

// OpenRouter credit (no AI call): the LOWER of the key's own limit (GET /key; null limit = none) and the
// ACCOUNT's prepaid balance (GET /credits: total_credits - total_usage). Both matter: on 23 Nov the key limit was
// raised to $50 while the account balance was $0, and every call failed with 402 ("requires more credits").
async function openRouterRemaining() {
  if (!config.openrouter?.apiKey) return { ok: false, why: 'no OpenRouter key configured' };
  const base = config.openrouter.baseUrl || 'https://openrouter.ai/api/v1';
  const get = (p) => fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${config.openrouter.apiKey}` }, signal: AbortSignal.timeout(15000) });
  try {
    const r = await get('/key');
    if (!r.ok) return { ok: false, why: `OpenRouter key check returned ${r.status}` };
    const d = (await r.json()).data || {};
    const keyLeft = d.limit === null || d.limit === undefined ? Infinity : Number(d.limit_remaining);
    const c = await get('/credits');
    if (!c.ok) return { ok: false, why: `OpenRouter account balance check returned ${c.status}` };
    const cd = (await c.json()).data || {};
    const accountLeft = Number(cd.total_credits) - Number(cd.total_usage);
    return { ok: true, remaining: Math.min(keyLeft, accountLeft), keyLeft, accountLeft };
  } catch (e) { return { ok: false, why: `OpenRouter credit check failed: ${String(e.message).slice(0, 80)}` }; }
}
if (todo.length > 0) {
  const k = await openRouterRemaining();
  const need = +(todo.length * COST_PER_FILE).toFixed(2);
  if (!k.ok) { console.error(`REFUSED: ${k.why}. Nothing was parsed.`); process.exit(1); }
  const fmt = (v) => (v === Infinity ? 'no limit' : `$${v.toFixed(2)}`);
  if (k.remaining < need) { console.error(`REFUSED: OpenRouter credit too low (account balance ${fmt(k.accountLeft)}, key limit left ${fmt(k.keyLeft)}); about $${need} needed for ${todo.length} file(s). Buy credits on the OpenRouter account (raising the key limit alone adds no money), then run again. Nothing was parsed.`); process.exit(1); }
  console.log(`OpenRouter credit: account balance ${fmt(k.accountLeft)}, key limit left ${fmt(k.keyLeft)}; about $${need} needed.`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

async function scannedReader(readPath) {
  const mimeType = MIME[path.extname(readPath).toLowerCase()];
  if (!mimeType || !SCAN_KEY) return null;
  const model = new GoogleGenerativeAI(SCAN_KEY).getGenerativeModel({ model: SCAN_MODEL });
  const data = fs.readFileSync(readPath).toString('base64');
  const r = await model.generateContent([
    { inlineData: { mimeType, data } },
    { text: 'This file is a resume. Return its full text as plain text only, in reading order. No commentary, no markdown, no summary.' },
  ]);
  return (r.response.text() || '').trim();
}

async function withRetry(fn) {
  const waits = [15_000, 60_000];
  for (let a = 0; ; a++) {
    try { return await fn(); } catch (e) { if (a >= waits.length) throw e; await sleep(waits[a]); }
  }
}

async function one(f) {
  const t0 = Date.now();
  const out = { sha256: f.sha256, sourceRowId: f.sourceRowId, unitN: f.unitN, route: f.route, kind: f.kind, parsedAt: null, warnings: [] };
  let text = '';
  try {
    if (f.route !== 'scanned') text = (await extractTextFromFile(f.readPath, path.basename(f.readPath))) || '';
  } catch (e) { out.extractError = String(e.message || e).slice(0, 200); }
  out.textSource = 'extracted';
  out.extractChars = text.trim().length;
  const t1 = Date.now();
  if (text.trim().length < MIN_TEXT) {
    try {
      const scanned = await withRetry(() => scannedReader(f.readPath));
      if (scanned && scanned.length > text.trim().length) { text = scanned; out.textSource = 'scanned_reader'; out.warnings.push('text_from_scanned_reader'); }
    } catch (e) { out.scanError = String(e.message || e).slice(0, 200); }
  }
  const t2 = Date.now();
  text = text.trim();
  out.textChars = text.length;
  out.text = text;
  // A failed scanner call behind a short text is an error (retried next run), never parsed from the stub.
  if (!text || (out.scanError && text.length < MIN_TEXT)) {
    out.status = out.scanError ? 'error' : 'unreadable';
    out.timings = { extractMs: t1 - t0, scanMs: t2 - t1, parseMs: 0 };
    return out;
  }
  if (text.length < MIN_TEXT) out.warnings.push('text_lossy_under_200');
  try {
    out.parsed = await withRetry(() => parseResumeWithOpenRouter(text, path.basename(f.rel), null, null));
    out.status = 'ok';
  } catch (e) {
    out.status = 'error';
    out.parseError = String(e.message || e).slice(0, 200);
  }
  const t3 = Date.now();
  out.parsedAt = new Date().toISOString();
  out.timings = { extractMs: t1 - t0, scanMs: t2 - t1, parseMs: t3 - t2 };
  out.approxTokens = { in: Math.ceil((text.length + 4200) / 4), out: out.parsed ? Math.ceil(JSON.stringify(out.parsed).length / 4) : 0 };
  return out;
}

const started = Date.now();
const results = [];
let next = 0; let done = 0; let errorsInARow = 0; let stopReason = null; let checking = false;
async function worker() {
  while (next < todo.length && !stopReason) {
    const f = todo[next++];
    const r = await one(f);
    fs.writeFileSync(path.join(CACHE, `${f.sha256}.json`), JSON.stringify(r, null, 2));
    results.push(r);
    done++;
    errorsInARow = r.status === 'error' ? errorsInARow + 1 : 0;
    if (errorsInARow >= 10 && !stopReason) stopReason = '10 errors in a row (provider down or out of credit)';
    if (done % 10 === 0 || done === todo.length) console.log(`parsed ${done}/${todo.length} (ok ${results.filter((x) => x.status === 'ok').length}, unreadable ${results.filter((x) => x.status === 'unreadable').length}, error ${results.filter((x) => x.status === 'error').length})`);
    if (done % 200 === 0 && !checking && !stopReason) {
      checking = true;
      const k = await openRouterRemaining();
      if (!k.ok) stopReason = k.why;
      else if (k.remaining < MIN_REMAINING) stopReason = `OpenRouter credit down to $${k.remaining.toFixed(2)}`;
      checking = false;
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (stopReason) console.log(`STOPPED after ${done} file(s): ${stopReason}. Every finished file is cached; run again to continue.`);

const ok = results.filter((r) => r.status === 'ok');
const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0);
const avg = (xs, f) => (xs.length ? Math.round(sum(xs, f) / xs.length) : 0);
const summary = {
  scope: SAMPLE ? 'sample' : 'all',
  parsedNow: results.length,
  ok: ok.length,
  unreadable: results.filter((r) => r.status === 'unreadable').length,
  error: results.filter((r) => r.status === 'error').length,
  scannedReaderUsed: results.filter((r) => r.textSource === 'scanned_reader').length,
  lossyUnder200: results.filter((r) => r.warnings.includes('text_lossy_under_200')).length,
  withEmailFromParser: ok.filter((r) => r.parsed && r.parsed.EmailID).length,
  wallClockSec: Math.round((Date.now() - started) / 1000),
  avgPerFileMs: { extract: avg(results, (r) => r.timings?.extractMs), scan: avg(results, (r) => r.timings?.scanMs), parse: avg(ok, (r) => r.timings?.parseMs) },
  approxTokensPerResume: { in: avg(ok, (r) => r.approxTokens?.in), out: avg(ok, (r) => r.approxTokens?.out) },
  models: { parser: `${config.openrouter?.apiKey ? `OpenRouter ${config.openrouter.model}, ` : ''}Gemini fallback ${config.gemini.model}`, scannedReader: SCAN_MODEL },
};
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
const reportPath = path.join(WORK, 'report', `parse-${summary.scope}-${stamp}.json`);
fs.writeFileSync(reportPath, JSON.stringify({ summary, files: results.map(({ text, parsed, ...r }) => r) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`report: ${reportPath}`);
process.exit(stopReason ? 1 : 0);
